import { AsyncLocalStorage } from 'node:async_hooks';
import { ArgumentMetadata, PipeTransform, ValidationPipe } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * `STRICT_DTO=ops` (G-28, pentest L8): on ops-only routes (`/api/v1/admin/*`) a body or query with a property the DTO does not declare is a 400 instead of being stripped silently.
 * Everything else keeps `whitelist: true` (strip). Default OFF so nothing changes until the ops console and its tests have run with it on in staging. Implemented as a request-scoped
 * flag (AsyncLocalStorage set by a tiny middleware) because a global pipe does not see the request.
 */
const als = new AsyncLocalStorage<{ strict: boolean }>();
export const strictOpsEnabled = (): boolean => (process.env.STRICT_DTO ?? '').split(',').map((s) => s.trim()).includes('ops');
export const isOpsPath = (url: string): boolean => /^\/api\/v1\/admin(\/|\?|$)/.test(url);

export function strictDtoMiddleware(req: Request, _res: Response, next: NextFunction): void {
  als.run({ strict: strictOpsEnabled() && isOpsPath(req.originalUrl ?? req.url ?? '') }, next);
}

export class StrictOpsValidationPipe implements PipeTransform {
  private readonly lenient = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
  private readonly strict = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  transform(value: unknown, metadata: ArgumentMetadata) { return (als.getStore()?.strict ? this.strict : this.lenient).transform(value, metadata); }
}
export const runWithStrictFlag = <T>(strict: boolean, fn: () => T): T => als.run({ strict }, fn);
