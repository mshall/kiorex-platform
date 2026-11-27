/** Join request -> existing Partner onboarding screen (read-only helper, 28 Nov 2026). Nothing is created from here: the screen opens with the kind and label prefilled. */
export type EnrolKind = "CLINIC" | "NURSE" | "PHARMACY" | "LAB";

/** Which product enrolment kind a join-request provider type corresponds to; null when no product fits (OTHER, or a type the team added). */
export function enrolKindForLead(providerType: string): EnrolKind | null {
  switch (providerType) {
    case "CLINIC": case "INDEPENDENT_DOCTOR": case "CHAIN": case "HOSPITAL": case "PHYSICIAN": return "CLINIC";
    case "NURSE": return "NURSE";
    case "LAB": return "LAB";
    case "PHARMACY": return "PHARMACY";
    default: return null;
  }
}

/** The helper is offered once a request is qualified (until it is won), and only when it asked to connect to Kiorex: a standalone request has no connection request. */
export const canStartOnboarding = (lead: { status: string; mode: string }): boolean => lead.mode === "CONNECTED" && (lead.status === "QUALIFIED" || lead.status === "ONBOARDING");

/** Only the request id travels in the URL (no contact data, no name): the target page reads the request with the user's own token. */
export const onboardingUrlForLead = (leadId: string): string => `/partner-onboarding?lead=${encodeURIComponent(leadId)}`;
