import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../../common/auth';
import { rolesFor } from '../admin/growth-access';
import { CrossProductFunnelService } from './continuity-funnel.service';
import { CrossProductService } from './continuity.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;
class ConsentBody { @IsBoolean() granted!: boolean; @IsOptional() @IsIn(['web', 'app']) source?: 'web' | 'app' }

/**
 * Patient endpoints of the cross-product journeys. The caller is always the verified session; no endpoint takes another person's id. The cards are the patient's own in-app prompts (no message is
 * ever sent by growth); with `growth.cross_product` OFF or locked the answer is `{ enabled: false, cards: [] }` so every surface looks exactly as before. Consent is a separate, withdrawable choice.
 */
@ApiTags('growth-cross-product')
@Controller('growth/v1/continuity')
export class CrossProductController {
  constructor(private readonly svc: CrossProductService) {}

  @Get('cards') @ApiOperation({ summary: 'GRW-P4-A my continuity cards (pharmacy, lab, home visit), only when their gates are open; prompts only, nothing is sent' }) @ApiOkResponse(OBJ)
  cards(@CurrentUser() u: AuthUser) { return this.svc.cards(u.sub); }

  @Get('consent') @ApiOperation({ summary: 'GRW-P4-A my consent to link a clinic visit with a later pharmacy, lab or home-visit order for measurement' }) @ApiOkResponse(OBJ)
  consent(@CurrentUser() u: AuthUser) { return this.svc.consentState(u.sub); }

  @Put('consent') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-A grant or withdraw that consent (effective for the next order; withdrawal also dismisses pending prompts)' }) @ApiOkResponse(OBJ)
  setConsent(@CurrentUser() u: AuthUser, @Body() b: ConsentBody) { return this.svc.setConsent(u.sub, b.granted, b.source ?? 'app'); }

  @Post('cards/:id/dismiss') @HttpCode(200) @ApiOperation({ summary: 'GRW-P4-A hide one of my cards' }) @ApiOkResponse(OBJ)
  dismiss(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.dismiss(u.sub, id.slice(0, 40)); }
}

/** Ops read model (k-anonymity applied, counts only). */
@ApiTags('growth-admin')
@Roles(...rolesFor('read'))
@Controller('ops/growth/cross-product')
export class CrossProductAdminController {
  constructor(private readonly funnel: CrossProductFunnelService) {}
  @Get('funnel') @ApiOperation({ summary: 'GRW-P4-A clinic to pharmacy, lab and home-visit funnel (aggregate k >= 10; by source of the first booking and time to continue; no specialty)' }) @ApiOkResponse(OBJ)
  get(@Query('days') days?: string) { return this.funnel.funnel(days ? Number(days) || 30 : 30); }
}
