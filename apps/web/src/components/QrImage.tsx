import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";

/** Renders a prescription verification payload as a QR image (opaque HMAC token; carries no patient data). */
export function QrImage({ value, size = 192 }: { value: string; size?: number }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(value, { margin: 1, width: size, errorCorrectionLevel: "M" }).then((u) => alive && setSrc(u), () => alive && setSrc(null));
    return () => { alive = false; };
  }, [value, size]);
  if (!src) return <div className="rounded-lg bg-muted" style={{ width: size, height: size }} aria-hidden="true" />;
  // White quiet zone is part of the image so it stays scannable in dark mode.
  return <img src={src} width={size} height={size} alt={t("records.qrAlt")} className="rounded-lg border bg-white" data-testid="rx-qr" />;
}
