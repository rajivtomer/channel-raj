CREATE TABLE "automation_log" (
	"id" text PRIMARY KEY NOT NULL,
	"automation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"ok" boolean NOT NULL,
	"detail" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active_since" timestamp with time zone DEFAULT now() NOT NULL,
	"run_count" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_stats" (
	"id" text PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"day" text NOT NULL,
	"followers" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inbox_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"channel_id" text NOT NULL,
	"external_id" text NOT NULL,
	"object_id" text NOT NULL,
	"object_title" text,
	"object_url" text,
	"author_name" text NOT NULL,
	"author_avatar" text,
	"text" text NOT NULL,
	"like_count" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"reply_text" text,
	"replied_at" timestamp with time zone,
	"handled_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "metrics_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "inbox_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "channels" ADD COLUMN "sync_error" text;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "metrics" jsonb;--> statement-breakpoint
ALTER TABLE "post_targets" ADD COLUMN "metrics_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "recycled_from" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_log" ADD CONSTRAINT "automation_log_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_log" ADD CONSTRAINT "automation_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_stats" ADD CONSTRAINT "channel_stats_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_items" ADD CONSTRAINT "inbox_items_channel_id_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_log_user_idx" ON "automation_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "automations_user_idx" ON "automations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_stats_channel_day_idx" ON "channel_stats" USING btree ("channel_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_items_channel_external_idx" ON "inbox_items" USING btree ("channel_id","external_id");--> statement-breakpoint
CREATE INDEX "inbox_items_user_idx" ON "inbox_items" USING btree ("user_id","status","posted_at");