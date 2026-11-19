import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { WhatsAppBookingService } from './whatsapp-booking.service';

@Module({ controllers: [ChannelsController], providers: [WhatsAppBookingService], exports: [WhatsAppBookingService] })
export class ChannelsModule {}
