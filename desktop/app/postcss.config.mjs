// Local to desktop/app — Vite would otherwise walk up to the repo root's
// postcss.config.mjs (a Next.js/Tailwind-v4 config meant for the web app),
// so this file shadows it for the desktop UI's own build. Unlike Next.js,
// Vite's postcss loader doesn't auto-require string plugin names, so the
// plugin function itself is imported and invoked here.
import tailwindcss from "@tailwindcss/postcss";

export default {
  plugins: [tailwindcss()],
};
