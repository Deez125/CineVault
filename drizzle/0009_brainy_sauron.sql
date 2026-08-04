CREATE TABLE "pending_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"token_hash" text NOT NULL,
	"referral_code" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pending_signups_email_key" ON "pending_signups" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "pending_signups_token_key" ON "pending_signups" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "pending_signups_expires_idx" ON "pending_signups" USING btree ("expires_at");