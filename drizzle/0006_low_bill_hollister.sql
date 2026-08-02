CREATE TABLE "referral_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"code" text NOT NULL,
	"status" text DEFAULT 'unused' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_by_id" uuid,
	"used_by_email" text,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "users_referral_code_key";--> statement-breakpoint
ALTER TABLE "referrals" ADD COLUMN "link_id" uuid;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_links" ADD CONSTRAINT "referral_links_used_by_id_users_id_fk" FOREIGN KEY ("used_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_links_code_key" ON "referral_links" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "referral_links_owner_idx" ON "referral_links" USING btree ("owner_id","created_at");--> statement-breakpoint
CREATE INDEX "referral_links_status_idx" ON "referral_links" USING btree ("status");--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_link_id_referral_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."referral_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "referral_code";