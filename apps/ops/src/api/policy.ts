// Market policy hooks (ops console "Market policy"): typed from the generated contract.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, unwrap } from "./client";
import type { components } from "./schema";

type S = components["schemas"];
export type PolicyItem = S["PolicyItemDto"];
export type PolicyScope = "GLOBAL" | "MARKET" | "ORG";

export const usePolicies = (market: string) => useQuery({ queryKey: ["ops", "policy", market], enabled: /^[A-Za-z]{2}$/.test(market), queryFn: () => unwrap(api.GET("/api/v1/admin/policy", { params: { query: { market } } })) });
export const useSetPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; scope: PolicyScope; scopeId?: string; value: Record<string, unknown>; note?: string }) => unwrap(api.PUT("/api/v1/admin/policy/{key}", { params: { path: { key: v.key } }, body: { scope: v.scope, scopeId: v.scopeId, value: v.value, note: v.note } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "policy"] }),
  });
};
export const useClearPolicy = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { key: string; scope: PolicyScope; scopeId?: string }) => unwrap(api.DELETE("/api/v1/admin/policy/{key}", { params: { path: { key: v.key }, query: { scope: v.scope, ...(v.scopeId ? { scopeId: v.scopeId } : {}) } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ops", "policy"] }),
  });
};
