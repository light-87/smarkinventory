/**
 * lib/labels/qr.ts — QR rendering for SmarkStock labels (FEATURES.md §8).
 *
 * QR payload is ALWAYS the short code (PID or box name) — "human text lines"
 * (MPN, value/package, shelf) render alongside as plain text, never encoded
 * in the QR itself, so any phone camera / cheap scanner resolves instantly.
 */

import QRCode from "qrcode";

const QR_DARK = "#1a1a1a";
const QR_LIGHT = "#ffffff";

/** PNG bytes for a QR of `value` — used by the Avery sheet renderer (lib/labels/avery.ts). */
export async function renderQrPngBuffer(value: string, sizePx = 220): Promise<Buffer> {
  return QRCode.toBuffer(value, {
    type: "png",
    margin: 0,
    width: sizePx,
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
}

/** Data-URL form — convenient for an on-screen label preview (part-detail, printable-sheet mock). */
export async function renderQrPngDataUrl(value: string, sizePx = 160): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 0,
    width: sizePx,
    color: { dark: QR_DARK, light: QR_LIGHT },
  });
}
