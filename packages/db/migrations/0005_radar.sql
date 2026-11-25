CREATE TYPE "public"."deal_source_kind" AS ENUM('channel', 'group');--> statement-breakpoint
CREATE TABLE "deal_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" "deal_source_kind" NOT NULL,
	"handle" text,
	"chat_id" bigint,
	"title" text,
	"last_post_id" bigint DEFAULT 0 NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_matches" (
	"user_id" uuid NOT NULL,
	"post_id" bigint NOT NULL,
	"reasons" text[] NOT NULL,
	"product_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_matches_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "deal_posts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deal_posts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel_id" text NOT NULL,
	"external_id" bigint NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"text" text NOT NULL,
	"store_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prices" integer[] DEFAULT '{}'::integer[] NOT NULL,
	"discount_pct" integer,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_subscriptions" (
	"user_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deal_subscriptions_user_id_channel_id_pk" PRIMARY KEY("user_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "radar_keywords" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "radar_price_errors" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "deal_matches" ADD CONSTRAINT "deal_matches_post_id_deal_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."deal_posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_posts" ADD CONSTRAINT "deal_posts_channel_id_deal_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."deal_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_subscriptions" ADD CONSTRAINT "deal_subscriptions_channel_id_deal_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."deal_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_matches_user_idx" ON "deal_matches" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "deal_posts_channel_ext_uq" ON "deal_posts" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "deal_posts_posted_idx" ON "deal_posts" USING btree ("posted_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "deal_subscriptions" ADD CONSTRAINT "deal_subscriptions_user_auth_fk" FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "deal_matches" ADD CONSTRAINT "deal_matches_user_auth_fk" FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "deal_channels" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_subscriptions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_posts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "deal_matches" ENABLE ROW LEVEL SECURITY;
