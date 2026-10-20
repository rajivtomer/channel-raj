# Channel Toolkit

A multi-user platform for managing YouTube, Instagram and Facebook channels. Each user signs up, adds their own developer app keys on the **API & channels** page, and connects their channels.

## What's in step 1

- Sign-up, login and logout with bcrypt password hashes and database-backed sessions (httpOnly cookie, only a SHA-256 of the token is stored).
- **API & channels** settings page:
  - Save a Google OAuth client (YouTube) and a Meta app (Facebook + Instagram) per user.
  - Keys are verified live against Google and Meta when saved, and can be re-verified any time.
  - Secrets and channel tokens are encrypted at rest with AES-256-GCM.
  - Copyable redirect URI and setup steps for each provider.
- Channel connections via OAuth:
  - YouTube: every channel on the Google account, with refresh tokens and automatic token refresh.
  - Facebook: every Page the user grants, using non-expiring Page tokens.
  - Instagram: every Business/Creator account linked to those Pages.
  - Health check per channel (or all at once) that confirms the token works and refreshes name, avatar and follower counts. Disconnect revokes the Google grant.
- Overview dashboard with follower totals per platform and channels needing attention.

## What's in step 2

- **Media library**: drag-and-drop uploads of photos and videos (JPG, PNG, WebP, MP4, MOV up to 1 GB) straight to Vercel Blob.
- **Composer**: pick channels, media and caption once, then adjust per platform: YouTube title, tags, visibility, category, playlist, custom thumbnail, made-for-kids and subscriber notification; Instagram post/carousel, Reel or Story; Facebook link posts; custom caption and first comment per channel. Live validation of each platform's rules and a preview.
- **Publishing**: YouTube resumable uploads, Facebook text/link, photo, multi-photo and video posts, Instagram single, carousel, Reel and Story posts (with asynchronous processing handled by the scheduler). Publish now, schedule, or save drafts; per-channel delivery status with links and retry.
- **Calendar & queue**: month view, upcoming queue, drafts and history.
- **Channel settings**: per-channel defaults (hashtags, signature, first comment, YouTube defaults) and live profile editing for YouTube (description, keywords) and Facebook Pages (about, description, website, phone). Instagram profile is shown read-only because Instagram's API doesn't allow edits.
- **Scheduler**: `/api/cron/publish` publishes everything due. It is called by a GitHub Actions workflow every 5 minutes, by a daily Vercel Cron as a backup, and whenever a signed-in user opens the app.

### Extra setup for step 2

1. **File storage**: in Vercel, Storage → Create → Blob, connect it to this project (adds `BLOB_READ_WRITE_TOKEN`), then redeploy.
2. **Scheduler**: generate a random `CRON_SECRET`, add it in Vercel → Settings → Environment Variables, and in GitHub → Settings → Secrets and variables → Actions as a repository secret with the same name. If your site isn't `https://channel-rajv.vercel.app`, also add a repository variable `APP_URL`.

## What's in step 3

- **AI assistant** (each user adds their own Anthropic API key under API & channels): write or rewrite captions, tailor one post into a version per channel (including YouTube titles and tags), suggest replies to comments, and refresh captions when re-sharing. Brand voice is set once in settings.
- **Posting queue and best times**: each channel gets weekly queue times; "Add to queue" books the next free slot. Compose suggests the best times from your own engagement history, blended with typical platform windows until you have enough data. All times use your saved time zone.
- **Unified inbox**: comments from YouTube, Facebook and Instagram in one list, with reply, suggested reply, mark done and hide. Synced every 10 minutes.
- **Automations**: auto-reply to comments matching keywords (template or AI), auto-hide spam, links or abusive words, and re-share top-performing evergreen posts on a schedule. Every action is logged. Comment rules only act on comments that arrive after the rule is turned on.
- **Analytics**: audience growth per channel, engagement, views and comments with change versus the previous period, an engagement heatmap by weekday and hour, top posts, and a per-channel table. Stats refresh hourly.

### Extra setup for step 3

1. **AI (optional)**: create a key at console.anthropic.com and paste it under API & channels → AI assistant.
2. **Facebook comments**: step 3 adds the `pages_read_user_content` permission. Reconnect your Meta account once (API & channels → Connect) so the inbox can read comments on Page posts.

## Run locally

```bash
npm install
cp .env.example .env.local   # optional; defaults work for local use
npm run dev                  # http://localhost:3000
```

With no `DATABASE_URL`, an embedded Postgres (PGlite) is stored in `.data/`. Set `DATABASE_URL` to a Postgres/Neon connection string for production. Migrations in `drizzle/` run automatically on start.

In production you must set `ENCRYPTION_KEY` (32 random bytes, base64) and `APP_URL` (the public URL, used for OAuth redirect URIs).

## Provider setup (per user)

**Google / YouTube**: In Google Cloud Console create a project, enable *YouTube Data API v3* and *YouTube Analytics API*, configure the OAuth consent screen, then create a *Web application* OAuth client with redirect URI `APP_URL/api/oauth/google/callback`.

**Meta / Facebook + Instagram**: Create a Business app at developers.facebook.com, add *Facebook Login for Business* and *Instagram*, and add `APP_URL/api/oauth/meta/callback` as a valid OAuth redirect URI. Instagram accounts must be Business or Creator accounts linked to a Facebook Page. Publishing permissions need Meta app review before people other than the app's admins/testers can use them.

## Layout

```
src/app/(auth)        login and signup
src/app/(app)         dashboard and settings (signed-in area)
src/app/api/oauth     OAuth start and callback per provider
src/app/actions       server actions
src/lib/providers     Google and Meta API clients
src/lib               auth, crypto, credentials and channel services
src/db                Drizzle schema and connection
drizzle/              SQL migrations
```

## Next steps

- Step 4: workspaces, roles and approvals, audit log, notifications, deploy.
