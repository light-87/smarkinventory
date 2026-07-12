import { useState } from "react";
import {
  AppBar,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  FormControlLabel,
  TextField,
  Toolbar,
  Typography,
} from "@mui/material";
import type { BomPickerEntry } from "../lib/boms";
import { colors } from "../colors";

export interface OrderingConfig {
  lineLimit: number | null;
  /** Force sourcing every to-order line, ignoring any already sourced by a previous run. */
  resourceAll: boolean;
}

interface OrderingSetupProps {
  bom: BomPickerEntry;
  onBack: () => void;
  onStart: (config: OrderingConfig) => void;
}

/**
 * Ordering setup (plan: SmarkStock Desktop P2) — the line-limit knob mirrors
 * desktop/runner/run.ts's `--lines` flag (createDesktopRun's sandbox-test
 * limit, docs in lib/runs/enqueue.ts EnqueueRunInput). Leaving it blank runs
 * every to-order line on the BOM.
 */
export function OrderingSetup({ bom, onBack, onStart }: OrderingSetupProps) {
  const [lineLimitInput, setLineLimitInput] = useState("");
  const [resourceAll, setResourceAll] = useState(false);

  function handleStart() {
    const parsed = Number(lineLimitInput);
    const lineLimit = lineLimitInput.trim() && Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : null;
    onStart({ lineLimit, resourceAll });
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar>
          <Typography variant="h6">Ordering setup</Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 560, mx: "auto", p: 3 }}>
        <Card sx={{ mb: 3, borderTop: `3px solid ${colors.circuitBlue}` }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              {bom.projectName}
              {bom.projectClient ? ` (${bom.projectClient})` : ""}
            </Typography>
            <Typography color="text.secondary" sx={{ mb: 1, fontFamily: '"JetBrains Mono", monospace', fontSize: 14 }}>
              {bom.name}
            </Typography>
            <Chip
              size="small"
              label={`${bom.lineCount} line${bom.lineCount === 1 ? "" : "s"} total`}
              sx={{ fontFamily: '"JetBrains Mono", monospace' }}
            />
          </CardContent>
        </Card>

        <Card sx={{ mb: 3, borderTop: `3px solid ${colors.copper}` }}>
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
              Line limit
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Leave blank to source every to-order line on this BOM, or set a smaller number for a quick test run.
            </Typography>
            <TextField
              label="Lines to source"
              placeholder={`All ${bom.lineCount}`}
              type="number"
              slotProps={{ htmlInput: { min: 1 } }}
              value={lineLimitInput}
              onChange={(e) => setLineLimitInput(e.target.value)}
              fullWidth
            />
            <FormControlLabel
              sx={{ mt: 1.5, alignItems: "flex-start" }}
              control={<Checkbox checked={resourceAll} onChange={(e) => setResourceAll(e.target.checked)} sx={{ pt: 0 }} />}
              label={
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    Re-source everything
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    By default a re-run reuses lines already sourced before and only does the rest. Tick this to source every line from scratch.
                  </Typography>
                </Box>
              }
            />
          </CardContent>
        </Card>

        <Box sx={{ display: "flex", justifyContent: "space-between" }}>
          <Button onClick={onBack}>← Back to BOM list</Button>
          <Button variant="contained" size="large" onClick={handleStart}>
            Start sourcing
          </Button>
        </Box>
      </Box>
    </Box>
  );
}
