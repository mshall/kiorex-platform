import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { badRequest } from '../common/errors';
import { CHANNELS, DEVICE_PLATFORMS, EngagementService } from './engagement.service';
import { DeviceDto, InboxItemDto, NotificationPreferenceDto } from './engagement.dto';
import { OkDto } from '../common/dto';

class PrefBody {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietEnd?: number;
}

class DeviceBody {
  @IsIn(DEVICE_PLATFORMS as unknown as string[]) platform!: 'IOS' | 'ANDROID' | 'WEB';
  @IsString() @MinLength(16) @MaxLength(4096) token!: string;
  @IsOptional() @IsString() @MaxLength(40) appVersion?: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: string;
}

@ApiTags('engagement')
@Controller('me')
export class EngagementController {
  constructor(private readonly svc: EngagementService) {}
  @ApiOkResponse({ type: InboxItemDto, isArray: true })
  @Get('notifications') @ApiOperation({ summary: 'KXM-NT-01 in-app notification inbox' }) inbox(@CurrentUser() u: AuthUser) { return this.svc.inbox(u.sub); }
  @ApiOkResponse({ type: OkDto })
  @Post('notifications/:id/read') @HttpCode(200) read(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.markRead(u.sub, id); }
  @ApiOkResponse({ type: NotificationPreferenceDto, isArray: true })
  @Get('notification-preferences') @ApiOperation({ summary: 'KXM-NT-02 per-channel opt-out and quiet hours' }) prefs(@CurrentUser() u: AuthUser) { return this.svc.preferences(u.sub); }
  @ApiOkResponse({ type: NotificationPreferenceDto })
  @Put('notification-preferences/:channel')
  setPref(@CurrentUser() u: AuthUser, @Param('channel') channel: string, @Body() b: PrefBody) {
    if (!(CHANNELS as readonly string[]).includes(channel)) throw badRequest('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|PUSH|SMS|EMAIL');
    return this.svc.setPreference(u.sub, channel, b);
  }

  @ApiCreatedResponse({ type: DeviceDto })
  @Post('devices') @HttpCode(201) @ApiOperation({ summary: 'KXM-NT push device registry: register or refresh this app instance\'s push token (idempotent on the token; never echoed back)' })
  registerDevice(@CurrentUser() u: AuthUser, @Body() b: DeviceBody) { return this.svc.registerDevice(u.sub, b); }
  @ApiOkResponse({ type: DeviceDto, isArray: true })
  @Get('devices') listDevices(@CurrentUser() u: AuthUser) { return this.svc.listDevices(u.sub); }
  @ApiOkResponse({ type: OkDto })
  @Delete('devices/:id') removeDevice(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.removeDevice(u.sub, id); }
}
