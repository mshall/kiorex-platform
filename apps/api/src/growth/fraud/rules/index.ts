import type { FraudRuleDef, FraudRuleId } from '../signals';
import { rBot } from './r_bot';
import { rCancel } from './r_cancel';
import { rCollusion } from './r_collusion';
import { rDup } from './r_dup';
import { rFakeBooking } from './r_fakebooking';
import { rFarm } from './r_farm';
import { rLtReplay } from './r_lt_replay';
import { rRedeem } from './r_redeem';
import { rSelf } from './r_self';
import { rTouchBurst } from './r_touch_burst';
import { rWidgetAbuse } from './r_widget_abuse';

export const FRAUD_RULES_LIST: readonly FraudRuleDef[] = [rSelf, rDup, rBot, rFarm, rFakeBooking, rCollusion, rCancel, rRedeem, rTouchBurst, rWidgetAbuse, rLtReplay];
export const FRAUD_RULE_BY_ID = new Map<FraudRuleId, FraudRuleDef>(FRAUD_RULES_LIST.map((r) => [r.id, r]));
