import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { getManager } from "@/auth/oidc";
import { LoadingState } from "@/components/states";
import { safeNext } from "@/lib/onboarding";

const CANCELLED = new Set(["access_denied", "login_required", "interaction_required", "consent_required"]);

/** Back from Passport. A cancelled or refused sign-in goes to the entry page with a calm message; success goes through /welcome, which sends existing members straight on and new members into first-run onboarding. */
export default function AuthCallbackPage() {
  const { completeLogin } = useAuth();
  const nav = useNavigate();
  const { t } = useTranslation();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke: the code can only be exchanged once
    ran.current = true;
    const err = new URLSearchParams(window.location.search).get("error");
    if (err) {
      void getManager().clearStaleState().catch(() => undefined);
      nav(`/signin?reason=${CANCELLED.has(err) ? "cancelled" : "error"}`, { replace: true });
      return;
    }
    completeLogin()
      .then((to) => { const next = safeNext(to); nav(`/welcome?next=${encodeURIComponent(next)}`, { replace: true }); })
      .catch(() => nav("/signin?reason=error", { replace: true }));
  }, [completeLogin, nav]);
  return <LoadingState label={t("auth.signingIn")} />;
}
