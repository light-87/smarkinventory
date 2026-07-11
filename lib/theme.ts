import { createTheme } from "@mui/material/styles";

/**
 * SmarkStock light design system ("Buddy" white theme) — raw tokens.
 *
 * Mirrors app/globals.css (new_design/). Use Tailwind utilities in JSX; reach
 * for this object only where CSS classes can't go (charts, canvas, emails,
 * MUI `sx`). `accent` is cobalt (links/interactive); the lime CTA is a
 * Tailwind-only concern (components/ui/button.tsx), not surfaced here.
 */
export const smk = {
  /* surfaces (white/paper) */
  canvas: "#fcfcfd",
  surface: "#ffffff",
  surfacePanel: "#fafbfc",
  surfaceWell: "#f4f6fa",
  surfaceRaised: "#f0f2f7",
  surfaceHover: "#f5f7fb",
  surfaceAccent: "#eef3ff",
  surfaceAccentHover: "#e3ecff",
  ash: "#f0f2f7",
  /* borders (light hairline) */
  border: "#e6e9f2",
  borderStrong: "#d5d9e8",
  borderDivider: "#e6e9f2",
  borderFaint: "#eef0f6",
  borderHairline: "#eef0f6",
  graphite: "#b6bccb",
  /* text (dark ink tiers) */
  text: "#1d2130",
  textSecondary: "#474950",
  textTertiary: "#6b6d72",
  textFaint: "#9aa0ad",
  /* accent (cobalt) + danger red + amber caution */
  accent: "#1a67fd",
  accentHover: "#1550d0",
  accentSoft: "#dc2626",
  warn: "#b45309",
  /* success green (readable on white) */
  success: "#15a05f",
  /* type */
  fontSans:
    'var(--font-ibm-plex-sans), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontMono:
    "var(--font-ibm-plex-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
} as const;

/**
 * MUI light theme mirroring the design system, so any MUI component dropped
 * into the app (pickers, menus, dialogs, tooltips…) matches the Tailwind-built
 * kit in components/ui.
 *
 * Rules:
 *  - buttons and chips are pills (9999px); cards/dialogs are 16px
 *  - surfaces separate with 1px hairline borders, never heavy shadows
 *  - weights top out at 500 — no bold anywhere
 *  - cobalt #1a67fd marks interactivity; errors/warnings speak in red #dc2626
 */
