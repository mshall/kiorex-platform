import type { NotFoundData } from "../types";
import { SearchBox } from "../components/parts";
import { registerTemplate } from "../registry";
import { buildMeta } from "../seo/meta";

registerTemplate<NotFoundData>({
  types: ["not-found", "static"],
  Component: ({ ctx }) => (
    <section className="kxp-hero" data-testid="public-not-found">
      <h1>{ctx.t("notFound.title")}</h1>
      <p className="kxp-lead">{ctx.t("notFound.body")}</p>
      <SearchBox ctx={ctx} />
      <p><a className="kxp-btn" href={`/${ctx.locale}/${ctx.cc}`}>{ctx.t("notFound.home")}</a></p>
    </section>
  ),
  meta: (_d, ctx) => buildMeta(ctx.t("meta.notFound.title"), ctx.t("notFound.body"), ctx.locale),
  jsonLd: () => [],
});
