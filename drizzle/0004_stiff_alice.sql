ALTER TABLE "tickets" ADD COLUMN "priority" text DEFAULT 'normal' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "category" text DEFAULT 'general' NOT NULL;