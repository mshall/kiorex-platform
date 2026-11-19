import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import type { BookingChannel } from "@/api/types";

/** Where the booking came from (KXM-BK-11 / clinic booking link / marketplace). */
export function ChannelBadge({ channel }: { channel: BookingChannel }) {
  const { t } = useTranslation();
  return <Badge variant={channel === "MARKETPLACE" ? "secondary" : "info"} data-testid="channel-badge" data-channel={channel}>{t(`channel.${channel}`)}</Badge>;
}

/** Sponsored placements are always labelled (P3). The API returns none until commercial terms exist, so this renders nothing then. */
export function SponsoredLabel() {
  const { t } = useTranslation();
  return <Badge variant="pulse" data-testid="sponsored-label">{t("results.sponsored")}</Badge>;
}
