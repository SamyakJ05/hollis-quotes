ALTER TABLE "company_settings" ADD COLUMN "site_visit_keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "details" jsonb;