import { useEffect, useState } from "react";
import {
  Alert,
  AppBar,
  Box,
  Chip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemText,
  Toolbar,
  Typography,
} from "@mui/material";
import { fetchBomsForPicker, type BomPickerEntry } from "../lib/boms";
import { supabase } from "../lib/supabase";
import { colors } from "../colors";
import { StatusDot } from "./StatusDot";

interface BomPickerProps {
  onSelect: (bom: BomPickerEntry) => void;
  onShowGuide: () => void;
}

export function BomPicker({ onSelect, onShowGuide }: BomPickerProps) {
  const [boms, setBoms] = useState<BomPickerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchBomsForPicker()
      .then(setBoms)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar sx={{ justifyContent: "space-between" }}>
          <Typography variant="h6">SmarkStock Desktop — pick a BOM to source</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Chip
              label="Setup & help"
              onClick={onShowGuide}
              sx={{ bgcolor: "rgba(255,255,255,0.15)", color: "white", cursor: "pointer" }}
            />
            <Chip
              label="Sign out"
              onClick={() => supabase.auth.signOut()}
              sx={{ bgcolor: "rgba(255,255,255,0.15)", color: "white", cursor: "pointer" }}
            />
          </Box>
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 720, mx: "auto", p: 3 }}>
        {error && <Alert severity="error">{error}</Alert>}

        {!error && boms === null && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {boms !== null && boms.length === 0 && (
          <Typography color="text.secondary" align="center" sx={{ mt: 6 }}>
            No BOMs found. Upload one on the web app first.
          </Typography>
        )}

        {boms !== null && boms.length > 0 && (
          <List sx={{ bgcolor: "background.paper", borderRadius: 2, overflow: "hidden", boxShadow: "0 4px 16px rgba(11,31,23,0.08)" }}>
            {boms.map((bom) => (
              <ListItemButton
                key={bom.id}
                onClick={() => onSelect(bom)}
                divider
                sx={{
                  borderLeft: `3px solid ${colors.copper}`,
                  transition: "background-color 120ms ease",
                  "&:hover": { bgcolor: "rgba(201,122,61,0.06)" },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                      <Typography component="span" sx={{ fontWeight: 600 }}>
                        {bom.name}
                      </Typography>
                      <StatusDot status={bom.sourcingStatus} />
                    </Box>
                  }
                  secondary={
                    <Typography
                      component="span"
                      variant="body2"
                      sx={{ color: "text.secondary", fontFamily: '"JetBrains Mono", monospace', fontSize: 12.5 }}
                    >
                      {bom.projectName}
                      {bom.projectClient ? ` (${bom.projectClient})` : ""} · {bom.lineCount} line
                      {bom.lineCount === 1 ? "" : "s"}
                    </Typography>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
}
