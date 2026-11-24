import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { useTranslation } from "react-i18next";

/** QR of the invite link (an opaque code, no personal data). The white quiet zone is part of the image so it scans in dark mode. */
export function InviteQr({ value, size = 168 }: { value: string; size?: number }) {
  const { t } = useTranslation();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let alive = true; QRCode.toDataURL(value, { margin: 2, width: size, errorCorrectionLevel: "M" }).then((u) => alive && setSrc(u), () => alive && setSrc(null)); return () => { alive = false; }; }, [value, size]);
  if (!src) return <div className="rounded-lg bg-muted" style={{ width: size, height: size }} aria-hidden="true" />;
  return <img src={src} width={size} height={size} alt={t("referral.qrAlt")} className="rounded-lg border bg-white" data-testid="invite-qr" />;
}
