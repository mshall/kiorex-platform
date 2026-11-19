import { useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";

/** Mock-mode stand-in for the API's fake hosted checkout (/api/v1/pay/fake-checkout/:intentId). Only routed when VITE_MOCK=1. */
export default function MockCheckoutPage() {
  const [sp] = useSearchParams();
  const intent = sp.get("intent") ?? "";
  const back = sp.get("return") ?? "/";
  return (
    <div className="mx-auto max-w-md space-y-4 text-center">
      <h1 className="text-2xl">Kiorex Pay — sandbox checkout</h1>
      <p className="text-muted-foreground">Fake PSP page (mock mode). No real payment is made.</p>
      <Button size="lg" data-testid="mock-pay" onClick={async () => { await fetch(`/api/v1/mock/pay/${intent}`, { method: "POST" }); window.location.assign(back); }}>Pay now (test)</Button>
    </div>
  );
}