export const muiTheme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: smk.accent,
      dark: smk.accentHover,
      light: smk.accentSoft,
      contrastText: smk.canvas,
    },
    secondary: { main: smk.textSecondary, contrastText: smk.canvas },
    success: { main: smk.success, contrastText: smk.canvas },
    warning: { main: smk.warn, contrastText: "#fff" },
    error: { main: smk.accentSoft, contrastText: "#fff" },
    info: { main: smk.textSecondary, contrastText: smk.canvas },
    background: { default: smk.canvas, paper: smk.surface },
    divider: smk.border,
    text: {
      primary: smk.text,
      secondary: smk.textSecondary,
      disabled: smk.textFaint,
    },
    action: {
      hover: "rgba(0, 0, 0, 0.04)",
      selected: "rgba(26, 103, 253, 0.10)",
      disabledOpacity: 0.4,
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: smk.fontSans,
    fontWeightLight: 400,
    fontWeightRegular: 400,
    fontWeightMedium: 500,
    fontWeightBold: 500,
    h1: {
      fontSize: 36,
      fontWeight: 400,
      lineHeight: 1.2,
      letterSpacing: "-0.252px",
    },
    h2: {
      fontSize: 24,
      fontWeight: 400,
      lineHeight: 1.33,
      letterSpacing: "-0.168px",
    },
    h3: {
      fontSize: 18,
      fontWeight: 500,
      lineHeight: 1.38,
      letterSpacing: "-0.126px",
    },
    h4: { fontSize: 16, fontWeight: 500, lineHeight: 1.5 },
    h5: { fontSize: 15, fontWeight: 500, lineHeight: 1.4 },
    h6: { fontSize: 14, fontWeight: 500, lineHeight: 1.43 },
    subtitle1: { fontSize: 15, fontWeight: 500, lineHeight: 1.4 },
    subtitle2: { fontSize: 13, fontWeight: 500, lineHeight: 1.4 },
    body1: { fontSize: 14, lineHeight: 1.43, letterSpacing: "-0.098px" },
    body2: { fontSize: 13, lineHeight: 1.46 },
    caption: { fontSize: 12, lineHeight: 1.5 },
    overline: {
      fontSize: 11,
      fontWeight: 500,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    },
    button: {
      fontSize: 14,
      fontWeight: 500,
      textTransform: "none",
      letterSpacing: "-0.007em",
    },
  },
  components: {
    MuiButtonBase: {
      defaultProps: { disableRipple: true },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 9999,
          textTransform: "none",
          fontWeight: 500,
          minHeight: 38,
          paddingInline: 18,
          boxShadow: "none",
        },
        outlined: {
          borderColor: smk.border,
          color: smk.text,
          "&:hover": {
            borderColor: smk.border,
            backgroundColor: smk.ash,
          },
        },
        text: {
          color: smk.textTertiary,
          "&:hover": {
            color: smk.text,
            backgroundColor: smk.surfaceRaised,
          },
        },
        sizeSmall: { minHeight: 30, paddingInline: 14, fontSize: 12 },
        sizeLarge: { minHeight: 44, paddingInline: 22, fontSize: 14 },
      },
      // MUI 9 dropped the combined `containedPrimary` / `outlinedPrimary`
      // classKeys in favor of prop-matched variants for colour+variant combos.
      variants: [
        {
          props: { variant: "contained", color: "primary" },
          style: {
            color: smk.canvas,
            "&:hover": { backgroundColor: smk.accentHover, boxShadow: "none" },
          },
        },
        {
          props: { variant: "outlined", color: "primary" },
          style: {
            borderColor: smk.accent,
            color: smk.text,
            "&:hover": {
              borderColor: smk.accent,
              backgroundColor: smk.surfaceAccentHover,
            },
          },
        },
      ],
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: "none",
          backgroundColor: smk.surface,
          border: `1px solid ${smk.border}`,
          borderRadius: 16,
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: "rgba(252, 252, 253, 0.85)",
          backdropFilter: "blur(8px)",
          backgroundImage: "none",
          boxShadow: "none",
          border: "none",
          borderBottom: `1px solid ${smk.border}`,
          borderRadius: 0,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: smk.surface,
          backgroundImage: "none",
          border: "none",
          borderLeft: `1px solid ${smk.border}`,
          borderRadius: 0,
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: smk.surface,
          backgroundImage: "none",
          border: `1px solid ${smk.border}`,
          borderRadius: 16,
        },
      },
    },
    MuiMenu: {
      styleOverrides: {
        paper: {
          backgroundColor: smk.surfaceRaised,
          backgroundImage: "none",
          border: `1px solid ${smk.border}`,
          borderRadius: 12,
        },
        list: { padding: 6 },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: 13,
          borderRadius: 8,
          color: smk.textSecondary,
          "&:hover": { backgroundColor: smk.ash, color: smk.text },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: smk.surfaceWell,
          borderRadius: 8,
          "& .MuiOutlinedInput-notchedOutline": { borderColor: smk.border },
          "&:hover .MuiOutlinedInput-notchedOutline": {
            borderColor: smk.borderStrong,
          },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": {
            borderColor: smk.accent,
            borderWidth: 1,
          },
        },
        input: {
          "&::placeholder": { color: smk.textTertiary, opacity: 1 },
        },
      },
    },
    MuiInputLabel: {
      styleOverrides: {
        root: {
          color: smk.textTertiary,
          "&.Mui-focused": { color: smk.accent },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 9999 },
        outlined: { borderColor: smk.border },
      },
    },
    MuiDivider: {
      styleOverrides: { root: { borderColor: smk.borderDivider } },
    },
    MuiTableCell: {
      styleOverrides: {
        root: {
          borderBottom: `1px solid ${smk.borderHairline}`,
          padding: "11px 14px",
        },
        head: {
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: smk.textTertiary,
          backgroundColor: smk.canvas,
          borderBottom: `1px solid ${smk.border}`,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: smk.surfaceRaised,
          border: `1px solid ${smk.border}`,
          color: smk.text,
          fontSize: 12,
          borderRadius: 8,
          padding: "6px 10px",
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { textTransform: "none", fontSize: 13, fontWeight: 500 },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        root: { backgroundColor: smk.ash, borderRadius: 9999, height: 4 },
        bar: { borderRadius: 9999 },
      },
    },
    MuiSkeleton: {
      styleOverrides: { root: { backgroundColor: smk.surfaceRaised } },
    },
  },
});
