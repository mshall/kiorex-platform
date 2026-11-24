import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'kx:public';
export const ROLES_KEY = 'kx:roles';
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any-of role requirement (kx_roles claim). */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
export const OPS_ROLES = ['ops_admin', 'super_admin'];
export const OpsOnly = () => Roles(...OPS_ROLES);
export const SuperAdminOnly = () => Roles('super_admin');

export interface AuthUser {
  sub: string;
  roles: string[];
  phone?: string;
  email?: string;
  name?: string;
  locale?: string;
  sid?: string;
  clientId?: string;
}

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
