import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WASM and must not be bundled by webpack.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Migrations are read from disk at startup, so ship them with every server function.
  outputFileTracingIncludes: { "/**": ["./drizzle/**"] },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ggpht.com" },
      { protocol: "https", hostname: "**.googleusercontent.com" },
      { protocol: "https", hostname: "**.fbcdn.net" },
      { protocol: "https", hostname: "**.cdninstagram.com" },
    ],
  },
};

export default nextConfig;
