import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth';
import { badRequest } from '../common/errors';
import { CHANNELS, EngagementService } from './engagement.service';

class PrefBody {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietStart?: number;
  @IsOptional() @IsInt() @Min(0) @Max(23) quietEnd?: number;
}

@ApiTags('engagement')
@Controller('me')
export class EngagementController {
  constructor(private readonly svc: EngagementService) {}
  @Get('notifications') @ApiOperation({ summary: 'KXM-NT-01 in-app notification inbox' }) inbox(@CurrentUser() u: AuthUser) { return this.svc.inbox(u.sub); }
  @Post('notifications/:id/read') @HttpCode(200) read(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.markRead(u.sub, id); }
  @Get('notification-preferences') @ApiOperation({ summary: 'KXM-NT-02 per-channel opt-out and quiet hours' }) prefs(@CurrentUser() u: AuthUser) { return this.svc.preferences(u.sub); }
  @Put('notification-preferences/:channel')
  setPref(@CurrentUser() u: AuthUser, @Param('channel') channel: string, @Body() b: PrefBody) {
    if (!(CHANNELS as readonly string[]).includes(channel)) throw badRequest('UNKNOWN_CHANNEL', 'channel must be WHATSAPP|PUSH|SMS|EMAIL');
    return this.svc.setPreference(u.sub, channel, b);
  }
}
