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

- Step 2: composer, scheduling calendar and queue, media library, per-channel settings.
- Step 3: automation (best-time posting, AI captions, repurposing), unified inbox, analytics.
- Step 4: workspaces, roles and approvals, audit log, notifications, deploy.
