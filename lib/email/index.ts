/**
 * lib/email/index.ts — Resend: the ONE outbound-email seam.
 *
 * Mirrors lib/storage/index.ts's env-gating shape (see that file's header):
 * a single provider, no local-disk-style fallback adapter, but the same
 * "don't throw on import, don't throw on a misconfigured send" contract —
 * `sendEmail()` env-gates itself (checks `RESEND_API_KEY` / `EMAIL_FROM` at
 * CALL time, not at module-load time) so importing this module, or calling
 * it from code that runs in local dev / CI / a build without the key set,
 * never throws. Instead it logs a warning and returns `{ ok: false, skipped:
 * true, reason }` — callers (lib/reminders/*) treat a skipped send as
 * "recorded, not delivered", never as a thrown error, so a missing key can
 * never crash a server action or the cron route.
 *
 * `EMAIL_FROM` must be a verified-domain address in the Resend account (the
 * app owner sets this — see .env.local.example's comment). This module does
 * NOT verify the domain itself; a bad from-address surfaces as a Resend API
 * error at send time, returned in `SendEmailResult.error`.
 */

import { Resend } from "resend";

export interface SendEmailInput {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

export interface SendEmailResult {
  ok: boolean;
  /** True when no send was attempted because RESEND_API_KEY/EMAIL_FROM isn't set. */
  skipped?: boolean;
  /** Resend message id, when a send actually happened and succeeded. */
  id?: string;
  /** Present when `ok` is false — either the skip reason or the provider's error message. */
  error?: string;
}

let cachedClient: Resend | null = null;

function getClient(apiKey: string): Resend {
  if (!cachedClient) cachedClient = new Resend(apiKey);
  return cachedClient;
}

/**
 * Sends one email via Resend. Env-gated: if `RESEND_API_KEY` or `EMAIL_FROM`
 * isn't set, this logs a warning and resolves `{ ok: false, skipped: true }`
 * instead of throwing — so local/CI/dev without a key still builds and runs.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    const reason = "RESEND_API_KEY / EMAIL_FROM not set — email send skipped (see .env.local.example).";
    console.warn(`[email] ${reason}`);
    return { ok: false, skipped: true, error: reason };
  }

  if (!input.html && !input.text) {
    return { ok: false, error: "sendEmail: at least one of html/text is required." };
  }

  try {
    const resend = getClient(apiKey);
    const { data, error } = await resend.emails.send({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    } as Parameters<typeof resend.emails.send>[0]);

    if (error) {
      console.error(`[email] Resend send failed: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[email] Resend send threw: ${message}`);
    return { ok: false, error: message };
  }
}
