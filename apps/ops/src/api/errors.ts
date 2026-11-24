export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
  get isFeatureDisabled() { return this.status === 403 && this.code === "FEATURE_DISABLED"; }
  get featureKey(): string | undefined { return (this.details?.key as string | undefined) ?? undefined; }
}

export function toApiError(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { code?: string; message?: string; details?: Record<string, unknown>; key?: string; scope?: string; errors?: string[]; warnings?: string[] };
  // FEATURE_DISABLED is specified as `403 FEATURE_DISABLED {key, scope}` (KX-08 §08); accept both flat and `details`.
  const details = b.details ?? (b.key ? { key: b.key, scope: b.scope } : b.errors ? { errors: b.errors, ...(b.warnings ? { warnings: b.warnings } : {}) } : undefined); // growth config errors list the failing fields
  return new ApiError(status, b.code ?? `HTTP_${status}`, b.message ?? `Request failed (${status})`, details);
}
