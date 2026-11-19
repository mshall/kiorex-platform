import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, OpsOnly } from '../common/auth';
import { badRequest } from '../common/errors';
import { RequiresFlag } from '../control-plane/control-plane-public';
import { LabBookingDto, LabSlotsResultDto, LabTestsResultDto } from './lab.dto';
import { LabService } from './lab.service';

export class LabSlotBody { @IsDateString() startsAt!: string; @IsDateString() endsAt!: string }
export class LabAddressBody {
  @IsString() @MaxLength(200) line1!: string;
  @IsOptional() @IsString() @MaxLength(80) area?: string;
  @IsOptional() @IsString() @MaxLength(80) governorate?: string;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
}
export class LabBookBody {
  @IsString() labId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) testCodes!: string[];
  @IsIn(['HOME', 'WALK_IN']) collectionType!: 'HOME' | 'WALK_IN';
  @ValidateNested() @Type(() => LabSlotBody) slot!: LabSlotBody;
  @IsOptional() @ValidateNested() @Type(() => LabAddressBody) address?: LabAddressBody;
}

/** Lab marketplace (launch-locked `kiorex.lab_bookings`): new actions gated; own bookings stay readable/cancellable when OFF. */
@ApiTags('lab')
@Controller()
export class LabController {
  constructor(private readonly svc: LabService) {}

  @Get('lab/tests') @RequiresFlag('kiorex.lab_bookings') @ApiOperation({ summary: 'Lab test catalogue search' }) @ApiOkResponse({ type: LabTestsResultDto })
  tests(@Query('q') q?: string, @Query('labId') labId?: string) { return this.svc.searchTests({ q, labId }); }

  @Get('lab/slots') @RequiresFlag('kiorex.lab_bookings') @ApiOperation({ summary: 'Collection slots (home collection or walk-in) from the lab' }) @ApiOkResponse({ type: LabSlotsResultDto })
  slots(@Query('labId') labId: string, @Query('collectionType') collectionType = 'HOME', @Query('from') from?: string, @Query('to') to?: string, @Query('tests') tests?: string) {
    if (!labId) throw badRequest('LAB_REQUIRED', 'labId required');
    const f = from ? new Date(from) : new Date();
    const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw badRequest('INVALID_RANGE', 'invalid from/to');
    return this.svc.slots(labId, collectionType, f, t, tests);
  }

  @Post('lab/bookings') @HttpCode(201) @RequiresFlag('kiorex.lab_bookings')
  @ApiOperation({ summary: 'Book tests + collection slot; returns the booking with a Kiorex Pay checkout. After payment the order is sent to Kiorly Lab' })
  @ApiCreatedResponse({ type: LabBookingDto })
  book(@CurrentUser() u: AuthUser, @Body() b: LabBookBody) { return this.svc.book(u.sub, b); }

  @Get('lab/bookings') @ApiOkResponse({ type: LabBookingDto, isArray: true }) list(@CurrentUser() u: AuthUser) { return this.svc.list(u.sub); }
  @Get('lab/bookings/:id') @ApiOkResponse({ type: LabBookingDto }) get(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.get(u.sub, id); }
  @Post('lab/bookings/:id/cancel') @HttpCode(200) @ApiOkResponse({ type: LabBookingDto }) cancel(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.cancel(u.sub, id); }

  @ApiOkResponse({ schema: { type: 'array', items: { allOf: [{ $ref: '#/components/schemas/LabBookingDto' }, { type: 'object', properties: { sub: { type: 'string' }, platformFeeMinor: { type: 'number' }, takeRateBps: { type: 'number' } } }] } } })

  @OpsOnly() @Get('admin/lab/bookings') @ApiOperation({ summary: 'OP: lab bookings (status filter)' }) opsList(@Query('status') status?: string) { return this.svc.opsList(status); }
  @ApiOkResponse({ schema: { type: 'object', properties: { status: { type: 'string', description: 'SUBMITTED | REJECTED | ...' } } } })
  @OpsOnly() @Post('admin/lab/bookings/:id/resubmit') @HttpCode(200) @ApiOperation({ summary: 'OP: re-send a PAID booking to Kiorly Lab (idempotent)' }) resubmit(@Param('id') id: string) { return this.svc.resubmit(id); }
}
