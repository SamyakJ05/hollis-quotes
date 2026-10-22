import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) loads a .wasm file at runtime; bundling breaks that.
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
