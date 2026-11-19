import { Global, Module } from '@nestjs/common';
import { KiorlyClient } from './kiorly.client';

@Global()
@Module({ providers: [KiorlyClient], exports: [KiorlyClient] })
export class KiorlyModule {}
