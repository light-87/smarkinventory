import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Repo root is the app root — stops Next/Turbopack inferring a parent
  // workspace root when stray lockfiles exist further up the tree.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: __dirname,
  // The order-cart PDF route reads embedded TTFs at runtime (lib/runs/review-pdf.ts) —
  // Next's tracer can't see fs.readFileSync paths, so ship the fonts into that function.
  outputFileTracingIncludes: {
    "/api/runs/[runId]/review-pdf": ["./lib/runs/fonts/**"],
  },
};

export default nextConfig;
