ALTER TABLE "deal_coupons" ADD COLUMN "expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deal_coupons" ADD COLUMN "expired_reason" text;--> statement-breakpoint
ALTER TABLE "deal_posts" ADD COLUMN "reply_to" bigint;