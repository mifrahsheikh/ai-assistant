"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

type Citation = { title: string; snippet: string };
type Msg = {
  role: "user" | "assistant";
  content: string;
  attachment?: string;
  skill?: string;
  audio?: string;
  citations?: Citation[];
};

async function* readEvents(res: Response) {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (part.startsWith("data: ")) yield JSON.parse(part.slice(6));
    }
  }
}

const MAX_BYTES = 15 * 1024 * 1024; // matches the API limit

type Chat = { id: string; messages: Msg[] };
const STORE_KEY = "ai-assistant-chats";
const uid = () =>
  globalThis.crypto?.randomUUID?.() ??
  Math.random().toString(36).slice(2) + Date.now().toString(36);
// Saved chats from this browser, plus a fresh empty chat to start in.
function loadChats(): Chat[] {
  const fresh: Chat = { id: uid(), messages: [] };
  if (typeof window === "undefined") return [fresh];
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    if (Array.isArray(saved)) {
      return [
        fresh,
        ...saved.filter(
          (c) => c?.id && Array.isArray(c.messages) && c.messages.length,
        ),
      ];
    }
  } catch {
    /* storage blocked or corrupt: start empty */
  }
  return [fresh];
}
const noSubscribe = () => () => {};
const titleOf = (c: Chat) => {
  const m = c.messages.find((x) => x.role === "user");
  return (m?.content.trim() || m?.attachment || "New chat").slice(0, 40);
};

// Full class names (not built strings) so Tailwind can see them.
const SKILL_STYLE: Record<string, string> = {
  chat: "bg-chat-bg text-chat-fg",
  image: "bg-image-bg text-image-fg",
  voice: "bg-voice-bg text-voice-fg",
  file: "bg-file-bg text-file-fg",
};
const EXAMPLES = [
  {
    skill: "chat",
    text: "Explain RAG in three simple sentences.",
    hint: "Just type and send",
  },
  {
    skill: "image",
    text: "What is in this picture?",
    hint: "Attach an image first",
  },
  {
    skill: "voice",
    text: "Tell me a fun fact about space.",
    hint: "Or press the mic and say it out loud",
  },
  {
    skill: "file",
    text: "Summarise this document in five bullet points.",
    hint: "Attach a file first",
  },
];
const skillLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function base64ToUrl(b64: string, mime: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mime }));
}

const iconProps = {
  viewBox: "0 0 24 24",
  className: "h-5 w-5",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};
const ImageIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="9" cy="9" r="1.5" />
    <path d="M21 15l-5-5L5 21" />
  </svg>
);
const ClipIcon = () => (
  <svg {...iconProps}>
    <path d="M21 11l-9 9a5 5 0 01-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 01-3-3l8-8" />
  </svg>
);
const MicIcon = () => (
  <svg {...iconProps}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" />
  </svg>
);
const StopIcon = () => (
  <svg {...iconProps} fill="currentColor">
    <rect x="6" y="6" width="12" height="12" rx="2" />
  </svg>
);
const SendIcon = () => (
  <svg {...iconProps}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

const PlusIcon = () => (
  <svg {...iconProps}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
const MenuIcon = () => (
  <svg {...iconProps}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
const TrashIcon = () => (
  <svg {...iconProps} className="h-4 w-4">
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
const CloseIcon = () => (
  <svg {...iconProps}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export default function Home() {
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeId, setActiveId] = useState(() => chats[0].id);
  // false while the server HTML is hydrated, then true: keeps saved chats out of that first pass.
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  const [open, setOpen] = useState(false); // sidebar drawer on phones
  const [collapsed, setCollapsed] = useState(false); // sidebar on wide screens
  const active = chats.find((c) => c.id === activeId) ?? chats[0];
  const messages = active.messages;
  // Same setter as before, but it writes into the active chat.
  const setMessages = (u: Msg[] | ((p: Msg[]) => Msg[])) =>
    setChats((prev) =>
      prev.map((c) =>
        c.id === active.id
          ? { ...c, messages: typeof u === "function" ? u(c.messages) : u }
          : c,
      ),
    );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [doc, setDoc] = useState<File | null>(null);
  const [recording, setRecording] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // After an error, drop the empty assistant bubble that was waiting for text.
  const dropEmptyReply = () =>
    setMessages((prev) =>
      prev.length &&
      prev[prev.length - 1].role === "assistant" &&
      !prev[prev.length - 1].content
        ? prev.slice(0, -1)
        : prev,
    );

  // Save after each finished reply (not on every streamed word).
  useEffect(() => {
    if (busy) return;
    try {
      const keep = chats
        .filter((c) => c.messages.length > 0)
        .slice(0, 50)
        .map((c) => ({
          id: c.id,
          messages: c.messages.map(
            ({ role, content, attachment, skill, citations }) => ({
              role,
              content,
              attachment,
              skill,
              citations,
            }),
          ),
        }));
      localStorage.setItem(STORE_KEY, JSON.stringify(keep));
    } catch {
      /* storage full or blocked: chats just won't persist */
    }
  }, [chats, busy]);

  function newChat() {
    if (busy) return;
    const empty = chats.find((c) => c.messages.length === 0);
    if (empty) setActiveId(empty.id);
    else {
      const id = uid();
      setChats((prev) => [{ id, messages: [] }, ...prev]);
      setActiveId(id);
    }
    setError(null);
    setOpen(false);
    boxRef.current?.focus();
  }
  function openChat(id: string) {
    if (busy) return;
    setChats((prev) =>
      prev.filter((c) => c.id === id || c.messages.length > 0),
    );
    setActiveId(id);
    setError(null);
    setOpen(false);
  }
  function deleteChat(id: string) {
    if (busy) return;
    const rest = chats.filter((c) => c.id !== id);
    const next = rest.length ? rest : [{ id: uid(), messages: [] }];
    setChats(next);
    if (id === active.id) setActiveId(next[0].id);
  }
  function toggleSidebar() {
    if (window.matchMedia("(min-width: 768px)").matches)
      setCollapsed((v) => !v);
    else setOpen((v) => !v);
  }

  // Free the thumbnail's memory when it is replaced or removed.
  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  // Grow the text box with its content, up to a limit.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  // Keep the newest text in view while the answer streams in.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((prev) =>
      prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)),
    );

  async function send(audio?: Blob) {
    if (busy || (!input.trim() && !image && !doc && !audio)) return;
    if ([image, doc].some((f) => f && f.size > MAX_BYTES)) {
      setError("File is too large. The limit is 15 MB.");
      setImage(null);
      setDoc(null);
      return;
    }
    const userMsg: Msg = {
      role: "user",
      content: input,
      attachment:
        image?.name ?? doc?.name ?? (audio ? "voice message" : undefined),
    };
    const history = [...messages, userMsg];
    const form = new FormData();
    form.append(
      "messages",
      JSON.stringify(history.map(({ role, content }) => ({ role, content }))),
    );
    if (image) form.append("image", image);
    if (doc) form.append("document", doc);
    if (audio) form.append("audio", audio, "voice.webm");

    setError(null);
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setImage(null);
    setDoc(null);
    setBusy(true);
    try {
      const res = await fetch("/api/agent", { method: "POST", body: form });
      for await (const ev of readEvents(res)) {
        if (ev.type === "skill") patchLast((m) => ({ ...m, skill: ev.name }));
        if (ev.type === "text")
          patchLast((m) => ({ ...m, content: m.content + ev.text }));
        if (ev.type === "citations")
          patchLast((m) => ({ ...m, citations: ev.items }));
        if (ev.type === "error") {
          setError(ev.message);
          dropEmptyReply();
        }
        if (ev.type === "transcript") {
          setMessages((prev) =>
            prev.map((m, i) =>
              i === prev.length - 2 ? { ...m, content: ev.text } : m,
            ),
          );
        }
        if (ev.type === "audio") {
          const url = base64ToUrl(ev.data, ev.mime);
          patchLast((m) => ({ ...m, audio: url }));
          new Audio(url).play().catch(() => {});
        }
      }
    } catch {
      setError("Could not reach the server.");
      dropEmptyReply();
    } finally {
      setBusy(false);
    }
  }

  async function toggleMic() {
    if (recording) {
      recorder.current?.stop();
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(
        "Microphone access was blocked. Allow it in the browser and try again.",
      );
      return;
    }
    const rec = new MediaRecorder(stream);
    chunks.current = [];
    rec.ondataavailable = (e) => chunks.current.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      send(new Blob(chunks.current, { type: rec.mimeType }));
    };
    rec.start();
    recorder.current = rec;
    setRecording(true);
  }

  const iconBtn =
    "flex h-10 w-10 items-center justify-center rounded-full border border-line text-muted hover:bg-bg";
  const chipX =
    "ml-1 rounded-full px-1.5 text-lg leading-none text-muted hover:text-fg";

  function pickImage(f: File | null) {
    setImage(f);
    setImageUrl(f ? URL.createObjectURL(f) : null);
  }
  function pickDoc(f: File | null) {
    setDoc(f);
  }
  function removeImage() {
    setImage(null);
    setImageUrl(null);
  }
  function removeDoc() {
    setDoc(null);
  }

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        id="sidebar"
        aria-label="Conversations"
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        className={`fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-line bg-surface transition-transform duration-200 md:static md:z-auto ${
          open ? "translate-x-0" : "-translate-x-full max-md:invisible"
        } ${collapsed ? "md:hidden" : "md:translate-x-0"}`}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-fg"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
                <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zm7 11l.9 2.6L22.5 16.5l-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13z" />
              </svg>
            </div>
            <span className="truncate text-base font-semibold">
              AI Assistant
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close sidebar"
            className="rounded-full p-2 text-muted hover:bg-bg md:hidden"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="px-3">
          <button
            type="button"
            onClick={newChat}
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-xl bg-accent-soft px-3 py-2.5 text-sm font-medium text-accent hover:opacity-80 disabled:opacity-40"
          >
            <PlusIcon />
            New chat
          </button>
        </div>

        <p className="px-4 pb-1 pt-5 text-xs font-medium uppercase tracking-wide text-muted">
          Recent
        </p>
        <nav
          aria-label="Saved chats"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {!ready || chats.every((c) => c.messages.length === 0) ? (
            <p className="px-2 py-3 text-sm text-muted">
              Your conversations will appear here.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {chats
                .filter((c) => c.messages.length > 0)
                .map((c) => (
                  <li key={c.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => openChat(c.id)}
                      disabled={busy && c.id !== active.id}
                      aria-current={c.id === active.id ? "page" : undefined}
                      className={`w-full truncate rounded-lg py-2 pl-3 pr-10 text-left text-sm disabled:opacity-50 ${
                        c.id === active.id
                          ? "bg-accent-soft font-medium"
                          : "hover:bg-bg"
                      }`}
                    >
                      {titleOf(c)}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteChat(c.id)}
                      disabled={busy}
                      aria-label={`Delete chat: ${titleOf(c)}`}
                      className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted opacity-0 hover:text-err-fg focus:opacity-100 group-hover:opacity-100 max-md:opacity-100 disabled:opacity-30"
                    >
                      <TrashIcon />
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </nav>

        <p className="border-t border-line px-4 py-3 text-xs text-muted">
          Powered by Gemini. Chats are saved in this browser only.
        </p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2.5">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
            aria-controls="sidebar"
            aria-expanded={open || !collapsed}
            className="rounded-full p-2 text-muted hover:bg-surface"
          >
            <MenuIcon />
          </button>
          <h1 className="min-w-0 flex-1 truncate text-base font-medium">
            {messages.length ? titleOf(active) : "New chat"}
          </h1>
        </header>

        <div
          role="log"
          aria-label="Conversation"
          className="flex-1 overflow-y-auto"
        >
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 md:px-6">
            {messages.length === 0 && (
              <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 py-8 text-center">
                <div>
                  <h2 className="text-2xl font-semibold">
                    How can I help today?
                  </h2>
                  <p className="mt-1 text-sm text-muted">
                    Pick an example, or type, record, or attach something below.
                  </p>
                </div>
                <ul className="grid w-full max-w-xl gap-3 sm:grid-cols-2">
                  {EXAMPLES.map((ex) => (
                    <li key={ex.skill}>
                      <button
                        type="button"
                        onClick={() => {
                          setInput(ex.text);
                          boxRef.current?.focus();
                        }}
                        className="flex h-full w-full flex-col items-start rounded-2xl border border-line bg-surface p-4 text-left shadow-sm hover:border-accent"
                      >
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${SKILL_STYLE[ex.skill]}`}
                        >
                          {skillLabel(ex.skill)}
                        </span>
                        <span className="mt-2 block text-sm">{ex.text}</span>
                        <span className="mt-1 block text-xs text-muted">
                          {ex.hint}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {messages.map((m, i) => {
              const isUser = m.role === "user";
              const typing = !m.content && busy && i === messages.length - 1;
              return (
                <div
                  key={i}
                  className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
                >
                  {!isUser && (
                    <div
                      aria-hidden="true"
                      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent"
                    >
                      AI
                    </div>
                  )}
                  <div
                    className={`flex min-w-0 max-w-[85%] flex-col gap-1.5 ${
                      isUser ? "items-end" : "items-start"
                    }`}
                  >
                    {(m.content || typing) && (
                      <div
                        className={`whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed shadow-sm ${
                          isUser
                            ? "rounded-br-md bg-accent text-accent-fg"
                            : "rounded-bl-md border border-line bg-surface"
                        }`}
                      >
                        {typing ? (
                          <span
                            role="status"
                            aria-label="Assistant is typing"
                            className="flex gap-1 py-1"
                          >
                            <span className="typing-dot h-2 w-2 rounded-full bg-muted" />
                            <span className="typing-dot h-2 w-2 rounded-full bg-muted" />
                            <span className="typing-dot h-2 w-2 rounded-full bg-muted" />
                          </span>
                        ) : (
                          m.content
                        )}
                      </div>
                    )}
          
                   
                    {m.citations && m.citations.length > 0 && (
                      <div className="w-full">
                        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                          Sources
                        </p>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {m.citations.map((c) => (
                            <li
                              key={c.title}
                              className="rounded-xl border border-line bg-surface p-3 text-xs shadow-sm"
                            >
                              <p className="truncate text-sm font-medium">
                                {c.title}
                              </p>
                              <p className="mt-1 line-clamp-3 text-muted">
                                {c.snippet}
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
        </div>

        <div className="mx-auto w-full max-w-3xl">
          {error && (
            <div
              role="alert"
              className="mx-4 md:mx-6 mb-2 flex items-start gap-3 rounded-xl border border-err-line bg-err-bg px-4 py-3 text-sm text-err-fg"
            >
              <p className="min-w-0 flex-1 break-words">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
                className="-my-1 rounded-full px-2 text-lg leading-none hover:opacity-70"
              >
                ×
              </button>
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 md:px-6"
          >
            {(image || doc) && (
              <div className="mb-2 flex flex-wrap gap-2">
                {image && imageUrl && (
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1.5 pr-2 text-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl}
                      alt=""
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                    <span className="max-w-[10rem] truncate">{image.name}</span>
                    <button
                      type="button"
                      onClick={removeImage}
                      aria-label={`Remove image ${image.name}`}
                      className={chipX}
                    >
                      ×
                    </button>
                  </div>
                )}
                {doc && (
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                    <span aria-hidden="true">📄</span>
                    <span className="max-w-[12rem] truncate">{doc.name}</span>
                    <button
                      type="button"
                      onClick={removeDoc}
                      aria-label={`Remove file ${doc.name}`}
                      className={chipX}
                    >
                      ×
                    </button>
                  </div>
                )}
              </div>
            )}

            {recording && (
              <p
                role="status"
                className="mb-2 flex items-center gap-2 text-sm text-rec"
              >
                <span className="h-2 w-2 animate-pulse rounded-full bg-rec" />
                Recording... press the red button to stop and send.
              </p>
            )}

            <div className="rounded-2xl border border-line bg-surface p-2 shadow-sm focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/40">
              <textarea
                ref={boxRef}
                value={input}
                rows={1}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing
                  ) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask something..."
                aria-label="Message"
                className="block max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted"
              />
              <div className="mt-1 flex items-center gap-1">
                <label
                  className={`${iconBtn} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}
                  title="Attach image"
                >
                  <ImageIcon />
                  <span className="sr-only">Attach image</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(e) => {
                      pickImage(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label
                  className={`${iconBtn} cursor-pointer focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent`}
                  title="Attach file"
                >
                  <ClipIcon />
                  <span className="sr-only">Attach file</span>
                  <input
                    type="file"
                    className="sr-only"
                    onChange={(e) => {
                      pickDoc(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={toggleMic}
                  disabled={busy && !recording}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                  aria-pressed={recording}
                  title={
                    recording ? "Stop recording" : "Record a voice question"
                  }
                  className={`${iconBtn} disabled:opacity-40 ${
                    recording
                      ? "animate-pulse border-rec text-rec ring-2 ring-rec"
                      : ""
                  }`}
                >
                  {recording ? <StopIcon /> : <MicIcon />}
                </button>
                <button
                  type="submit"
                  disabled={busy || (!input.trim() && !image && !doc)}
                  aria-label="Send message"
                  title="Send (Enter)"
                  className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-40"
                >
                  <SendIcon />
                </button>
              </div>
            </div>
            <p className="mt-2 hidden text-center text-xs text-muted sm:block">
              Enter to send, Shift+Enter for a new line
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
