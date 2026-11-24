import { Body, Controller, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsArray, Max, Min, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser } from '../../common/auth';
import { MARKETING_CHANNELS, PreferenceCentreService } from './preference-centre.service';

class QuietHoursBody { @IsInt() @Min(0) @Max(23) start!: number; @IsInt() @Min(0) @Max(23) end!: number }
class ChannelBody { @IsIn([...MARKETING_CHANNELS]) channel!: string; @IsBoolean() enabled!: boolean }
class PreferencesBody {
  @IsOptional() @IsBoolean() analytics?: boolean;
  @IsOptional() @IsBoolean() reminders?: boolean;
  /** { WHATSAPP?: bool, SMS?: bool, EMAIL?: bool, PUSH?: bool }; unknown channels are rejected by the service. */
  @IsOptional() @IsObject() marketing?: Record<string, boolean>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ChannelBody) channels?: ChannelBody[];
  @IsOptional() @ValidateNested() @Type(() => QuietHoursBody) quietHours?: QuietHoursBody | null;
  @IsOptional() @IsIn(['web', 'app']) source?: string;
}
const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/** GRW-P1-I preference centre API (web page and app screen): per-purpose, per-channel choices, quiet hours, "unsubscribe from all marketing". */
@ApiTags('consent')
@Controller('me/preferences')
export class PreferenceCentreController {
  constructor(private readonly svc: PreferenceCentreService) {}
  @Get() @ApiOperation({ summary: 'GRW-P1-I preference centre: service messages, reminders, analytics, per-channel marketing consent, quiet hours, caps' }) @ApiOkResponse(OBJ)
  get(@CurrentUser() u: AuthUser) { return this.svc.get(u.sub); }
  @Put() @ApiOperation({ summary: 'GRW-P1-I change preferences; every consent change is an append-only audit row and a PatientConsentUpdated event' }) @ApiOkResponse(OBJ)
  put(@CurrentUser() u: AuthUser, @Body() b: PreferencesBody, @Req() req: { ip?: string }) {
    const { source, ...rest } = b;
    return this.svc.update(u.sub, rest as never, { source: source ?? 'web', ip: req.ip });
  }
  @Post('unsubscribe-marketing') @HttpCode(200) @ApiOperation({ summary: 'GRW-P1-I one-step opt-out of every marketing channel' }) @ApiOkResponse(OBJ)
  unsubscribe(@CurrentUser() u: AuthUser, @Req() req: { ip?: string }) { return this.svc.update(u.sub, { marketingAll: false }, { source: 'web', ip: req.ip }); }
}
