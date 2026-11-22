import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { installNotificationTapHandler } from "@/lib/pushTap";
import { routeForPush } from "@/lib/pushRoute";

/** Mount once under AuthProvider. A tap while signed out is held and replayed after sign-in (these screens need a session). */
export function usePushRouting() {
  const router = useRouter();
  const { status } = useAuth();
  const pending = useRef<string | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;
  const go = useRef((path: string) => { router.push(path as never); });
  go.current = (path: string) => { router.push(path as never); };
  useEffect(() => installNotificationTapHandler((data) => {
    const path = routeForPush(data);
    if (!path) return;
    if (statusRef.current === "signedIn") go.current(path); else pending.current = path;
  }), []);
  useEffect(() => { if (status === "signedIn" && pending.current) { const p = pending.current; pending.current = null; go.current(p); } }, [status]);
}
