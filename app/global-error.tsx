"use client";

/**
 * app/global-error.tsx — last-resort boundary, for errors thrown by the root
 * layout itself (or by anything outside the `(app)` group, e.g. /login).
 * It replaces the whole document, so it renders its own <html>/<body> and
 * cannot rely on the app's stylesheet — everything here is inline.
 *
 * `app/(app)/error.tsx` handles the normal case and keeps the shell; this one
 * only shows up when even that can't render.
 */

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "#dfe9fc",
          color: "#14161c",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <main
          style={{
            maxWidth: 420,
            width: "100%",
            background: "#fff",
            border: "1px solid #d6ddea",
            borderRadius: 16,
            padding: 24,
          }}
        >
          <h1 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 600 }}>SmarkStock hit a problem</h1>
          <p style={{ margin: "0 0 4px", fontSize: 15, lineHeight: 1.5 }}>
            The app couldn&apos;t load this screen. Nothing you saved has been lost.
          </p>
          <p style={{ margin: "0 0 16px", fontSize: 13, color: "#5b6577", lineHeight: 1.5 }}>
            Try again, or reload the page. If it keeps happening, log out and back in.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                cursor: "pointer",
                border: "none",
                borderRadius: 999,
                padding: "10px 18px",
                fontSize: 15,
                fontWeight: 500,
                background: "#c8f065",
                color: "#14161c",
              }}
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                cursor: "pointer",
                borderRadius: 999,
                border: "1px solid #d6ddea",
                padding: "10px 18px",
                fontSize: 15,
                background: "transparent",
                color: "#14161c",
              }}
            >
              Reload page
            </button>
          </div>
          {error.digest && (
            <p style={{ margin: "16px 0 0", fontSize: 12, color: "#8b93a3" }}>Reference: {error.digest}</p>
          )}
        </main>
      </body>
    </html>
  );
}
