import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/auth';
import { rolesFor } from '../admin/growth-access';
import { GrowthProductBookingService } from './product-decision.service';

/** GRW-P4-B2 read model for the ops Growth pages: product decisions by origin (k-anonymity applied). Read only; the commission link of products is inert. */
@ApiTags('growth-admin')
@Roles(...rolesFor('read'))
@Controller('ops/growth/product-decisions')
export class ProductDecisionAdminController {
  constructor(private readonly svc: GrowthProductBookingService) {}
  @Get() @ApiOperation({ summary: 'GRW-P4-B2 pharmacy, lab and nurse decisions by origin (counts only, cells under 10 masked)' }) @ApiOkResponse({ schema: { type: 'object', additionalProperties: true } })
  summary(@Query('days') days?: string) { return this.svc.summary(days ? Number(days) || 30 : 30); }
}
