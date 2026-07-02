import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Repo root is the app root — stops Next/Turbopack inferring a parent
  // workspace root when stray lockfiles exist further up the tree.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
