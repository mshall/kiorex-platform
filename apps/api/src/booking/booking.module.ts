import { Global, Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';

@Global()
@Module({ controllers: [BookingController], providers: [BookingService], exports: [BookingService] })
export class BookingModule {}
