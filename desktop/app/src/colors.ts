/**
 * SmarkStock Desktop palette — drawn from the subject, not a generic SaaS
 * default: PCB soldermask green for dark surfaces, copper for the brand
 * accent (trace/solder), phosphor green for the "live" terminal, amber for
 * the caution states the ordering-rule guard already flags. Circuit blue
 * (#1976D2) stays the one locked brand color (~/.claude/CLAUDE.md) and is
 * reserved for actions — everything else is new vocabulary layered around it.
 */
export const colors = {
  circuitBlue: "#1976D2",
  copper: "#C97A3D",
  copperLight: "#E0A870",
  pcbGreen950: "#0B1F17",
  pcbGreen800: "#123626",
  pcbGreen700: "#1A4530",
  traceGreen: "#6FE3A6",
  amber: "#F2A93B",
  silk: "#EAF2ED",
} as const;
