export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
  get isFeatureDisabled() { return this.status === 403 && this.code === "FEATURE_DISABLED"; }
  get featureKey(): string | undefined { return (this.details?.key as string | undefined) ?? undefined; }
}

export function toApiError(status: number, body: unknown): ApiError {
  const { code, message, details, ...extra } = (body ?? {}) as { code?: string; message?: string; details?: Record<string, unknown> } & Record<string, unknown>;
  // The API spreads extras at the top level: FEATURE_DISABLED {key, scope}; SLOT_TAKEN {bookingId, alternatives}.
  const d = details ?? (Object.keys(extra).length ? extra : undefined);
  return new ApiError(status, code ?? `HTTP_${status}`, message ?? `Request failed (${status})`, d);
}
