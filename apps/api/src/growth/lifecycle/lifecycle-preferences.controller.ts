import { Controller, Get, Inject, forwardRef } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../../common/auth';
import { PreferenceCentreService } from '../../patient/patient-public';
import { LifecyclePolicyService } from './lifecycle-policy.service';

const OBJ = { schema: { type: 'object', additionalProperties: true } } as const;

/**
 * What the patient sees next to the existing preference centre (GRW-P2-E additions only): the four message classes explained, which of them they can switch (only marketing, per channel),
 * the quiet hours and caps in force, and the one-step "stop all marketing" (the existing POST /me/preferences/unsubscribe-marketing). Wording lives in the clients (AR and EN);
 * the API returns keys and states, never prose.
 */
@ApiTags('consent')
@Controller('me/preferences/classes')
export class LifecyclePreferencesController {
  constructor(@Inject(forwardRef(() => PreferenceCentreService)) private readonly prefs: PreferenceCentreService, private readonly policies: LifecyclePolicyService) {}

  @Get() @ApiOperation({ summary: 'GRW-P2-E the four message classes, what is required and what is optional, quiet hours and caps' }) @ApiOkResponse(OBJ)
  async get(@CurrentUser() u: AuthUser) {
    const p = await this.prefs.get(u.sub);
    const policy = await this.policies.resolve('EG');
    const marketing = p.marketing as { available: boolean; anyConsent: boolean; channels: Array<{ channel: string; marketingConsent: boolean; suppressed: boolean }> };
    return {
      classes: [
        { class: 'TRANSACTIONAL', required: true, switchable: false, descriptionKey: 'lifecycle.class.transactional' },
        { class: 'SECURITY', required: true, switchable: false, descriptionKey: 'lifecycle.class.security' },
        { class: 'CLINICAL', required: true, switchable: false, descriptionKey: 'lifecycle.class.clinical' },
        { class: 'MARKETING', required: false, switchable: true, available: marketing.available, active: marketing.anyConsent, channels: marketing.channels.map((c) => ({ channel: c.channel, consent: c.marketingConsent, suppressed: c.suppressed })), descriptionKey: 'lifecycle.class.marketing' },
      ],
      reminders: p.reminders,
      quietHours: p.quietHours,
      caps: { perDay: Math.min(policy.caps.perDay, p.caps.perDay), perWeek: Math.min(policy.caps.perWeek, p.caps.perWeek) },
      stopAllMarketing: { method: 'POST', path: '/me/preferences/unsubscribe-marketing' },
    };
  }
}
