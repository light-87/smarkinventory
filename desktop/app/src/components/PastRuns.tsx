import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Button, Card, CardContent, CircularProgress, Typography } from "@mui/material";
import { supabase } from "../lib/supabase";
import { colors } from "../colors";

const WEB_BASE = import.meta.env.VITE_WEB_BASE_URL ?? "http://localhost:3000";

/** One saved session on disk (Rust list_local_sessions, camelCase-serialized). */
interface LocalSession {
  runId: string;
  bomId: string;
  lineCount: number;
  resultLines: number;
  complete: boolean;
  modifiedMs: number;
}

interface PastRunsProps {
  bomId: string;
  /** Resume this saved run (relaunch browser + Claude terminal on it, keep syncing). */
  onResume: (runId: string) => void;
}

function formatWhen(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * "Past runs on this computer" — every sourcing run leaves a session folder
 * under ~/.smarkstock-sessions/<runId>/; this lists the ones for the selected
 * BOM so the user can re-open one (continue sourcing where it left off) or push
 * its saved results to the web again without starting over. Renders nothing
 * when there are no saved runs for this BOM.
 */
export function PastRuns({ bomId, onResume }: PastRunsProps) {
  const [sessions, setSessions] = useState<LocalSession[] | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    invoke<LocalSession[]>("list_local_sessions")
      .then((all) => {
        if (alive) setSessions(all.filter((s) => s.bomId === bomId));
      })
      .catch(() => {
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [bomId]);

  // "Re-sync": re-upload a saved run's results.json from disk (the runner's
  // upload-only mode) — no browser/terminal, just pushes results to the web.
  async function handleResync(runId: string) {
    setSyncingId(runId);
    setNote(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      const refreshToken = data.session?.refresh_token;
      if (!token || !refreshToken) {
        setNote("No active session — please sign in again.");
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
      setNote("Re-synced — refresh the review on the web.");
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingId(null);
    }
  }

  if (sessions === null) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (sessions.length === 0) return null;

  return (
    <Card sx={{ mb: 3, borderTop: `3px solid ${colors.traceGreen}` }}>
      <CardContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Past runs on this computer
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Re-open a saved run to keep sourcing where it left off, or push its saved results to the web again.
        </Typography>

        {sessions.map((s) => (
          <Box
            key={s.runId}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              py: 1.25,
              borderTop: "1px solid rgba(0,0,0,0.08)",
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontFamily: '"JetBrains Mono", monospace' }}>
                {s.runId.slice(0, 8)} · {formatWhen(s.modifiedMs)}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {s.resultLines}/{s.lineCount} lines{s.complete ? " · complete" : ""}
              </Typography>
            </Box>
            <Button size="small" variant="contained" onClick={() => onResume(s.runId)}>
              Resume ▶
            </Button>
            <Button size="small" onClick={() => handleResync(s.runId)} disabled={syncingId === s.runId}>
              {syncingId === s.runId ? "Syncing…" : "↺ Re-sync"}
            </Button>
          </Box>
        ))}

        {note && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
            {note}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
