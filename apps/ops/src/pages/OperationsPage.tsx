import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/api/errors";
import { useWaitlistScan } from "@/api/ops";
import { PageHeader, StatTile } from "@/components/PageHeader";

/** On-demand jobs. The waitlist autofill scan also runs every 60 s when JOBS_ENABLED; running it here is idempotent. */
export default function OperationsPage() {
  const { t } = useTranslation();
  const scan = useWaitlistScan();
  const [last, setLast] = useState<{ offersCreated: number; offersExpired: number; at: Date } | null>(null);
  return (
    <div>
      <PageHeader title={t("operations.title")} hint={t("operations.hint")} />
      <section className="kx-card max-w-xl space-y-4 p-5" aria-labelledby="scan-h">
        <h2 id="scan-h" className="flex items-center gap-2 text-lg"><BellRing className="h-5 w-5 text-ocean" aria-hidden="true" />{t("operations.waitlist")}</h2>
        <p className="text-sm text-muted-foreground">{t("operations.waitlistHint")}</p>
        <Button disabled={scan.isPending} data-testid="waitlist-scan" onClick={() => scan.mutate(undefined, { onSuccess: (r) => { setLast({ ...r, at: new Date() }); toast.success(t("operations.scanned", { created: r.offersCreated, expired: r.offersExpired })); }, onError: (e) => toast.error(e instanceof ApiError ? `${e.code}: ${e.message}` : t("states.errorTitle")) })}>{scan.isPending ? t("states.loading") : t("operations.runScan")}</Button>
        {last && <div className="grid gap-3 sm:grid-cols-2" data-testid="scan-result"><StatTile label={t("operations.offersCreated")} value={last.offersCreated} tone={last.offersCreated ? "ok" : undefined} /><StatTile label={t("operations.offersExpired")} value={last.offersExpired} /></div>}
      </section>
    </div>
  );
}
