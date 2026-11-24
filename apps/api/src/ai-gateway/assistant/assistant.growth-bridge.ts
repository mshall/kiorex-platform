import { FLAGS } from '@kiorex/contracts';

/**
 * The assistant needs three things from the growth module (the ACTIVE ASSISTANT_POLICY, the link-token key and its own two flag keys). The growth barrel must NOT be imported at load time from here: it
 * is part of the documented load-order cycle patient -> engagement -> booking -> growth -> patient (see growth-ports-public.ts), and this folder is loaded by the channel service which the booking
 * path pulls in early. So the flag keys come from the contracts package, and the two services are reached through a dynamic `import()` that runs after every module has loaded.
 */
export const ASSISTANT_FLAG = { ASSISTANT: FLAGS.KIOREX_WHATSAPP_AI_ASSISTANT, REAL_MODEL: FLAGS.GROWTH_ASSISTANT_REAL_MODEL } as const;

let cached: Promise<typeof import('../../growth/growth-public')> | undefined;
export const growthPublic = () => (cached ??= import('../../growth/growth-public'));
