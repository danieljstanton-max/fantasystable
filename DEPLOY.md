# Deploying Fantasy Stable

This is a one-off runbook. Once, at launch, the person deploying works through
it top to bottom. After that the game is live and everything happens on its
own — Vercel builds on every push, cron endpoints run themselves, GitHub
Actions ingest data every 15 minutes.

Written for a Vercel + Neon + GitHub setup on `fantasystable.co.uk`. It takes
about an hour total, most of which is waiting for DNS.

## What's involved

- **Vercel** hosts the app and runs the two game-side cron jobs (settle,
  prices snapshot)
- **Neon** holds the Postgres (already set up — the dev URL points here)
- **GitHub Actions** runs the racing-data ingest every 15 minutes (see
  `.github/workflows/ingest.yml`)
- **Resend** sends the sign-in emails
- **Google OAuth** (optional) for Continue with Google

## 1. Push the repo to GitHub

    git remote add origin git@github.com:<you>/fantasy-stable.git
    git push -u origin main

Anything already committed is fine. The scratchpad in `/private/tmp` is
ignored by Vercel automatically.

## 2. Import into Vercel

Vercel dashboard → New Project → import the GitHub repo. Framework is
detected as Next.js. Do NOT deploy yet — set the environment variables
first, or the first build will succeed but the app will 500 on every DB call.

### Environment variables

Copy every value from `.env.local` on your Mac into **Environment Variables**
in the Vercel project settings. Set each for **Production** and **Preview**
(and typically Development too):

    DATABASE_URL              — the Neon pooler URL, sslmode=require
    RACING_API_USERNAME       — from The Racing API
    RACING_API_PASSWORD       — from The Racing API
    NEXT_PUBLIC_SITE_URL      — https://fantasystable.co.uk
    RESEND_API_KEY            — from resend.com (see step 5)
    MAIL_FROM                 — Fantasy Stable <noreply@fantasystable.co.uk>
    CRON_SECRET               — anything long and random (openssl rand -hex 24)
    GOOGLE_CLIENT_ID          — if you want Continue with Google
    GOOGLE_CLIENT_SECRET      — as above

`REVALIDATE_SECRET`, `HRT_URL`, `HRT_TOKEN`, `HRT_AUTOPUBLISH` are for the
racing site's WordPress integration. They are NOT needed for the game.

Then click Deploy. First build takes ~2 minutes.

## 3. Add the domain

Domains → Add → `fantasystable.co.uk` and `www.fantasystable.co.uk`. Vercel
tells you the DNS records to add at your registrar.

Typical setup:

    A       @      76.76.21.21
    CNAME   www    cname.vercel-dns.com

Propagation is minutes to a few hours. Once green in Vercel, the site is
live on the domain. `NEXT_PUBLIC_SITE_URL` must match the primary domain
exactly — capital-sensitive schemes matter (`https://` not `http://`).

## 4. Turn on the Vercel Crons

`vercel.json` in the repo defines two crons — you don't have to configure
them in the dashboard. On the first deploy after this file exists, Vercel
picks them up:

- `/api/cron/game-prices-snapshot` every 15 minutes 8–15 UTC on Saturdays
  (this is the deadline window — you can widen it if you add Sunday cards)
- `/api/cron/settle-game` every 30 minutes 13–22 UTC on Saturdays

Both endpoints are gated by the `CRON_SECRET` env var above; Vercel Cron
sends it in the Authorization header automatically. Nobody with the URL
alone can trigger them.

## 5. Set up Resend for the sign-in emails

resend.com → sign up → add `fantasystable.co.uk` as a sending domain.
Resend gives you SPF, DKIM and DMARC records to add at your registrar.
Those need to be added and propagate BEFORE the first launch, or every
sign-in link goes straight to spam.

Test with https://mail-tester.com — send a sign-in from the deployed site
to the address it gives you, check the score. Under 8/10, don't launch.

`MAIL_FROM` matters: use `noreply@fantasystable.co.uk`, not `@resend.dev`
or a Gmail address, or DKIM won't line up.

## 6. Set up Google OAuth (optional)

console.cloud.google.com → new project → OAuth consent screen → External,
add your email as test user → Credentials → Create OAuth client ID → Web
application → add redirect URIs:

    http://localhost:3000/api/auth/google/callback
    https://fantasystable.co.uk/api/auth/google/callback

Copy the client id and secret into the Vercel env vars from step 2. On the
next deploy the "Continue with Google" button appears on the sign-in page.
Without those env vars the button is hidden — the site still works on the
magic link.

## 7. Set up the GitHub Actions ingest

The workflow file already exists at `.github/workflows/ingest.yml`. Add
the same three env vars as GitHub secrets so it can reach the database
and The Racing API:

Repo → Settings → Secrets and variables → Actions → New secret:

    DATABASE_URL
    RACING_API_USERNAME
    RACING_API_PASSWORD

Enable Actions if the repo is private (Settings → Actions → General →
Allow all actions). It kicks off on the next schedule tick.

Check the run appears in the Actions tab of the repo after 15 minutes. If
it doesn't, the schedule cron takes up to an hour to warm up on private
repos — nudge it manually with "Run workflow" on any of the jobs.

## 8. Push the game_prices baseline

The price-snapshot cron only captures new ticks. To have a baseline
overnight price for the first race week, run once locally the night before
the first Saturday:

    npm run game -- --save

That writes one tick into `game_prices` for today's card.

## 9. First-Saturday checklist

Race week 1 morning:

- **Racecard ingest** ran overnight — check the Actions tab
- **Sign in** on the live domain, save a stable, tap NAP, save
- **Deadline lock** kicks at first-race off_time − 1h — try to edit past it
  and confirm you get "The card is locked"
- **Settlement** fires every 30 minutes — points appear on the Results
  page as each race lands
- **Leaderboard** at `/game/leaderboard` shows real stables

## What to watch on launch day

- **Vercel Logs** — any 500 on the game routes needs immediate attention
- **Neon dashboard** — connection count under 20; watch for connection
  exhaustion during peak
- **Resend dashboard** — email delivery rate, spam complaints
- **GitHub Actions** — ingest is green every 15 minutes

## The one thing that will fail first

Almost every launch of a new domain has magic-link sign-in going straight
to spam for the first 24-48 hours until Gmail warms up your sending
reputation. Send a few sign-ins to your own Gmail early and mark them "Not
spam" if they land there. This is DNS reputation, not a code bug — patience
fixes it.
