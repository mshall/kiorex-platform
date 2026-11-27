// Leaf module (no import of the API client): src/api/client.ts reads the remembered card id for its request header, and api.ts below imports the client, so the state lives here to keep the
// import graph acyclic. A cycle was a "Cannot access 'api' before initialization" crash at start-up in a production (minified) web build.
// GRW-P4-A: the card id of the continuity card the patient just opened travels back in a header on the order, booking or care-plan request the patient chooses to make.
export const CONTINUITY_HEADER = "X-Kx-Continuity";
export const CONTINUITY_PATHS: readonly string[] = ["/api/v1/pharmacy/orders", "/api/v1/lab/bookings", "/api/v1/care-plans"];
const TTL_MS = 30 * 60_000;
let remembered: { id: string; at: number } | null = null; // this app session only; never written to disk

export const rememberCard = (id: string, now = Date.now()) => { remembered = { id, at: now }; };
export const clearCard = () => { remembered = null; };
export function currentCard(now = Date.now()): string | null { return remembered && now - remembered.at < TTL_MS && /^[A-Za-z0-9_-]{10,40}$/.test(remembered.id) ? remembered.id : null; }
