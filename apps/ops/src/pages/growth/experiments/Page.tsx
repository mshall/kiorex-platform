import { useSearchParams } from "react-router-dom";
import ExperimentDetailPage from "./ExperimentDetailPage";
import ExperimentWizard from "./ExperimentWizard";
import ExperimentsPage from "./ExperimentsPage";

/**
 * GRW-P3-A: experimentation and A/B testing (replaces the GRW-P2-X1 placeholder). One route, three views kept in the query string so the shared route table stays untouched:
 * the list (default), `?new=1` the wizard, `?id=<id>[&tab=history]` one experiment with its append-only history.
 */
export default function ExperimentsRoute() {
  const [sp] = useSearchParams(); const id = sp.get("id");
  if (id) return <ExperimentDetailPage id={id} tab={sp.get("tab") === "history" ? "history" : "overview"} />;
  if (sp.get("new")) return <ExperimentWizard />;
  return <ExperimentsPage />;
}
