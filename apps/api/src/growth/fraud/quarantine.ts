import type { PrismaService } from '../../prisma/prisma.service';

/** The audit action written by `FraudHoldService.quarantineTouch` (fraud action QUARANTINE_TOUCH). A quarantined touch is not counted by any report; the touch row and every attribution decision stay untouched. */
export const TOUCH_QUARANTINE_ACTION = 'growth.fraud.touch_quarantine';

/** Touch ids quarantined by the fraud engine (reports only). Bounded: the most recent 100 000 rows of the last 400 days. */
export async function quarantinedTouchIds(prisma: Pick<PrismaService, 'auditLog'>, now = new Date()): Promise<string[]> {
  const rows = await prisma.auditLog.findMany({ where: { action: TOUCH_QUARANTINE_ACTION, createdAt: { gte: new Date(now.getTime() - 400 * 86_400_000) } }, select: { resourceId: true }, take: 100_000 });
  return [...new Set(rows.map((r) => r.resourceId).filter((x): x is string => !!x))];
}
