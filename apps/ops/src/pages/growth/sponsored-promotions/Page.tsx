import { GrowthPage } from "@/components/growth/GrowthPage";
import PromotionsQueuePage from "@/pages/growth/promotions/PromotionsQueuePage";

/** GRW-P2-S: the review queue of provider-sponsored promotions (the review and ledger pages are routes below it). */
export default function SponsoredPromotionsPage() { return <GrowthPage section="sponsored-promotions"><PromotionsQueuePage /></GrowthPage>; }
