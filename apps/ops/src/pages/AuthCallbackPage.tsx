import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/auth/AuthProvider";
import { ErrorState, LoadingState } from "@/components/states";

export default function AuthCallbackPage() {
  const { completeLogin } = useAuth();
  const nav = useNavigate();
  const { t } = useTranslation();
  const [failed, setFailed] = useState(false);
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return; // StrictMode double-invoke: the code can only be exchanged once
    ran.current = true;
    completeLogin().then((to) => nav(to, { replace: true })).catch(() => setFailed(true));
  }, [completeLogin, nav]);
  return failed ? <ErrorState onRetry={() => nav("/", { replace: true })} /> : <LoadingState label={t("auth.signingIn")} />;
}
