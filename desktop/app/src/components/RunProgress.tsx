import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AppBar, Box, Button, Paper, Toolbar, Typography } from "@mui/material";
import type { BomPickerEntry } from "../lib/boms";
import type { OrderingConfig } from "./OrderingSetup";
import { supabase } from "../lib/supabase";
import { colors } from "../colors";

const WEB_BASE = import.meta.env.VITE_WEB_BASE_URL ?? "http://localhost:3000";

interface RunProgressProps {
  bom: BomPickerEntry;
  config: OrderingConfig;
  onBack: () => void;
}

/**
 * Wraps desktop/runner (compiled as the "smarkstock-runner" Tauri sidecar,
 * see src-tauri/src/lib.rs start_sourcing_run) — same flow the CLI already
 * proved end-to-end (P1c, docs/TESTING-FINDINGS.md): sign-in reuse → REST
 * prefetch → dedicated Brave → Claude Code session → results.json →
 * transform → upload → review link. This view just surfaces its stdout.
 */
export function RunProgress({ bom, config, onBack }: RunProgressProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState<{ code: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    let unlistenProgress: (() => void) | undefined;
    let unlistenComplete: (() => void) | undefined;

    async function start() {
      // React 18 StrictMode (dev only) mounts, cleans up, then re-mounts —
      // without this guard the sidecar (a real subprocess with real side
      // effects: launches a browser + a Claude Code session) gets spawned
      // twice per screen visit.
      if (startedRef.current) return;
      startedRef.current = true;

      unlistenProgress = await listen<string>("run-progress", (event) => {
        setLines((prev) => [...prev, event.payload]);
      });
      unlistenComplete = await listen<number>("run-complete", (event) => {
        setDone({ code: event.payload });
      });

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const refreshToken = data.session?.refresh_token;
      if (!token || !refreshToken) {
        setError("No active session — please sign in again.");
        return;
      }

      try {
        await invoke("start_sourcing_run", {
          bomId: bom.id,
          lineLimit: config.lineLimit,
          webBase: WEB_BASE,
          accessToken: token,
          // Lets the runner refresh the token before uploading results, so a
          // long run doesn't fail with "Not signed in" when the token expires.
          refreshToken,
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
          supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
          // false → server reuses lines already sourced by the previous run.
          resourceAll: config.resourceAll,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void start();
    return () => {
      unlistenProgress?.();
      unlistenComplete?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per mount, same as the CLI's one-shot flow
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  const reviewMatch = lines.join("\n").match(/Review it on the web: (\S+)/);
  const runId = reviewMatch?.[1].match(/runs\/([^/]+)\/review/)?.[1] ?? null;
  const [finishing, setFinishing] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // "Finish & sync": ask the runner to flush + exit cleanly (via the sentinel
  // file) — the run-complete event then flips us to done. Not a hard kill, so
  // the final results always upload.
  async function handleFinish() {
    setFinishing(true);
    try {
      await invoke("finish_sourcing_run");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFinishing(false);
    }
  }

  // Abandon: hard-kill without a final flush.
  async function handleAbandon() {
    try {
      await invoke("cancel_sourcing_run");
    } finally {
      setDone({ code: -1 });
    }
  }

  // "Sync latest again": re-upload this run's results.json from disk — works
  // even after Finish, so late edits in the Claude window still reach the web.
  async function handleSyncAgain() {
    if (!runId) return;
    setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const refreshToken = data.session?.refresh_token;
      if (!token || !refreshToken) {
        setError("No active session — please sign in again.");
        return;
      }
      await invoke("sync_run_again", {
        runId,
        webBase: WEB_BASE,
        accessToken: token,
        refreshToken,
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar>
          <Typography variant="h6">
            Sourcing {bom.name} ({config.lineLimit ?? bom.lineCount} line{(config.lineLimit ?? bom.lineCount) === 1 ? "" : "s"})
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 720, mx: "auto", p: 3 }}>
        {/* The signature: a live serial-console readout for the sourcing agent,
            not a plain scroll box — phosphor-green mono text on a soldermask-dark
            panel, a copper edge like a board's edge connector, and a blinking
            cursor while the run is still going (the one animated touch here). */}
        <Paper
          ref={logRef}
          elevation={6}
          sx={{
            p: 2,
            height: 420,
            overflowY: "auto",
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: 13,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            bgcolor: colors.pcbGreen950,
            color: colors.traceGreen,
            borderTop: `3px solid ${colors.copper}`,
            borderRadius: "4px",
            boxShadow: `0 8px 24px rgba(11,31,23,0.35)`,
          }}
        >
          {lines.length === 0 && !error ? "Starting…" : lines.join("\n")}
          {!done && !error && (
            <Box
              component="span"
              sx={{
                display: "inline-block",
                width: "8px",
                height: "15px",
                ml: "2px",
                bgcolor: colors.traceGreen,
                verticalAlign: "text-bottom",
                animation: "smark-cursor-blink 1s steps(1) infinite",
                "@keyframes smark-cursor-blink": {
                  "50%": { opacity: 0 },
                },
              }}
            />
          )}
        </Paper>

        {error && (
          <Typography color="error" sx={{ mt: 2 }}>
            {error}
          </Typography>
        )}

        {reviewMatch && (
          <Box sx={{ mt: 2, display: "flex", flexDirection: "column", gap: 1 }}>
            <Button variant="contained" onClick={() => window.open(reviewMatch[1], "_blank")}>
              Open review on the web
            </Button>
            {!done && (
              <Typography variant="caption" color="text.secondary">
                Still live — results sync to the web on their own as they come in. Keep talking to the Claude window if you want more; press “Finish &amp; sync” below when you're done.
              </Typography>
            )}
            {done && (
              <Button variant="outlined" color="success" onClick={handleSyncAgain} disabled={syncing || !runId}>
                {syncing ? "Syncing…" : "↺ Sync latest again"}
              </Button>
            )}
          </Box>
        )}

        {done && !reviewMatch && (
          <Typography sx={{ mt: 2 }} color={done.code === 0 ? "text.secondary" : "error"}>
            {done.code === -1 ? "Cancelled." : `Runner exited with code ${done.code}.`}
          </Typography>
        )}

        <Box sx={{ mt: 3, display: "flex", justifyContent: "space-between" }}>
          <Button onClick={onBack}>← Back to ordering setup</Button>
          {!done &&
            (reviewMatch ? (
              <Button variant="contained" color="success" onClick={handleFinish} disabled={finishing}>
                {finishing ? "Finishing…" : "Finish & sync"}
              </Button>
            ) : (
              <Button color="error" onClick={handleAbandon}>
                Cancel run
              </Button>
            ))}
        </Box>
      </Box>
    </Box>
  );
}
