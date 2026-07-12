import { createTheme } from "@mui/material/styles";
import { colors } from "./colors";

// Circuit blue (#1976D2, ~/.claude/CLAUDE.md "UI & design defaults") stays
// the one locked brand color — reserved for actions/links. Everything else
// (AppBar gradient, terminal styling) is the PCB-inspired palette in
// colors.ts, applied per-screen since MUI's palette typing doesn't cover
// arbitrary custom tokens without augmentation overhead this app doesn't need.
export const theme = createTheme({
  palette: {
    primary: { main: colors.circuitBlue },
    secondary: { main: colors.copper },
    background: {
      // Faint soldermask-green tint instead of stock MUI grey — barely
      // perceptible but keeps every screen tied to the same palette family.
      default: "#F3F6F4",
      paper: "#FFFFFF",
    },
  },
  typography: {
    fontFamily: '"Inter", Avenir, Helvetica, Arial, sans-serif',
    h5: { fontWeight: 700, letterSpacing: -0.2 },
    h6: { fontWeight: 600 },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: `linear-gradient(135deg, ${colors.pcbGreen950} 0%, ${colors.pcbGreen800} 100%)`,
          borderBottom: `2px solid ${colors.copper}`,
          color: colors.silk,
        },
      },
    },
  },
});
