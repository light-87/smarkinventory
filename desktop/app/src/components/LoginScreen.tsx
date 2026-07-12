import { useState } from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from "@mui/material";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import { supabase } from "../lib/supabase";
import { usernameToEmail } from "../lib/auth";
import { colors } from "../colors";

interface LoginScreenProps {
  onSignedIn: () => void;
}

/**
 * Mirrors components/auth/login-form.tsx (web app): username + password,
 * signInWithPassword against the synthetic {username}@smark.internal email,
 * then a smark_role() check — a valid session doesn't guarantee an active
 * smark_app_users row (deactivated accounts get NULL back).
 */
export function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setPending(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(username),
        password,
      });

      if (signInError) {
        setError("Incorrect username or password.");
        setPassword("");
        return;
      }

      const { data: role } = await supabase.rpc("smark_role");
      if (!role) {
        await supabase.auth.signOut();
        setError("This account has been deactivated. Contact your owner.");
        return;
      }

      onSignedIn();
    } finally {
      setPending(false);
    }
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundImage: `linear-gradient(160deg, ${colors.pcbGreen950} 0%, ${colors.pcbGreen700} 100%)`,
        p: 3,
      }}
    >
      <Paper
        elevation={8}
        sx={{
          width: "100%",
          maxWidth: 380,
          p: 4,
          pt: 3.5,
          borderRadius: 3,
          borderTop: `4px solid ${colors.copper}`,
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
        }}
      >
        <Box
          sx={{
            width: 44,
            height: 44,
            borderRadius: 2,
            mx: "auto",
            mb: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: '"JetBrains Mono", monospace',
            fontWeight: 700,
            color: "#fff",
            backgroundImage: `linear-gradient(135deg, ${colors.circuitBlue}, ${colors.pcbGreen800})`,
          }}
        >
          S
        </Box>
        <Typography variant="h5" align="center" sx={{ fontWeight: 700 }}>
          SmarkStock Desktop
        </Typography>
        <Typography variant="body2" align="center" color="text.secondary" sx={{ mt: 0.5, mb: 3 }}>
          Sign in with your normal SmarkStock login.
        </Typography>

        <form onSubmit={handleSubmit}>
          <TextField
            label="Username"
            placeholder="e.g. suresh"
            autoFocus
            fullWidth
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            error={Boolean(error)}
            sx={{ mb: 2 }}
          />
          <TextField
            label="Password"
            type={showPassword ? "text" : "password"}
            fullWidth
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={Boolean(error)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      onClick={() => setShowPassword((s) => !s)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            sx={{ mb: 1.5 }}
          />

          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Button
            type="submit"
            variant="contained"
            fullWidth
            size="large"
            disabled={pending}
            sx={{ mt: 1 }}
          >
            {pending ? <CircularProgress size={22} color="inherit" /> : "Log in"}
          </Button>
        </form>
      </Paper>
    </Box>
  );
}
