import { useMutation, useQuery } from "@tanstack/react-query";
import { api, send } from "./client";
import { toVisitView } from "@/lib/visitStatus";

export const vsKey = (t: string) => ["public-visit-status", t] as const;
/** Public (no login) family visit status; polls every 20 s. 404 means the link is gone. */
export const usePublicVisitStatus = (token: string, enabled = true) =>
  useQuery({ queryKey: vsKey(token), enabled: enabled && !!token, retry: 0, refetchInterval: 20_000, queryFn: async () => toVisitView(await send(api.GET("/api/v1/public/visit-status/{token}", { params: { path: { token } } }))) });
export const useStopVisitStatus = (token: string) => useMutation({ mutationFn: () => send(api.POST("/api/v1/public/visit-status/{token}/stop", { params: { path: { token } } })) });
