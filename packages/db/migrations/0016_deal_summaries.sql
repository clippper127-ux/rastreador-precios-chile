CREATE TABLE "deal_summaries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "deal_summaries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"channel_id" text NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"bullets" text[] DEFAULT '{}'::text[] NOT NULL,
	"useful" boolean DEFAULT false NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"first_external_id" bigint,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_summaries" ADD CONSTRAINT "deal_summaries_channel_id_deal_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."deal_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_summaries_channel_idx" ON "deal_summaries" USING btree ("channel_id","created_at" DESC NULLS LAST);--> statement-breakpoint
-- Solo el servidor la lee (nada por la API pública de Supabase).
ALTER TABLE "deal_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "deal_summaries" FROM anon, authenticated;
