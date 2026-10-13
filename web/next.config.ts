import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: false, // gzip can hold back streamed text until the reply ends
  experimental: {
    // The default proxy body limit is 10 MB, which would cut off uploads the API accepts.
    proxyClientMaxBodySize: "20mb",
    // Indexing a document can take up to two minutes.
    proxyTimeout: 180_000,
  },
  async rewrites() {
    const api = process.env.API_URL ?? "http://localhost:8000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
