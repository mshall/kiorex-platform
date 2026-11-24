import { Global, Module } from '@nestjs/common';
import { KiorlyModule } from '../kiorly/kiorly-public';
import { WaitlistController } from './waitlist.controller';
import { WaitlistService } from './waitlist.service';

@Global()
@Module({ imports: [KiorlyModule], controllers: [WaitlistController], providers: [WaitlistService], exports: [WaitlistService] })
export class WaitlistModule {}
