-- Wave 9 GC-5: the assistant may send a one-time CONSENT link (invite to allow AI_PROCESSING in the patient's own account). Additive: widens the allowed intents.
ALTER TABLE "AssistantLink" DROP CONSTRAINT IF EXISTS "AssistantLink_intent_check";
ALTER TABLE "AssistantLink" ADD CONSTRAINT "AssistantLink_intent_check" CHECK ("intent" IN ('BOOK','VERIFY','PAY','CONSENT'));
