import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useGeographyImport, useGeographyPreview, type GeoPreview } from "@/api/marketOnboarding";
import { StatusChip } from "@/components/kit";
import { Section } from "@/components/growth/GrowthPage";

const SAMPLE = "level,key,parentKey,nameAr,nameEn,slugAr,slugEn\nCITY,amman,,عمّان,Amman,amman,amman\nDISTRICT,abdoun,amman,عبدون,Abdoun,abdoun,abdoun";
/** Step 2: paste or choose a UTF-8 CSV (or a windows-1256 file), preview it with errors per line, then import all or nothing. */
export default function GeographyImport({ cc, readOnly }: { cc: string; readOnly: boolean }) {
  const { t } = useTranslation(); const [text, setText] = useState(""); const [enc, setEnc] = useState<"utf-8" | "windows-1256">("utf-8"); const [b64, setB64] = useState<string | null>(null);
  const preview = useGeographyPreview(); const imp = useGeographyImport(cc); const file = useRef<HTMLInputElement>(null);
  const body = () => (b64 ? { csvBase64: b64, encoding: enc } : { csv: text });
  const pv: GeoPreview | undefined = preview.data;
  const onFile = async (f: File | undefined) => { if (!f) return; const buf = new Uint8Array(await f.arrayBuffer()); let s = ""; for (const x of buf) s += String.fromCharCode(x); setB64(btoa(s)); setText(`${f.name} (${buf.length} bytes)`); };
  return (
    <Section title={t("growth.marketWizard.geoTitle")} id="mw-geo" hint={t("growth.marketWizard.geoHint")}>
      <label className="block text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.geoCsv")}</span>
        <textarea className="h-40 w-full rounded-xl border bg-card p-3 font-mono text-xs" dir="ltr" value={text} onChange={(e) => { setText(e.target.value); setB64(null); }} placeholder={SAMPLE} data-testid="geo-csv" /></label>
      <div className="mt-2 flex flex-wrap items-end gap-3">
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.geoFile")}</span><input ref={file} type="file" accept=".csv,text/csv" className="block min-h-11 text-sm" onChange={(e) => void onFile(e.target.files?.[0])} data-testid="geo-file" /></label>
        <label className="text-sm"><span className="block text-muted-foreground">{t("growth.marketWizard.geoEncoding")}</span><select className="h-11 rounded-xl border border-input bg-card px-3 text-sm" value={enc} onChange={(e) => setEnc(e.target.value as "utf-8" | "windows-1256")} data-testid="geo-encoding"><option value="utf-8">UTF-8</option><option value="windows-1256">windows-1256</option></select></label>
        <button type="button" className="h-11 rounded-xl border border-input bg-card px-4 text-sm font-semibold" disabled={!text.trim() || preview.isPending} onClick={() => preview.mutate(body())} data-testid="geo-preview">{t("growth.marketWizard.geoPreview")}</button>
        <button type="button" className="h-11 rounded-xl border border-primary bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={readOnly || !pv?.ok || imp.isPending} onClick={() => imp.mutate(body())} data-testid="geo-import">{t("growth.marketWizard.geoImport")}</button>
      </div>
      <div className="mt-3 space-y-2" aria-live="polite" data-testid="geo-result">
        {pv && (pv.ok ? <p className="text-sm"><StatusChip tone="success" dot={false}>{t("growth.marketWizard.geoOk")}</StatusChip> {t("growth.marketWizard.geoCounts", { cities: pv.cities, districts: pv.districts })}</p>
          : <div role="alert" className="rounded-xl border border-destructive/40 bg-card p-3 text-sm" data-testid="geo-errors"><p className="font-semibold">{t("growth.marketWizard.geoErrors", { n: pv.errors.length })}</p><ul className="mt-1 list-disc ps-5">{pv.errors.slice(0, 20).map((e, i) => <li key={i}><span className="font-mono text-xs" dir="ltr">{e.line > 0 ? `#${e.line} ` : ""}{e.code}</span> {e.message}</li>)}</ul></div>)}
        {imp.isSuccess && <p className="text-sm" role="status" data-testid="geo-imported">{t("growth.marketWizard.geoImported", { cities: imp.data.cities, districts: imp.data.districts })}</p>}
        {imp.isError && <p className="text-sm text-destructive" role="alert">{(imp.error as Error).message}</p>}
      </div>
    </Section>
  );
}
