import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { RequiresFlag } from '../../control-plane/control-plane-public';
import { GROWTH_FLAG } from '../growth-flags';
import { ReferralClaimService } from './referral-claim.service';
import { ReferralService } from './referral.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
const VISITOR_KEY = /^kxv_[A-Za-z0-9_-]{16,64}$/;

class InviteBody {
  @IsOptional() @IsIn(['LINK', 'WHATSAPP_SHARE', 'SMS', 'COPY']) channel?: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: string;
}
class ClaimBody { @IsString() @MaxLength(40) code!: string }

/**
 * Patient referral endpoints (contract kiorex-growth.v1.openapi.json 1.1.0): `GET /growth/v1/referral/me`, `POST .../invites`, `POST .../claim`. Launch-locked behind growth.patient_referral
 * (403 FEATURE_DISABLED until counsel's gate evidence is recorded). The caller is always the verified session: no endpoint takes another person's id.
 */
@ApiTags('growth-referral')
@Controller('growth/v1/referral')
@RequiresFlag(GROWTH_FLAG.PATIENT_REFERRAL)
export class ReferralController {
  constructor(private readonly svc: ReferralService, private readonly claims: ReferralClaimService) {}

  @Get('me') @ApiOperation({ summary: 'GRW-P2-B1 my referral code, invite link, counts and caps remaining' }) @ApiOkResponse(OBJ)
  me(@CurrentUser() u: AuthUser) { return this.svc.me(u); }

  @Post('invites') @ApiOperation({ summary: 'GRW-P2-B1 record a share of my invite and get the link and share text (counts only, no recipient)' }) @ApiOkResponse(OBJ)
  invites(@CurrentUser() u: AuthUser, @Body() b: InviteBody) { return this.svc.createInvite(u, b); }

  @Post('claim') @HttpCode(200) @ApiOperation({ summary: 'GRW-P2-B1 claim a referral code as the invited person (first claim wins; every refusal has the same shape)' }) @ApiOkResponse(OBJ)
  claim(@CurrentUser() u: AuthUser, @Body() b: ClaimBody, @Req() req: { ip?: string; headers: Record<string, string | string[] | undefined> }) {
    const h = (n: string) => { const v = req.headers[n]; return Array.isArray(v) ? v[0] : v; };
    const cookie = /(?:^|;\s*)kxv=([^;]+)/.exec(h('cookie') ?? '')?.[1];
    const raw = h('x-kx-visitor') ?? cookie;
    return this.claims.claim(u, b.code, { visitorKey: raw && VISITOR_KEY.test(raw) ? raw : null, ip: req.ip });
  }
}
