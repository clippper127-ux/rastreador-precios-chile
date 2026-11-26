ALTER TABLE "profiles" ADD COLUMN "radar_cats_include" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "radar_cats_exclude" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "radar_block_words" text[] DEFAULT '{}'::text[] NOT NULL;