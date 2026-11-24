import { I18nextProvider } from "react-i18next";
import { useMemo } from "react";
import "./templates/default";
import { createPublicI18n, makeCtx } from "./i18n";
import { ComputedLinks, PublicLayout } from "./components/parts";
import { getTemplate } from "./registry";
import type { PublicState, TemplateCtx } from "./types";

export function buildCtx(state: PublicState, i18n: ReturnType<typeof createPublicI18n>): TemplateCtx {
  return makeCtx(i18n, { locale: state.locale, cc: state.cc, path: state.path, canonicalHost: state.site?.canonicalHost ?? "", reviewMarkup: state.site?.reviewMarkup ?? false, templates: state.site?.templates ?? {}, imageCdn: state.site?.imageCdn ?? null, query: state.query });
}

/** The public tree: identical on the server (renderToPipeableStream) and on the client (hydrateRoot). No router, no auth, no query client: public data only. */
export function PublicApp({ state }: { state: PublicState }) {
  const i18n = useMemo(() => createPublicI18n(state.locale), [state.locale]);
  const ctx = buildCtx(state, i18n);
  const tpl = getTemplate(state.type);
  if (!tpl) throw new Error(`no template registered for ${state.type}`);
  const Body = tpl.Component;
  return (
    <I18nextProvider i18n={i18n}>
      <PublicLayout ctx={ctx}><Body data={state.data} ctx={ctx} /><ComputedLinks groups={(state.data as { computedLinks?: import("./types").ComputedLinkGroup[] }).computedLinks} ctx={ctx} /></PublicLayout>
    </I18nextProvider>
  );
}
