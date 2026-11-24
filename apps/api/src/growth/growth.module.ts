import { Module } from '@nestjs/common';
import { GrowthMaintenanceService } from './maintenance/growth-maintenance.service';

/**
 * Growth core (GRW-P1-B owns the services; B0 only registers the module). Depends only on PrismaModule (global) and reaches other bounded
 * contexts through their *-public façades. Controllers are added by package B (touch, events, evidence) and K (ops config).
 */
@Module({ providers: [GrowthMaintenanceService], exports: [GrowthMaintenanceService] })
export class GrowthModule {}
