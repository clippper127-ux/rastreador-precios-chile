ALTER TABLE "deal_matches" ADD COLUMN "hot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_posts" ADD COLUMN "reactions" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_posts" ADD COLUMN "replies" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_posts" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "radar_hot_level" smallint DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "radar_hot_words" text[] DEFAULT '{}'::text[] NOT NULL;