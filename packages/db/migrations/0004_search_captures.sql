CREATE TABLE "search_captures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"query_key" text NOT NULL,
	"store_id" text NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_captures" ADD CONSTRAINT "search_captures_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_captures_user_query_idx" ON "search_captures" USING btree ("user_id","query_key","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "search_captures" ADD CONSTRAINT "search_captures_user_id_auth_users_fk" FOREIGN KEY ("user_id") REFERENCES auth.users("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "search_captures" ENABLE ROW LEVEL SECURITY;
