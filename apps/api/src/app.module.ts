import { Module } from '@nestjs/common';
import { AiGatewayModule } from './ai-gateway/ai-gateway-public';
import { AuthModule } from './auth/auth-public';
import { BookingModule } from './booking/booking-public';
import { CatalogModule } from './catalog/catalog-public';
import { ControlPlaneModule } from './control-plane/control-plane-public';
import { EngagementModule } from './engagement/engagement-public';
import { HealthModule } from './health/health.module';
import { AnalyticsModule } from './analytics/analytics-public';
import { MarketModule } from './market/market-public';
import { MessagingModule } from './messaging/messaging-public';
import { KiorlyModule } from './kiorly/kiorly-public';
import { OpsModule } from './ops/ops.module';
import { OutboxModule } from './outbox/outbox-public';
import { LabModule } from './lab/lab-public';
import { PharmacyModule } from './pharmacy/pharmacy-public';
import { ChannelsModule } from './channels/channels-public';
import { WaitlistModule } from './waitlist/waitlist-public';
import { RecordsModule } from './records/records-public';
import { PatientModule } from './patient/patient-public';
import { PayModule } from './pay/pay-public';
import { TelemedicineModule } from './telemedicine/telemedicine-public';
import { PrismaModule } from './prisma/prisma.module';
import { TrustModule } from './trust/trust-public';
import { WebhooksModule } from './webhooks/webhooks.module';

/** Modular monolith: order matters for APP_GUARD (auth before flag guard). Modules reach each other only via *-public.ts. */
@Module({
  imports: [PrismaModule, OutboxModule, MessagingModule, MarketModule, AnalyticsModule, AuthModule, ControlPlaneModule, KiorlyModule, PatientModule, CatalogModule, EngagementModule, PayModule, BookingModule, TrustModule, AiGatewayModule, WebhooksModule, OpsModule, RecordsModule, WaitlistModule, ChannelsModule, PharmacyModule, LabModule, TelemedicineModule, HealthModule],
})
export class AppModule {}
