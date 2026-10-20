CREATE TABLE "media_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"url" text NOT NULL,
	"pathname" text NOT NULL,
	"filename" text NOT NULL,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"duration_sec" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_targets" (
	"id" text PRIMARY KEY NOT NULL,
	"post_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"caption" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"container_id" text,
	"next_check_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"external_id" text,
	"external_url" text,
	"error" text,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"media_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_targets" ADD CONSTRAINT "post_targets_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_user_idx" ON "media_assets" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "post_targets_post_channel_idx" ON "post_targets" USING btree ("post_id","channel_id");--> statement-breakpoint
CREATE INDEX "post_targets_processing_idx" ON "post_targets" USING btree ("status","next_check_at");--> statement-breakpoint
CREATE INDEX "posts_user_idx" ON "posts" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "posts_due_idx" ON "posts" USING btree ("status","scheduled_at");