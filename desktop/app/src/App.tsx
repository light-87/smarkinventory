import { useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress } from "@mui/material";
import { getVersion } from "@tauri-apps/api/app";
import { LoginScreen } from "./components/LoginScreen";
import { BomPicker } from "./components/BomPicker";
import { OrderingSetup, type OrderingConfig } from "./components/OrderingSetup";
import { RunProgress } from "./components/RunProgress";
import { SetupGuide } from "./components/SetupGuide";
import { supabase } from "./lib/supabase";
import type { BomPickerEntry } from "./lib/boms";

const WEB_BASE = import.meta.env.VITE_WEB_BASE_URL ?? "http://localhost:3000";

type AuthState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; email: string };

/** true if semver `a` is strictly older than `b` (numeric, dot-separated). */
function isOlder(a: string, b: string): boolean {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [selectedBom, setSelectedBom] = useState<BomPickerEntry | null>(null);
  const [orderingConfig, setOrderingConfig] = useState<OrderingConfig | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [updateLatest, setUpdateLatest] = useState<string | null>(null);
  const [updateDismissed, setUpdateDismissed] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth(session ? { status: "signedIn", email: session.user.email ?? "" } : { status: "signedOut" });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(session ? { status: "signedIn", email: session.user.email ?? "" } : { status: "signedOut" });
    });

    // Nag if this install is behind the latest published version.
    (async () => {
      try {
        const [current, res] = await Promise.all([getVersion(), fetch(`${WEB_BASE}/api/desktop/version`)]);
        const { latest } = (await res.json()) as { latest?: string };
        if (latest && isOlder(current, latest)) setUpdateLatest(latest);
      } catch {
        // offline / old server — no banner
      }
    })();

    return () => subscription.subscription.unsubscribe();
  }, []);

  const updateBanner =
    updateLatest && !updateDismissed ? (
      <Alert
        severity="warning"
        onClose={() => setUpdateDismissed(true)}
        action={
          <Button color="inherit" size="small" onClick={() => window.open(`${WEB_BASE}/api/desktop/download`, "_blank")}>
            Download &amp; reinstall
          </Button>
        }
        sx={{ borderRadius: 0 }}
      >
        A newer version (v{updateLatest}) of SmarkStock Desktop is available — please update.
      </Alert>
    ) : null;

  if (auth.status === "loading") {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (auth.status === "signedOut") {
    return <LoginScreen onSignedIn={() => {}} />;
  }

  const screen = showGuide ? (
    <SetupGuide onClose={() => setShowGuide(false)} />
  ) : !selectedBom ? (
    <BomPicker onSelect={setSelectedBom} onShowGuide={() => setShowGuide(true)} />
  ) : !orderingConfig ? (
    <OrderingSetup bom={selectedBom} onBack={() => setSelectedBom(null)} onStart={setOrderingConfig} />
  ) : (
    <RunProgress bom={selectedBom} config={orderingConfig} onBack={() => setOrderingConfig(null)} />
  );

  return (
    <>
      {updateBanner}
      {screen}
    </>
  );
}

export default App;
