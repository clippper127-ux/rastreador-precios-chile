CREATE TABLE "bot_state" (
	"id" text PRIMARY KEY NOT NULL,
	"last_update_id" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "telegram_link_code" text;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "telegram_link_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bot_state" ENABLE ROW LEVEL SECURITY;
