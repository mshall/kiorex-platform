import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { JsonSchemaNode } from "@/api/growth";
import { selectCls } from "./GrowthPage";

type Obj = Record<string, unknown>;
const typeOf = (n: JsonSchemaNode) => (Array.isArray(n.type) ? n.type.filter((x) => x !== "null")[0] : n.type);
const nullable = (n: JsonSchemaNode) => Array.isArray(n.type) && n.type.includes("null");

/** Form generated from the contract JSON Schema of a config kind (the same schema the API validates against). Unknown shapes fall back to JSON. */
export function SchemaForm({ schema, value, onChange, idPrefix = "f" }: { schema: JsonSchemaNode; value: Obj; onChange: (v: Obj) => void; idPrefix?: string }) {
  const props = schema.properties ?? {};
  const set = (k: string, v: unknown) => { const next = { ...value }; if (v === undefined) delete next[k]; else next[k] = v; onChange(next); };
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="schema-form">
      {Object.entries(props).map(([k, n]) => <FieldView key={k} id={`${idPrefix}-${k}`} name={k} node={n} required={!!schema.required?.includes(k)} value={value[k]} onChange={(v) => set(k, v)} />)}
    </div>
  );
}

function FieldView({ id, name, node, required, value, onChange }: { id: string; name: string; node: JsonSchemaNode; required: boolean; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useTranslation();
  const t0 = typeOf(node);
  const label = <label htmlFor={id} className="block text-sm font-medium"><code className="text-[13px]">{name}</code>{required && <span className="ms-1 text-destructive" aria-hidden="true">*</span>}</label>;
  const hint = node.description ? <p id={`${id}-hint`} className="text-xs text-muted-foreground">{node.description}</p> : null;
  const wide = t0 === "object" || t0 === "array";
  const wrap = (c: React.ReactNode) => <div className={`space-y-1.5 ${wide ? "md:col-span-2" : ""}`}>{label}{c}{hint}</div>;
  if (node.const !== undefined) return wrap(<div className="flex h-11 items-center gap-2 text-sm"><input id={id} type="checkbox" checked readOnly disabled aria-describedby={hint ? `${id}-hint` : undefined} /> <span className="text-muted-foreground">{t("growth.form.fixed")}</span></div>);
  if (node.enum) return wrap(<select id={id} className={`${selectCls} w-full`} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined}>{!required && <option value="">—</option>}{node.enum.map((o) => <option key={String(o)} value={String(o)}>{String(o)}</option>)}</select>);
  if (t0 === "boolean") return wrap(<div className="flex h-11 items-center gap-2"><input id={id} type="checkbox" className="h-5 w-5" checked={value === true} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-hint` : undefined} /><span className="text-sm">{value === true ? t("growth.common.on") : t("growth.common.off")}</span></div>);
  if (t0 === "integer" || t0 === "number") return wrap(<Input id={id} type="number" inputMode="numeric" min={node.minimum} max={node.maximum} className="kx-label-num" value={typeof value === "number" ? value : ""} onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))} aria-describedby={hint ? `${id}-hint` : undefined} />);
  if (t0 === "string") return wrap(<Input id={id} dir="ltr" maxLength={node.maxLength} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value === "" && nullable(node) ? null : e.target.value)} aria-describedby={hint ? `${id}-hint` : undefined} />);
  if (t0 === "array" && node.items?.enum) {
    const cur = Array.isArray(value) ? (value as string[]) : [];
    return wrap(<div className="flex flex-wrap gap-3" role="group" aria-labelledby={id}>{node.items.enum.map((o) => <label key={String(o)} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={cur.includes(String(o))} onChange={(e) => onChange(e.target.checked ? [...cur, String(o)] : cur.filter((x) => x !== String(o)))} />{String(o)}</label>)}</div>);
  }
  if (node["x-editor"] === "seo-templates") return wrap(<SeoTemplates id={id} node={node} value={(value as TemplateMap) ?? {}} onChange={onChange} />);
  if (t0 === "object" && node.properties) return wrap(<div className="rounded-xl border p-3"><SchemaForm schema={node} value={(value as Obj) ?? {}} onChange={(v) => onChange(v)} idPrefix={id} /></div>);
  if (t0 === "object" && typeof node.additionalProperties === "object" && typeOf(node.additionalProperties) === "boolean") return wrap(<BoolMap id={id} value={(value as Record<string, boolean>) ?? {}} onChange={onChange} />);
  return wrap(<JsonField id={id} value={value} onChange={onChange} />);
}

/** integration kind -> on/off (names are lowercase words; the switches themselves stay in the flag control plane). */
function BoolMap({ id, value, onChange }: { id: string; value: Record<string, boolean>; onChange: (v: unknown) => void }) {
  const { t } = useTranslation(); const [key, setKey] = useState("");
  const valid = /^[a-z0-9_]{2,32}$/.test(key) && !(key in value);
  return (
    <div className="space-y-2" id={id}>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="flex items-center gap-3"><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={v} onChange={(e) => onChange({ ...value, [k]: e.target.checked })} /><code>{k}</code></label>
          <Button type="button" variant="ghost" size="sm" onClick={() => { const n = { ...value }; delete n[k]; onChange(n); }}>{t("growth.form.remove")}</Button></div>
      ))}
      <div className="flex items-center gap-2"><Input aria-label={t("growth.form.newKey")} placeholder="whatsapp" dir="ltr" className="max-w-48" value={key} onChange={(e) => setKey(e.target.value.toLowerCase())} /><Button type="button" variant="outline" size="sm" disabled={!valid} onClick={() => { onChange({ ...value, [key]: true }); setKey(""); }}>{t("growth.form.add")}</Button></div>
    </div>
  );
}
function JsonField({ id, value, onChange }: { id: string; value: unknown; onChange: (v: unknown) => void }) {
  const { t } = useTranslation(); const [text, setText] = useState(JSON.stringify(value ?? null, null, 2)); const [bad, setBad] = useState(false);
  return (<><Textarea id={id} dir="ltr" rows={4} value={text} aria-invalid={bad || undefined} onChange={(e) => { setText(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); } }} />{bad && <p role="alert" className="text-xs font-medium text-destructive">{t("growth.form.badJson")}</p>}</>);
}

type TemplateMap = Record<string, Record<string, { title?: string; description?: string }>>;
/** Metadata templates: pick a language and page type, write the title and description with {placeholders}. Rows already stored are listed and can be removed. */
function SeoTemplates({ id, node, value, onChange }: { id: string; node: JsonSchemaNode; value: TemplateMap; onChange: (v: unknown) => void }) {
  const { t } = useTranslation();
  const [loc, setLoc] = useState("en"); const [page, setPage] = useState(node["x-pageTypes"]?.[0] ?? "home"); const [title, setTitle] = useState(""); const [desc, setDesc] = useState("");
  const rows = Object.entries(value).flatMap(([l, byKey]) => Object.entries(byKey ?? {}).map(([k, tpl]) => ({ l, k, tpl })));
  const put = () => { const next: TemplateMap = { ...value, [loc]: { ...(value[loc] ?? {}), [page]: { ...(title.trim() ? { title: title.trim() } : {}), ...(desc.trim() ? { description: desc.trim() } : {}) } } }; onChange(next); setTitle(""); setDesc(""); };
  const drop = (l: string, k: string) => { const byKey = { ...(value[l] ?? {}) }; delete byKey[k]; const next = { ...value, [l]: byKey }; if (Object.keys(byKey).length === 0) delete next[l]; onChange(next); };
  return (
    <div className="space-y-3 rounded-xl border p-3" id={id} data-testid="seo-templates">
      <p className="text-xs text-muted-foreground">{t("growth.form.placeholders")} {(node["x-placeholders"] ?? []).map((p) => <code key={p} className="me-1">{`{${p}}`}</code>)}</p>
      <ul className="space-y-1 text-sm" data-testid="seo-template-rows">{rows.length === 0 && <li className="text-muted-foreground">{t("growth.form.noTemplates")}</li>}{rows.map(({ l, k, tpl }) => (
        <li key={`${l}-${k}`} className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5"><span className="min-w-0"><b>{l.toUpperCase()} · {k}</b> <span dir="auto" className="break-words">{tpl.title}</span>{tpl.description && <span className="block text-xs text-muted-foreground" dir="auto">{tpl.description}</span>}</span><Button type="button" variant="ghost" size="sm" onClick={() => drop(l, k)}>{t("growth.form.remove")}</Button></li>))}</ul>
      <div className="grid gap-2 md:grid-cols-4">
        <label className="space-y-1 text-sm"><span className="block font-medium">{t("growth.form.language")}</span><select className={`${selectCls} w-full`} value={loc} onChange={(e) => setLoc(e.target.value)} data-testid="tpl-locale"><option value="ar">AR</option><option value="en">EN</option></select></label>
        <label className="space-y-1 text-sm"><span className="block font-medium">{t("growth.form.pageType")}</span><select className={`${selectCls} w-full`} value={page} onChange={(e) => setPage(e.target.value)} data-testid="tpl-page">{(node["x-pageTypes"] ?? []).map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label className="space-y-1 text-sm md:col-span-2"><span className="block font-medium">{t("growth.form.tplTitle")}</span><Input dir="auto" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} data-testid="tpl-title" /></label>
        <label className="space-y-1 text-sm md:col-span-3"><span className="block font-medium">{t("growth.form.tplDescription")}</span><Input dir="auto" maxLength={320} value={desc} onChange={(e) => setDesc(e.target.value)} data-testid="tpl-description" /></label>
        <div className="flex items-end"><Button type="button" variant="outline" disabled={!title.trim() && !desc.trim()} onClick={put} data-testid="tpl-add">{t("growth.form.setTemplate")}</Button></div>
      </div>
    </div>
  );
}
