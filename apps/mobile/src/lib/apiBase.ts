/** EXPO_PUBLIC_API_URL is the versioned base (http://localhost:4000/api/v1). The generated client's paths already
 *  carry `/api/v1`, so the client baseUrl is the origin only. */
export const API_PREFIX = "/api/v1";

export function apiOrigin(url: string | undefined): string {
  const u = (url && url.trim() ? url.trim() : __DEV__ ? "http://localhost:4000/api/v1" : "").replace(/\/+$/, "");
  return u.endsWith(API_PREFIX) ? u.slice(0, -API_PREFIX.length) : u;
}
