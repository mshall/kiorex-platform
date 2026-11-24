import { useSearchParams } from "react-router-dom";
import RecommendationDetail from "./RecommendationDetail";
import RecommendationsPage from "./RecommendationsPage";

/** GRW-P3-E: AI-assisted campaign recommendations (replaces the GRW-P2-X1 placeholder). One route: the list (default) and `?id=<id>` one recommendation. */
export default function RecommendationsRoute() {
  const [sp] = useSearchParams(); const id = sp.get("id");
  return id ? <RecommendationDetail id={id} /> : <RecommendationsPage />;
}
