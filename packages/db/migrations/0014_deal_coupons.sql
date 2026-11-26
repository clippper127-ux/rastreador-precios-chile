CREATE TABLE "deal_coupons" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deal_coupons_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"code" text NOT NULL,
	"store" text,
	"store_key" text DEFAULT '' NOT NULL,
	"benefit" text,
	"min_purchase" integer,
	"post_id" bigint,
	"channel_id" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_coupons" ADD CONSTRAINT "deal_coupons_post_id_deal_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."deal_posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_coupons" ADD CONSTRAINT "deal_coupons_channel_id_deal_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."deal_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deal_coupons_code_store_uq" ON "deal_coupons" USING btree ("code","store_key");--> statement-breakpoint
CREATE INDEX "deal_coupons_seen_idx" ON "deal_coupons" USING btree ("last_seen_at" DESC NULLS LAST);--> statement-breakpoint
-- Igual que las demás tablas: solo el servidor la lee (nada por la API pública de Supabase).
ALTER TABLE "deal_coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "deal_coupons" FROM anon, authenticated;
