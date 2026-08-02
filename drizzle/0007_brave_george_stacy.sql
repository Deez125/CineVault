ALTER TABLE "referrals" ADD COLUMN "trigger_payment_intent_id" text;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "reversed_reason" text;--> statement-breakpoint
CREATE INDEX "referrals_trigger_payment_idx" ON "referrals" USING btree ("trigger_payment_intent_id");