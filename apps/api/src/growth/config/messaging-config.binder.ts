import { Injectable, OnModuleInit } from '@nestjs/common';
import { MessagingHub, type MessagingChannelsConfig } from '../../messaging/messaging-public';
import { GrowthConfigService } from './growth-config.service';

/**
 * MSG-REAL: feeds the messaging hub with the ACTIVE maker-checker payload of the MESSAGING_CHANNELS kind (market scope first, then global). The hub never imports growth;
 * this binder is the only link. Until a version is ACTIVE the hub runs on the environment contract and the code defaults (so nothing changes for mock mode or tests).
 */
@Injectable()
export class MessagingConfigBinder implements OnModuleInit {
  constructor(private readonly hub: MessagingHub, private readonly config: GrowthConfigService) {}
  onModuleInit() {
    this.hub.setConfigSource(async (market) => {
      const r = await this.config.resolve('MESSAGING_CHANNELS', { market });
      return r.source === 'ACTIVE' ? (r.payload as unknown as MessagingChannelsConfig) : null;
    });
  }
}
