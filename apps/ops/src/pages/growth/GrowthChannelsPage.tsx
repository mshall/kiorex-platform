import { useState } from "react";
import { useTranslation } from "react-i18next";
import { fmtN } from "@/lib/growthFormat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useChannelPatch, useChannels, useGrowthAccess } from "@/api/growth";
import { StatusChip } from "@/components/kit";
import { DataTable } from "@/components/DataTable";
import { CardSkeleton, ErrorState } from "@/components/states";
import { BarList } from "@/components/growth/BarList";
import { ChannelPerformancePanel } from "@/components/growth/ChannelPerformancePanel";
import { DaysSelect, GrowthPage, MarketSelect, Section, useGrowthMarket } from "@/components/growth/GrowthPage";
import { formatDateTime } from "@/lib/format";

export default function GrowthChannelsPage() {
  const { t, i18n } = useTranslation(); const g = useGrowthMarket(); const [days, setDays] = useState(30);
  const q = useChannels(g.market, days); const patch = useChannelPatch(); const can = useGrowthAccess().data?.capabilities.manage;
  const flip = (id: string, active: boolean) => patch.mutate({ id, active }, { onSuccess: () => toast.success(t("growth.channels.saved")), onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")) });
  return (
    <GrowthPage section="channels" toolbar={<><MarketSelect g={g} /><DaysSelect value={days} onChange={setDays} /></>}>
      {q.isLoading ? <CardSkeleton rows={2} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <>
          <Section title={t("growth.channels.byKind")} id="ch-kinds" hint={t("growth.channels.byKindHint")}>
            {q.data.kinds.length === 0 ? <p className="text-sm text-muted-foreground">{t("growth.channels.empty")}</p> : <BarList testid="channel-kinds" rows={q.data.kinds.map((k) => ({ label: t(`growth.sourceKind.${k.sourceKind}`, k.sourceKind), value: k.touches, hint: t("growth.channels.kindHint", { sources: k.sources, active: k.active }) }))} />}
          </Section>
          <Section title={t("growth.channels.sources")} id="ch-sources" hint={can ? t("growth.channels.manageHint") : t("growth.channels.readOnlyHint")}>
            <DataTable caption={t("growth.channels.sources")} rows={q.data.sources} rowKey={(r) => r.id} empty={t("growth.channels.empty")} columns={[
              { key: "k", header: t("growth.channels.colKind"), cell: (r) => t(`growth.sourceKind.${r.sourceKind}`, r.sourceKind) },
              { key: "r", header: t("growth.channels.colRef"), cell: (r) => <code className="text-xs">{r.sourceRef || "—"}</code> },
              { key: "l", header: t("growth.channels.colLabel"), cell: (r) => r.label ?? "—" },
              { key: "o", header: t("growth.channels.colOwner"), cell: (r) => <code className="text-xs">{r.ownerOrgRef ?? "—"}</code> },
              { key: "t", header: t("growth.channels.colTouches"), cell: (r) => <span className="kx-label-num">{fmtN(r.touches)}</span> },
              { key: "ls", header: t("growth.channels.colLast"), cell: (r) => <span className="text-xs">{formatDateTime(r.lastTouchAt, i18n.language)}</span> },
              { key: "a", header: t("growth.channels.colState"), cell: (r) => (
                <div className="flex items-center gap-2"><StatusChip tone={r.active ? "success" : "neutral"}>{r.active ? t("growth.channels.active") : t("growth.channels.paused")}</StatusChip>
                  {can && <Button size="sm" variant="outline" disabled={patch.isPending} onClick={() => flip(r.id, !r.active)} data-testid={`channel-toggle-${r.id}`}>{r.active ? t("growth.channels.pause") : t("growth.channels.resume")}</Button>}</div>) },
            ]} />
          </Section>
        </>)}
      <ChannelPerformancePanel market={g.market} days={days} />
    </GrowthPage>
  );
}
