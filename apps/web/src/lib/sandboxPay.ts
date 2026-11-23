/**
 * Kiorex Pay sandbox (`PSP_MODE=sandbox-fake`, dev only): the hosted checkout is the API's own page. Passing `returnUrl` makes the
 * API redirect back to the app after Pay / Fail (it only honours allow-listed hosts and never in production), so the sandbox is
 * not a dead end. Any real PSP checkout URL is returned unchanged.
 */
export function withSandboxReturn(checkoutUrl: string, returnTo: string = window.location.href): string {
  if (!checkoutUrl.includes("fake-checkout")) return checkoutUrl;
  return `${checkoutUrl}${checkoutUrl.includes("?") ? "&" : "?"}returnUrl=${encodeURIComponent(returnTo)}`;
}
