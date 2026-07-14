import { AppBar, Box, Button, Card, CardContent, List, ListItem, ListItemText, Toolbar, Typography } from "@mui/material";
import { colors } from "../colors";

interface SetupGuideProps {
  onClose: () => void;
}

/**
 * Static setup/help notes, reachable after login. Replaces the earlier
 * live prereq check (removed — its Claude CLI/browser detection didn't
 * reliably match what was actually installed, see run.ts's own comments in
 * desktop/README.md for the two real one-time manual steps this mirrors).
 */
export function SetupGuide({ onClose }: SetupGuideProps) {
  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="primary" elevation={0}>
        <Toolbar>
          <Typography variant="h6" sx={{ flexGrow: 1 }}>
            Setup &amp; how this app works
          </Typography>
          <Button color="inherit" onClick={onClose}>
            Close
          </Button>
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 640, mx: "auto", p: 3 }}>
        <Card sx={{ mb: 3, borderTop: `3px solid ${colors.copper}` }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              One-time prerequisites (per machine)
            </Typography>
            <List dense>
              <ListItem>
                <ListItemText
                  primary="Claude Code CLI installed and signed in"
                  secondary="Run `claude` once in any terminal and sign in with your own subscription or API key. This has to be your own account — it can't be automated."
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="Brave or Chrome installed"
                  secondary="The sourcing agent drives a real browser through this — Brave is recommended (brave.com)."
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="Browser MCP plugin available to Claude Code"
                  secondary="Normally resolves automatically on first sourcing run. If it fails to auto-download (seen on some Windows setups with antivirus/OneDrive file-locking), install a Playwright MCP plugin manually in Claude Code as a one-time fallback."
                />
              </ListItem>
            </List>
          </CardContent>
        </Card>

        <Card sx={{ mb: 3, borderTop: `3px solid ${colors.circuitBlue}` }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              How a sourcing run works
            </Typography>
            <List dense>
              <ListItem>
                <ListItemText primary="1. Pick a BOM" secondary="Any BOM you can see on the web app shows up here too." />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="2. Set a line limit (optional)"
                  secondary="Leave blank to source every to-order line, or set a small number for a quick test. A re-run reuses lines you already sourced before and only does the rest — tick “Re-source everything” to redo them all."
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="3. Start sourcing"
                  secondary="Opens a dedicated browser and a Claude Code terminal automatically — the sourcing instruction is already sent, nothing to type. Runs unsupervised; you can check back once it's done."
                />
              </ListItem>
              <ListItem>
                <ListItemText
                  primary="4. Review on the web — it stays live"
                  secondary="Results sync to the web as they're found — the review page updates on its own, no reload. The run stays LIVE: keep talking to the Claude window (e.g. “also check Mouser for line 12”) and new results keep syncing. Press “Finish & sync” when done — it always does a final upload. Changed something after finishing? Hit “Sync latest again” to re-upload. Long runs are fine — the app keeps your login fresh in the background."
                />
              </ListItem>
            </List>
          </CardContent>
        </Card>

        <Card sx={{ mb: 3, borderTop: `3px solid ${colors.circuitBlue}` }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              What the agent sees
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Every column from your BOM sheet is passed to the sourcing agent, including LCSC part numbers — when a line
              has an LCSC PN, the agent buys it straight from LCSC instead of guessing from the MPN. If an older BOM is
              missing its LCSC or supplier columns here, re-upload the sheet on the web app once and they'll come through.
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ borderTop: `3px solid ${colors.amber}` }}>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>
              If something looks wrong
            </Typography>
            <Typography variant="body2" color="text.secondary">
              "Recommended candidate fails the mandatory package rung" warnings usually mean the BOM's footprint data
              was empty for that line — not a bug, just a heads-up to double check that line before ordering. Nothing is
              ever lost: results are saved on this PC and keep syncing to the web while the run is live, so even if you
              close the window you can sign in again and re-run to pick up where you left off.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
}
