import { createTheme } from "@mui/material/styles";

/**
 * SmarkStock locked dark design system — raw tokens.
 *
 * Single source: /tokens.json + /theme.css (locked) + the approved prototype
 * (SmarkStock-prototype/SmarkStock.dc.html). Use Tailwind utilities from
 * app/globals.css in JSX; reach for this object only where CSS classes can't
 * go (charts, canvas, emails, MUI `sx`).
 */
export const smk = {
  /* surfaces */
  canvas: "#121212",
  surface: "#141414",
  surfacePanel: "#131313",
  surfaceWell: "#0f0f0f",
  surfaceRaised: "#1c1c1c",
  surfaceHover: "#181818",
  surfaceAccent: "#161210",
  surfaceAccentHover: "#1a1411",
  ash: "#242424",
  /* borders */
  border: "#2e2e2e",
  borderStrong: "#393939",
  borderDivider: "#232323",
  borderFaint: "#1e1e1e",
  borderHairline: "#1a1a1a",
  graphite: "#4d4d4d",
  /* text */
  text: "#fafafa",
  textSecondary: "#b4b4b4",
  textTertiary: "#898989",
  textFaint: "#5a5a5a",
  /* accent */
  accent: "#f57d05",
  accentHover: "#c25e02",
  accentSoft: "#ff9a3c",
  /* rationed green from the locked palette (positive/success only) */
  success: "#3ecf8e",
  /* type */
  fontSans:
    'var(--font-inter), ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  fontMono:
    "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
} as const;

/**
 * MUI dark theme mirroring the locked design system, so any MUI component
 * dropped into the app (pickers, menus, dialogs, tooltips…) matches the
 * Tailwind-built kit in components/ui.
 *
 * Rules ported from the prototype:
 *  - buttons and chips are pills (9999px); cards/dialogs are 16px
 *  - surfaces separate with 1px borders, never shadows
 *  - weights top out at 500 — no bold anywhere
 *  - orange #f57d05 is the only CTA color; errors/warnings speak in the soft
 *    orange #ff9a3c, never red
 */
export const muiTheme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: smk.accent,
      dark: smk.accentHover,
      light: smk.accentSoft,
      contrastText: smk.canvas,
    },
    secondary: { main: smk.textSecondary, contrastText: smk.canvas },
    success: { main: smk.success, contrastText: smk.canvas },
    warning: { main: smk.accentSoft, contrastText: smk.canvas },
    error: { main: smk.accentSoft, contrastText: smk.canvas },
    info: { main: smk.textSecondary, contrastText: smk.canvas },
    background: { default: smk.canvas, paper: smk.surface },
    divider: smk.border,
    text: {
      primary: smk.text,
      secondary: smk.textSecondary,
      disabled: smk.textFaint,
    },
    action: {
      hover: "rgba(255, 255, 255, 0.04)",
      selected: "rgba(245, 125, 5, 0.10)",
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
          backgroundColor: "rgba(18, 18, 18, 0.86)",
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
