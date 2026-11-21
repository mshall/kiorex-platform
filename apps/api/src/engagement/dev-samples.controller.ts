import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Public } from '../common/auth';
import { cfg } from '../common/config';
import { notFound } from '../common/errors';
import { MessagingHub } from '../messaging/messaging-public';
import { NotifyKind, render, TEMPLATES } from './templates';

export class DevSamplesBody {
  @IsOptional() @IsString() @MaxLength(64) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}
export class DevSamplesResultDto { @ApiProperty() sent!: number; @ApiProperty({ type: [String] }) templates!: string[] }

const SAMPLES: [NotifyKind, Record<string, string>][] = [
  ['BOOKING_CONFIRMED', { doctor: 'Dr. Amira Samy', time: 'Sun 23 Nov 10:30' }],
  ['REMINDER_24H', { doctor: 'Dr. Amira Samy', time: 'Sun 23 Nov 10:30' }],
  ['WAITLIST_OFFER', { doctor: 'Dr. Amira Samy', time: 'Mon 24 Nov 09:00', until: '09:15' }],
  ['DEPOSIT_REFUNDED', {}],
];

/** DEV ONLY (404 in production or when any messaging provider is real): puts one dummy message per key flow into the dev inbox. */
@ApiTags('dev')
@Public()
@Controller('dev/messaging')
export class DevSamplesController {
  constructor(private readonly hub: MessagingHub) {}

  @ApiOkResponse({ type: DevSamplesResultDto })
  @Post('samples') @HttpCode(200) @ApiOperation({ summary: 'DEV: send sample booking-confirmation / reminder / waitlist-offer / deposit-refund messages through the WhatsApp, SMS and email mocks' })
  async samples(@Body() b: DevSamplesBody) {
    if (!cfg().devRoutesEnabled) throw notFound('NOT_FOUND', 'Not found');
    const phone = b.phone ?? '+201000000001'; const email = b.email ?? 'demo.patient@example.test'; const locale = b.locale ?? 'en';
    let sent = 0;
    for (const [kind, params] of SAMPLES) {
      const t = TEMPLATES[kind]; const body = render(locale === 'en' ? t.en : t.ar, params);
      for (const [channel, to] of [['WHATSAPP', phone], ['SMS', phone], ['EMAIL', email]] as const) {
        if ((await this.hub.send({ channel, to, templateId: t.templateId, locale, body })).ok) sent++;
      }
    }
    return { sent, templates: SAMPLES.map(([k]) => TEMPLATES[k].templateId) };
  }
}
