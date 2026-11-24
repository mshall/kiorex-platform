/** A deep link that needs the existing sign-in (appointment management) is held here and replayed once the session exists. Never persisted, never contains a token. */
let pending: string | null = null;
export const setPendingRoute = (route: string | null) => { pending = route; };
export const takePendingRoute = (): string | null => { const p = pending; pending = null; return p; };
export const peekPendingRoute = (): string | null => pending;
