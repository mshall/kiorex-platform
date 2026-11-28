import { useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/auth/AuthProvider";
import { useClaimInvite, normaliseCode } from "@/api/referral";
import { LoadingState } from "@/components/states";
import { Logo } from "@/components/Logo";

/**
 * `/invite/:code` and `/:locale/:cc/invite/:code`. A neutral "a friend invited you" page (no name, no detail about who or where). The sign-up button keeps ONLY the validated code
 * in the Passport return state (`/invite/<CODE>`, a path built here from an 8-character code; no URL-valued parameter is followed), and after sign-in the same page claims the code once.
 * Every refusal reads the same ("this invite cannot be used"): the page never says why.
 */
export default function InviteLanding() {
  const { code: raw } = useParams(); const { t } = useTranslation(); const { status, login } = useAuth(); const code = normaliseCode(raw); const claim = useClaimInvite(); const done = useRef(false);
  useEffect(() => { if (code && status === "signedIn" && !done.current) { done.current = true; claim.mutate(code); } }, [code, status]); // eslint-disable-line react-hooks/exhaustive-deps
  const bad = !code || claim.isError || claim.data?.status === "REJECTED" || claim.data?.status === "EXPIRED"; // one neutral message for every refusal, including the feature being off
  return (
    <div className="container flex max-w-lg flex-col items-center gap-6 py-12 text-center" data-testid="invite-landing">
      <meta name="robots" content="noindex" />
      <Logo height={72} />
      <div className="kx-card w-full space-y-4 p-6 sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-primary" aria-hidden="true"><Gift className="h-7 w-7" /></span>
        {bad ? <><h1 className="text-2xl" data-testid="invite-invalid">{t("referral.landing.invalidTitle")}</h1><p className="text-muted-foreground">{t("referral.landing.invalidBody")}</p><Button asChild><Link to="/">{t("referral.landing.browse")}</Link></Button></> :
          status === "loading" || claim.isPending ? <LoadingState label={t("referral.landing.checking")} /> :
          status !== "signedIn" ? <><h1 className="text-2xl" data-testid="invite-title">{t("referral.landing.title")}</h1><p className="text-muted-foreground">{t("referral.landing.body")}</p>
            <Button size="lg" className="w-full" onClick={() => void login(`/invite/${code}`, { intent: "register" })} data-testid="invite-signup">{t("referral.landing.signup")}</Button>
            <p className="text-xs text-muted-foreground">{t("referral.landing.privacy")}</p></> :
          <><h1 className="text-2xl" data-testid="invite-accepted">{t("referral.landing.acceptedTitle")}</h1><p className="text-muted-foreground">{t("referral.landing.acceptedBody")}</p>
            <Button asChild size="lg" className="w-full"><Link to="/search" data-testid="invite-find-doctor">{t("referral.landing.findDoctor")}</Link></Button></>}
      </div>
    </div>
  );
}
