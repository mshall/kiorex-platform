import { useSearchParams } from "react-router-dom";
import DryRunPage from "./DryRunPage";
import JourneyBuilderPage from "./JourneyBuilderPage";
import JourneyListPage from "./JourneyListPage";

/**
 * GRW-P3-E: marketing automation (replaces nothing: a new section). One route, three views kept in the query string so the shared route table stays small:
 * the list (default), `?new=1` the builder for a new journey, `?id=<id>` one journey (builder, read-only once it left DRAFT), `?id=<id>&view=dryrun` or `?view=dryrun` the dry run.
 */
export default function AutomationRoute() {
  const [sp] = useSearchParams(); const id = sp.get("id");
  if (sp.get("view") === "dryrun") return <DryRunPage id={id} />;
  if (id || sp.get("new")) return <JourneyBuilderPage id={id} />;
  return <JourneyListPage />;
}
