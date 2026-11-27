/* eslint-disable @typescript-eslint/no-explicit-any -- loosely typed response captures and render callbacks over the ops wire shape */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { rawApi } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardSkeleton, ErrorState } from "@/components/states";
import { DataTable } from "@/components/DataTable";
import { PageHeader } from "@/components/PageHeader";

interface Secret { purpose: string; ref: string; env: string; kind: string; present: boolean }
interface Psp { psp: string; enabled: boolean; mode: "sandbox" | "live"; ready: boolean; missing: string[]; secrets: Secret[]; problems: string[]; webhook: { url: string; scheme: string; secretRef: string | null; secretEnv: string | null; register: string }; selfTest: { ok: boolean; detail: string }; breaker: { state: string; consecutiveFailures: number } | null; live?: { ok: boolean; status: string; ms: number } }
interface Check { mode: "mock" | "real"; provider: string; environment: string; overall: "MOCK" | "OK" | "WARN" | "FAIL"; publicBaseUrl: string; psps: Psp[]; startupProblems: string[]; liveProbe: boolean }
interface Setting { psp: string; settings: Record<string, any>; problems: string[] }

/** PAY-READY: "Payments connection check". Mock-safe by default (no vendor call); the live probe is one read-only authenticated call per enabled PSP and only works in real mode. Secrets appear as REFERENCES with a present / missing mark, never as values. */
export default function PaymentsConnectionPage() {
  const { t } = useTranslation(); const [live, setLive] = useState(false);
  const q = useQuery({ queryKey: ["pay", "check", live], queryFn: () => rawApi<Check>("GET", `/admin/payments/connection-check${live ? "?live=true" : ""}`) });
  const s = useQuery({ queryKey: ["pay", "settings"], queryFn: () => rawApi<Setting[]>("GET", "/admin/payments/settings") });
  const tone = (ok: boolean) => (ok ? "success" : "destructive") as "success" | "destructive";
  return (
    <div>
      <PageHeader title={t("payconn.title")} hint={t("payconn.hint")} actions={<Button variant="outline" onClick={() => { setLive(true); void q.refetch(); }} disabled={q.data?.mode !== "real"} data-testid="live-probe"><Plug aria-hidden="true" />{t("payconn.live")}</Button>} />
      {q.isLoading ? <CardSkeleton rows={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data && (
        <div className="space-y-6">
          <section aria-labelledby="pc-summary" className="rounded-xl border bg-card p-4 shadow-card">
            <h2 id="pc-summary" className="text-base font-semibold">{t("payconn.summary")}</h2>
            <dl className="mt-3 grid gap-3 sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">{t("payconn.mode")}</dt><dd><Badge variant={q.data.mode === "real" ? "default" : "secondary"} data-testid="pc-mode">{t(`payconn.modes.${q.data.mode}`)}</Badge></dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("payconn.env")}</dt><dd>{t(`payconn.envs.${q.data.environment}`)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("payconn.overall")}</dt><dd><Badge variant={q.data.overall === "FAIL" ? "destructive" : q.data.overall === "OK" ? "success" : "warning"} data-testid="pc-overall">{t(`payconn.overalls.${q.data.overall}`)}</Badge></dd></div>
              <div><dt className="text-xs text-muted-foreground">{t("payconn.base")}</dt><dd><code dir="ltr" className="text-xs">{q.data.publicBaseUrl}</code></dd></div>
            </dl>
            {q.data.startupProblems.length > 0 && <ul className="mt-3 list-disc ps-5 text-sm text-destructive">{q.data.startupProblems.map((p) => <li key={p}>{p}</li>)}</ul>}
          </section>
          {q.data.psps.map((p) => (
            <section key={p.psp} aria-labelledby={`pc-${p.psp}`} className="rounded-xl border bg-card p-4 shadow-card" data-testid={`psp-${p.psp}`}>
              <div className="flex flex-wrap items-center gap-2"><h2 id={`pc-${p.psp}`} className="text-base font-semibold">{t(`payconn.names.${p.psp}`)}</h2>
                <Badge variant={p.enabled ? "default" : "secondary"}>{p.enabled ? t("payconn.enabled") : t("payconn.disabled")}</Badge><Badge variant="outline">{t(`payconn.envs.${p.mode}`)}</Badge>
                <Badge variant={tone(p.selfTest.ok)} data-testid={`selftest-${p.psp}`}>{p.selfTest.ok ? t("payconn.selftestOk") : t("payconn.selftestFail")}</Badge>
                {p.breaker && <Badge variant={p.breaker.state === "CLOSED" ? "success" : "warning"}>{t("payconn.breaker")}: {p.breaker.state}</Badge>}
                {p.live && <Badge variant={tone(p.live.ok)}>{t("payconn.liveResult")}: {p.live.status} ({p.live.ms} ms)</Badge>}</div>
              <p className="mt-1 text-xs text-muted-foreground">{p.selfTest.detail}</p>
              <h3 className="mt-3 text-sm font-semibold">{t("payconn.webhook")}</h3>
              <p className="text-sm"><code dir="ltr" className="break-all" data-testid={`url-${p.psp}`}>{p.webhook.url}</code></p>
              <p className="text-xs text-muted-foreground">{p.webhook.scheme}</p><p className="text-xs text-muted-foreground">{t("payconn.register")}: {p.webhook.register}</p>
              <div className="mt-3"><DataTable caption={t("payconn.secrets", { name: t(`payconn.names.${p.psp}`) })} rows={p.secrets} rowKey={(x) => x.purpose} empty={t("payconn.none")} columns={[
                { key: "r", header: t("payconn.secretRef"), cell: (x) => <code dir="ltr" className="text-xs">{x.ref}</code> },
                { key: "e", header: t("payconn.envVar"), cell: (x) => <code dir="ltr" className="text-xs">{x.env}</code> },
                { key: "p", header: t("payconn.present"), cell: (x) => <Badge variant={x.present ? "success" : "warning"}>{x.present ? t("payconn.yes") : t("payconn.no")}</Badge> },
              ]} /></div>
              {p.problems.length > 0 && <ul className="mt-3 list-disc ps-5 text-sm text-amber-700 dark:text-amber-300" data-testid={`problems-${p.psp}`}>{p.problems.map((x) => <li key={x}>{x}</li>)}</ul>}
            </section>
          ))}
          <section aria-labelledby="pc-settings" className="rounded-xl border bg-card p-4 shadow-card">
            <h2 id="pc-settings" className="text-base font-semibold">{t("payconn.settings")}</h2>
            {s.data && <div className="mt-3"><DataTable caption={t("payconn.settings")} rows={s.data} rowKey={(x) => x.psp} empty={t("payconn.none")} columns={[
              { key: "n", header: t("payconn.psp"), cell: (x) => t(`payconn.names.${x.psp}`) },
              { key: "o", header: t("payconn.order"), cell: (x) => (x.settings.enabled ? x.settings.order : "-") },
              { key: "f", header: t("payconn.fee"), cell: (x) => (x.settings.fee.percentBps === null && x.settings.fee.fixedMinor === null ? <Badge variant="warning">{t("payconn.needsHuman")}</Badge> : `${x.settings.fee.percentBps ?? 0} bps + ${x.settings.fee.fixedMinor ?? 0}`) },
              { key: "d", header: t("payconn.threeDs"), cell: (x) => x.settings.threeDsMode },
              { key: "c", header: t("payconn.capture"), cell: (x) => x.settings.captureMode },
              { key: "w", header: t("payconn.window"), cell: (x) => (x.settings.refundWindowDays === null ? <Badge variant="warning">{t("payconn.needsHuman")}</Badge> : `${x.settings.refundWindowDays} d`) },
              { key: "t", header: t("payconn.timeouts"), cell: (x) => `${x.settings.timeoutMs} ms / ${x.settings.maxRetries}` },
            ]} /></div>}
            <p className="mt-2 text-xs text-muted-foreground">{t("payconn.settingsHint")}</p>
          </section>
        </div>
      )}
    </div>
  );
}
