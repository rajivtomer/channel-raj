import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    preferences: jsonb("preferences").$type<UserPreferences>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    // SHA-256 of the cookie token, so a database leak does not leak live sessions.
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export interface UserPreferences {
  /** IANA zone used for queue slots and best-time suggestions. */
  timezone?: string;
  /** How the AI assistant should sound when writing captions and replies. */
  brandVoice?: string;
}

/** google and meta hold OAuth app credentials; anthropic holds an API key for the AI assistant. */
export type Provider = "google" | "meta" | "anthropic";
export type OAuthProvider = Exclude<Provider, "anthropic">;
export type CredentialStatus = "unverified" | "valid" | "invalid";

/** A user's own developer app credentials for one provider. */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").$type<Provider>().notNull(),
    clientId: text("client_id").notNull(),
    clientSecretEnc: text("client_secret_enc").notNull(),
    status: text("status").$type<CredentialStatus>().notNull().default("unverified"),
    statusMessage: text("status_message"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("provider_credentials_user_provider_idx").on(t.userId, t.provider)],
);

export type Platform = "youtube" | "facebook" | "instagram";
export type ChannelStatus = "connected" | "expired" | "error";

/** A connected YouTube channel, Facebook Page or Instagram professional account. */
export const channels = pgTable(
  "channels",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").$type<Platform>().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull(),
    handle: text("handle"),
    avatarUrl: text("avatar_url"),
    followers: integer("followers"),
    // Instagram accounts are reached through the Facebook Page they are linked to.
    parentExternalId: text("parent_external_id"),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    status: text("status").$type<ChannelStatus>().notNull().default("connected"),
    statusMessage: text("status_message"),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
    settings: jsonb("settings").$type<ChannelSettings>().notNull().default({}),
    metricsSyncedAt: timestamp("metrics_synced_at", { withTimezone: true }),
    inboxSyncedAt: timestamp("inbox_synced_at", { withTimezone: true }),
    syncError: text("sync_error"),
    connectedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("channels_user_platform_external_idx").on(t.userId, t.platform, t.externalId),
    index("channels_user_idx").on(t.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type ProviderCredential = typeof providerCredentials.$inferSelect;
export type Channel = typeof channels.$inferSelect;

/** Per-channel defaults applied when composing. Platform-specific keys are optional. */
export interface ChannelSettings {
  defaultHashtags?: string;
  captionSuffix?: string;
  firstComment?: string;
  /** Weekly posting slots for "Add to queue", as "d@HH:MM" with d = 0 (Sunday) to 6, in the user's timezone. */
  queueSlots?: string[];
  youtube?: {
    privacy?: "public" | "unlisted" | "private";
    categoryId?: string;
    tags?: string;
    madeForKids?: boolean;
    playlistId?: string;
    notifySubscribers?: boolean;
  };
}

export type MediaKind = "image" | "video";

export const mediaAssets = pgTable(
  "media_assets",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    pathname: text("pathname").notNull(),
    filename: text("filename").notNull(),
    kind: text("kind").$type<MediaKind>().notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    width: integer("width"),
    height: integer("height"),
    durationSec: integer("duration_sec"),
    createdAt: createdAt(),
  },
  (t) => [index("media_assets_user_idx").on(t.userId, t.createdAt)],
);

export type PostStatus = "draft" | "scheduled" | "publishing" | "published" | "partial" | "failed";

export const posts = pgTable(
  "posts",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    caption: text("caption").notNull().default(""),
    mediaIds: jsonb("media_ids").$type<string[]>().notNull().default([]),
    status: text("status").$type<PostStatus>().notNull().default("draft"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    // Set when an automation re-shared an earlier post.
    recycledFrom: text("recycled_from"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("posts_user_idx").on(t.userId, t.scheduledAt), index("posts_due_idx").on(t.status, t.scheduledAt)],
);

/** Platform-specific options for one target. */
export interface TargetOptions {
  youtube?: {
    title?: string;
    tags?: string;
    privacy?: "public" | "unlisted" | "private";
    categoryId?: string;
    madeForKids?: boolean;
    playlistId?: string;
    thumbnailAssetId?: string;
    notifySubscribers?: boolean;
  };
  instagram?: { format?: "feed" | "reel" | "story"; shareToFeed?: boolean };
  facebook?: { link?: string };
  firstComment?: string;
}

/** Latest engagement numbers read back from the platform. Missing means the platform didn't report it. */
export interface TargetMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reach?: number;
}

export type TargetStatus = "pending" | "processing" | "published" | "failed";

export const postTargets = pgTable(
  "post_targets",
  {
    id: id(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    caption: text("caption"),
    options: jsonb("options").$type<TargetOptions>().notNull().default({}),
    status: text("status").$type<TargetStatus>().notNull().default("pending"),
    // Instagram media containers are processed asynchronously; we poll them.
    containerId: text("container_id"),
    nextCheckAt: timestamp("next_check_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    externalId: text("external_id"),
    externalUrl: text("external_url"),
    error: text("error"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metrics: jsonb("metrics").$type<TargetMetrics>(),
    metricsAt: timestamp("metrics_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("post_targets_post_channel_idx").on(t.postId, t.channelId),
    index("post_targets_processing_idx").on(t.status, t.nextCheckAt),
  ],
);

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type PostTarget = typeof postTargets.$inferSelect;

/** One follower count per channel per day, for growth charts. */
export const channelStats = pgTable(
  "channel_stats",
  {
    id: id(),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    day: text("day").notNull(),
    followers: integer("followers").notNull(),
  },
  (t) => [uniqueIndex("channel_stats_channel_day_idx").on(t.channelId, t.day)],
);

export type InboxStatus = "open" | "done" | "hidden";

/** A comment on one of the user's posts or videos, from any platform. */
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelId: text("channel_id")
      .notNull()
      .references(() => channels.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    // The post or video the comment is on.
    objectId: text("object_id").notNull(),
    objectTitle: text("object_title"),
    objectUrl: text("object_url"),
    authorName: text("author_name").notNull(),
    authorAvatar: text("author_avatar"),
    text: text("text").notNull(),
    likeCount: integer("like_count").notNull().default(0),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
    status: text("status").$type<InboxStatus>().notNull().default("open"),
    replyText: text("reply_text"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    // Which automation (if any) handled this comment.
    handledBy: text("handled_by"),
    firstSeenAt: createdAt(),
  },
  (t) => [
    uniqueIndex("inbox_items_channel_external_idx").on(t.channelId, t.externalId),
    index("inbox_items_user_idx").on(t.userId, t.status, t.postedAt),
  ],
);

export type AutomationKind = "auto_reply" | "auto_hide" | "recycle";

export interface AutomationConfig {
  /** Empty means every connected channel. */
  channelIds?: string[];
  /** auto_reply / auto_hide: match when a comment contains any of these (case-insensitive). Empty matches all (auto_reply only). */
  keywords?: string[];
  /** auto_reply: fixed reply text; ignored when useAi is set. */
  replyText?: string;
  /** auto_reply: let the AI assistant write each reply in the brand voice. */
  useAi?: boolean;
  /** auto_hide: also hide comments that contain links. */
  hideLinks?: boolean;
  /** recycle: re-share the best post that is at least this many days old. */
  minAgeDays?: number;
  /** recycle: how often to re-share, in days. */
  everyDays?: number;
  /** recycle: rewrite the caption with AI so it doesn't read as a duplicate. */
  refreshCaption?: boolean;
}

export const automations = pgTable(
  "automations",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").$type<AutomationKind>().notNull(),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<AutomationConfig>().notNull().default({}),
    // Comments seen before this moment are never acted on, so turning a rule on doesn't sweep old threads.
    activeSince: timestamp("active_since", { withTimezone: true }).notNull().defaultNow(),
    runCount: integer("run_count").notNull().default(0),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("automations_user_idx").on(t.userId)],
);

export const automationLog = pgTable(
  "automation_log",
  {
    id: id(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ok: boolean("ok").notNull(),
    detail: text("detail").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("automation_log_user_idx").on(t.userId, t.createdAt)],
);

export type InboxItem = typeof inboxItems.$inferSelect;
export type Automation = typeof automations.$inferSelect;
export type AutomationLogEntry = typeof automationLog.$inferSelect;
