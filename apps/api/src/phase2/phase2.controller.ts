import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiError } from '../common/errors';
import { Public } from '../common/auth';
import { RequiresFlag } from '../control-plane/control-plane-public';

const phase2 = (what: string) => new ApiError(501, 'NOT_IMPLEMENTED_PHASE2', `${what} ships in a later phase (KX-03 §08); the flag gate is already enforced`);

/**
 * Phase-2/3 surfaces. The flag guard runs first, so OFF => 403 FEATURE_DISABLED even before the feature exists
 * (launch-locked flags stay OFF until gate evidence is recorded — ADR-024).
 */
@ApiTags('phase2')
@Controller()
export class Phase2Controller {
  @Post('pharmacy/orders') @RequiresFlag('kiorex.pharmacy_orders') @HttpCode(200) @ApiOperation({ summary: 'Pharmacy order (launch-locked, phase 2)' })
  pharmacy() { throw phase2('Pharmacy orders'); }
  @Post('lab/bookings') @RequiresFlag('kiorex.lab_bookings') @HttpCode(200) @ApiOperation({ summary: 'Lab booking (launch-locked, phase 2)' })
  lab() { throw phase2('Lab bookings'); }
  @Post('telemedicine/sessions') @RequiresFlag('kiorex.telemedicine') @HttpCode(200) @ApiOperation({ summary: 'Telemedicine (launch-locked)' })
  tele() { throw phase2('Telemedicine'); }
}
