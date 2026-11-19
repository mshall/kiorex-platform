import { Global, Module } from '@nestjs/common';
import { RecordsService } from './records.service';
import { STORAGE, storageAdapter } from './storage';
import { VaultController } from './vault.controller';

@Global()
@Module({ controllers: [VaultController], providers: [RecordsService, { provide: STORAGE, useFactory: storageAdapter }], exports: [RecordsService] })
export class RecordsModule {}
