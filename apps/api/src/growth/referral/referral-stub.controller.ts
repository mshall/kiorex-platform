import { Controller, Get, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/auth';
import { GROWTH_FLAG } from '../growth-flags';
import { notBuiltYet } from '../growth-stub';

/** GRW-P2-X1 stub of the patient referral endpoints in kiorex-growth.v1.openapi.json 1.1.0. Replaced by GRW-P2-B1 (W6). */
@ApiExcludeController()
@Controller('growth/v1/referral')
export class ReferralStubController {
  @Public() @Get('me') me() { throw notBuiltYet(GROWTH_FLAG.PATIENT_REFERRAL, 'GRW-P2-B1'); }
  @Public() @Post('invites') invites() { throw notBuiltYet(GROWTH_FLAG.PATIENT_REFERRAL, 'GRW-P2-B1'); }
  @Public() @Get('rewards') rewards() { throw notBuiltYet(GROWTH_FLAG.REWARDS, 'GRW-P2-B2'); }
  @Public() @Post('claim') claim() { throw notBuiltYet(GROWTH_FLAG.PATIENT_REFERRAL, 'GRW-P2-B1'); }
}
