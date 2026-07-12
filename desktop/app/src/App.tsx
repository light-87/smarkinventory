import { useEffect, useState } from "react";
import { Box, CircularProgress } from "@mui/material";
import { LoginScreen } from "./components/LoginScreen";
import { BomPicker } from "./components/BomPicker";
import { OrderingSetup, type OrderingConfig } from "./components/OrderingSetup";
import { RunProgress } from "./components/RunProgress";
import { SetupGuide } from "./components/SetupGuide";
import { supabase } from "./lib/supabase";
import type { BomPickerEntry } from "./lib/boms";

type AuthState = { status: "loading" } | { status: "signedOut" } | { status: "signedIn"; email: string };

function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [selectedBom, setSelectedBom] = useState<BomPickerEntry | null>(null);
  const [orderingConfig, setOrderingConfig] = useState<OrderingConfig | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAuth(session ? { status: "signedIn", email: session.user.email ?? "" } : { status: "signedOut" });
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuth(session ? { status: "signedIn", email: session.user.email ?? "" } : { status: "signedOut" });
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

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

  if (showGuide) {
    return <SetupGuide onClose={() => setShowGuide(false)} />;
  }

  if (!selectedBom) {
    return <BomPicker onSelect={setSelectedBom} onShowGuide={() => setShowGuide(true)} />;
  }

  if (!orderingConfig) {
    return (
      <OrderingSetup
        bom={selectedBom}
        onBack={() => setSelectedBom(null)}
        onStart={setOrderingConfig}
      />
    );
  }

  return (
    <RunProgress
      bom={selectedBom}
      config={orderingConfig}
      onBack={() => setOrderingConfig(null)}
    />
  );
}

export default App;
