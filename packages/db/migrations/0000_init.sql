CREATE TYPE "public"."alert_kind" AS ENUM('target', 'drop_pct', 'all_time_low', 'restock');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TYPE "public"."listing_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."price_basis" AS ENUM('no_card', 'with_card');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('api', 'feed', 'pricto', 'server', 'ai', 'extension', 'manual');--> statement-breakpoint
CREATE TYPE "public"."runner" AS ENUM('gha', 'local');--> statement-breakpoint
CREATE TYPE "public"."search_mode" AS ENUM('server', 'link');--> statement-breakpoint
CREATE TYPE "public"."seller_type" AS ENUM('official', 'store', 'third_party');--> statement-breakpoint
CREATE TYPE "public"."stock_status" AS ENUM('in_stock', 'preorder', 'out_of_stock', 'discontinued', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."store_status" AS ENUM('ok', 'degraded', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."strategy_kind" AS ENUM('schema_org', 'next_data', 'css', 'xpath', 'regex', 'jsonpath');--> statement-breakpoint
CREATE TYPE "public"."strategy_origin" AS ENUM('builtin', 'human', 'ai');--> statement-breakpoint
CREATE TYPE "public"."strategy_status" AS ENUM('proposed', 'approved', 'disabled');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"watch_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"snapshot_id" bigint,
	"kind" "alert_kind" NOT NULL,
	"dedupe_key" text NOT NULL,
	"channel" text NOT NULL,
	"status" "alert_status" DEFAULT 'pending' NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "extraction_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" text NOT NULL,
	"kind" "strategy_kind" NOT NULL,
	"config" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"status" "strategy_status" DEFAULT 'proposed' NOT NULL,
	"origin" "strategy_origin" DEFAULT 'human' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fetch_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"runner" "runner" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"listings_checked" integer DEFAULT 0 NOT NULL,
	"snapshots_inserted" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"store_id" text NOT NULL,
	"url" text NOT NULL,
	"external_id" text,
	"ean" text,
	"title" text NOT NULL,
	"image_url" text,
	"seller" text,
	"seller_type" "seller_type",
	"seller_reputation" text,
	"price_normal" integer,
	"price_offer" integer,
	"price_card" integer,
	"card_name" text,
	"stock_status" "stock_status" DEFAULT 'unknown' NOT NULL,
	"shipping_info" text,
	"last_source" "price_source",
	"last_changed_at" timestamp with time zone,
	"last_checked_at" timestamp with time zone,
	"next_check_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_error" text,
	"status" "listing_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "price_snapshots_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"listing_id" uuid NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"price_normal" integer,
	"price_offer" integer,
	"price_card" integer,
	"card_name" text,
	"stock_status" "stock_status" NOT NULL,
	"source" "price_source" NOT NULL,
	"reported_by" uuid
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"brand" text,
	"model" text,
	"variant" jsonb,
	"ean" text,
	"category" text,
	"image_url" text,
	"unit_qty" numeric,
	"unit" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"comuna" text,
	"timezone" text DEFAULT 'America/Santiago' NOT NULL,
	"telegram_chat_id" bigint,
	"email_alerts" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"extension_token_hash" text,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "store_rate" (
	"store_id" text PRIMARY KEY NOT NULL,
	"next_allowed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"domain" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source_chain" "price_source"[] NOT NULL,
	"search_mode" "search_mode" DEFAULT 'link' NOT NULL,
	"search_url_template" text,
	"min_check_interval_min" integer DEFAULT 360 NOT NULL,
	"max_requests_per_min" integer DEFAULT 10 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"status" "store_status" DEFAULT 'ok' NOT NULL,
	"backoff_level" integer DEFAULT 0 NOT NULL,
	"blocked_until" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error_at" timestamp with time zone,
	"last_error" text,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "watch_listings" (
	"watch_id" uuid NOT NULL,
	"listing_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"target_armed" boolean DEFAULT true NOT NULL,
	CONSTRAINT "watch_listings_watch_id_listing_id_pk" PRIMARY KEY("watch_id","listing_id")
);
--> statement-breakpoint
CREATE TABLE "watches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"target_price" integer,
	"drop_pct" numeric,
	"notify_all_time_low" boolean DEFAULT true NOT NULL,
	"notify_restock" boolean DEFAULT true NOT NULL,
	"price_basis" "price_basis" DEFAULT 'no_card' NOT NULL,
	"exclude_third_party" boolean DEFAULT false NOT NULL,
	"channels" text[] DEFAULT '{telegram}'::text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_snapshot_id_price_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."price_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_strategies" ADD CONSTRAINT "extraction_strategies_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listings" ADD CONSTRAINT "listings_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_rate" ADD CONSTRAINT "store_rate_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_listings" ADD CONSTRAINT "watch_listings_watch_id_watches_id_fk" FOREIGN KEY ("watch_id") REFERENCES "public"."watches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_listings" ADD CONSTRAINT "watch_listings_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watches" ADD CONSTRAINT "watches_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_dedupe_uq" ON "alerts" USING btree ("dedupe_key","channel");--> statement-breakpoint
CREATE INDEX "alerts_user_idx" ON "alerts" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "extraction_strategies_store_idx" ON "extraction_strategies" USING btree ("store_id","status","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "listings_url_uq" ON "listings" USING btree ("url");--> statement-breakpoint
CREATE INDEX "listings_product_idx" ON "listings" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "listings_queue_idx" ON "listings" USING btree ("next_check_at") WHERE "listings"."status" = 'active';--> statement-breakpoint
CREATE INDEX "price_snapshots_listing_time_idx" ON "price_snapshots" USING btree ("listing_id","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "products_ean_uq" ON "products" USING btree ("ean") WHERE "products"."ean" is not null;--> statement-breakpoint
CREATE INDEX "watch_listings_listing_idx" ON "watch_listings" USING btree ("listing_id");--> statement-breakpoint
CREATE UNIQUE INDEX "watches_user_product_uq" ON "watches" USING btree ("user_id","product_id");