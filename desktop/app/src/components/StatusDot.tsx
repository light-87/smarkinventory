import { Box, Typography } from "@mui/material";
import { colors } from "../colors";

const STATUS_DOT_COLOR: Record<string, string> = {
  pending: "#9AA5A0",
  in_progress: colors.circuitBlue,
  review: colors.amber,
  done: colors.traceGreen,
};

/**
 * LED-indicator status pill — reads closer to a bench instrument's status
 * light than a generic MUI Chip, matching the sourced-parts/lab-equipment
 * vocabulary the rest of the app leans into.
 */
export function StatusDot({ status }: { status: string }) {
  const dot = STATUS_DOT_COLOR[status] ?? STATUS_DOT_COLOR.pending;
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      <Box
        sx={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          bgcolor: dot,
          boxShadow: `0 0 6px ${dot}`,
        }}
      />
      <Typography variant="caption" sx={{ fontFamily: '"JetBrains Mono", monospace', color: "text.secondary" }}>
        {status}
      </Typography>
    </Box>
  );
}
