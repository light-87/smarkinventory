"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface PartQrCodeProps {
  /** Encoded value — the short internal PID only (FEATURES.md §8: "encodes short PID"). */
  value: string;
  size?: number;
}

/** Real QR (via the `qrcode` package), PID-encoded — replaces the prototype's mock glyph. */
export function PartQrCode({ value, size = 88 }: PartQrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(value, {
      margin: 1,
      width: size,
      color: { dark: "#121212", light: "#fafafa" },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!dataUrl) {
    return (
      <div
        aria-hidden
        style={{ width: size, height: size }}
        className="animate-pulse rounded-lg bg-surface-raised"
      />
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- a generated data: URI, not an optimizable remote asset
  return <img src={dataUrl} width={size} height={size} alt={`QR code for ${value}`} className="rounded-lg" />;
}
