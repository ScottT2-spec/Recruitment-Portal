# Telesales Recruitment Portal

A lightweight, mobile-first recruitment portal for hiring Telesales Representatives — built from the V1 PRD. Candidates apply from their phone in a few minutes; the recruitment team runs the whole pipeline (review → interview → recruited/rejected) from a single admin console, with automatic email + WhatsApp notifications at every stage.

## Stack

- **Backend:** Node.js + Express (exported as a handler so it runs as a Vercel serverless function, or as a normal long-running server anywhere else)
- **Database:** Postgres, hosted on [Supabase](https://supabase.com) (via `pg`)
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no bundler)
- **Auth:** Cookie sessions + bcrypt for the admin console
- **File uploads:** CVs stored in Supabase Storage (public bucket, auto-created on first upload)
- **Notifications:** Email via **AWS SES**, WhatsApp via the **Meta WhatsApp Business Cloud API** — both wired up in `src/notify.js` (same providers/env-var naming as the AfroStore codebase). Every send is logged to the Notification Log as `sent`, `failed`, or `simulated` (when credentials aren't configured, e.g. local dev) — see below for setup

## Getting started

```bash
npm install
cp .env.example .env      # then fill in SESSION_SECRET, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
npm start
```

The database schema and seed data (admin user, default job posting, notification templates) are created automatically the first time the app handles a request.

## Deploying: Vercel + Supabase

**1. Create a Supabase project**
- [supabase.com](https://supabase.com) → New project.
- Project Settings → API: copy the **Project URL** and the **`service_role` key** (not the `anon` key — the server needs write access to Storage and bypasses RLS with this key).
- Project Settings → Database → Connection string → select the **Transaction pooler** (port `6543`). Serverless functions open/close connections per-invocation, so you need the pooler, not the direct connection (port `5432`), or you'll exhaust Postgres' connection limit.

**2. Set environment variables in Vercel**

Project → Settings → Environment Variables, add:
| Key | Value |
|---|---|
| `DATABASE_URL` | the pooler connection string from step 1 |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `SESSION_SECRET` | a long random string |
| `SUPABASE_CV_BUCKET` | optional, defaults to `cvs` |
| `AWS_ACCESS_KEY_ID` | IAM user/role key with `ses:SendEmail` permission |
| `AWS_SECRET_ACCESS_KEY` | matching secret key |
| `AWS_SES_REGION` | e.g. `us-east-1` — must be a region where SES is set up |
| `SES_FROM_EMAIL` | a verified SES sender address (or verified domain) |
| `SES_FROM_NAME` | display name, e.g. `Careers` |
| `WHATSAPP_ACCESS_TOKEN` | Meta WhatsApp Business Cloud API token |
| `WHATSAPP_PHONE_NUMBER_ID` | the Cloud API phone number ID |

Any of the email/WhatsApp variables can be left unset — that channel just logs as `simulated` instead of failing.

**3. Deploy**

```bash
npm i -g vercel   # if you don't have it
vercel             # first deploy, follow the prompts
vercel --prod
```

Or just connect the GitHub repo in the Vercel dashboard and let it auto-deploy on push — `vercel.json` in this repo already routes all traffic to `server.js` so no extra config is needed there.

The first request after deploy creates the Postgres tables, seeds the admin user (`admin@company.com` / `Telesales2026!`), default job posting, and notification templates, and creates the `cvs` Storage bucket — nothing to run manually.

- Careers page → http://localhost:3000/
- Application status lookup → http://localhost:3000/status.html
- Admin console → http://localhost:3000/admin/
- **Demo admin login:** `admin@company.com` / `Telesales2026!` — change this in production (see below).

The database and an admin user + default job posting + notification templates are seeded automatically on first run.

## What's implemented (V1 scope)

- Public, mobile-first careers page (`/`) with job summary, responsibilities, requirements, compensation, and employment terms — all editable from **Job Settings** in the admin console, no code changes needed.
- 5-step mobile application form (Personal → Location → Experience → Assessment → Review) with progress saved as the candidate goes, duplicate-application detection, and optional CV upload (PDF/DOC/DOCX, 5MB limit).
- Application confirmation screen with a shareable Application ID, plus a public status-lookup page.
- Admin console: dashboard with funnel + state breakdown, searchable/filterable applicant table, full applicant profile (info, notes, stage history, notifications sent), one-click stage moves, interview scheduling + attendance tracking, editable notification templates.
- Automatic email + WhatsApp notifications for: application received, interview scheduled, interview reminder, recruited, rejected — sent via AWS SES and the Meta WhatsApp Cloud API, with a full send log (`sent` / `failed` / `simulated`) per applicant.
- Basic audit trail: every stage change is timestamped and attributed to the admin who made it.

## Email & WhatsApp setup

Everything funnels through `src/notify.js`, which fills in the templates, sends via the real providers when configured, and writes the outcome to `notification_log`.

**Email — AWS SES:**
1. In the SES console, verify your sending domain or the individual `SES_FROM_EMAIL` address.
2. Create an IAM user (or role) with `ses:SendEmail` / `ses:SendRawEmail` permission; use its access key for `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
3. New SES accounts start in the **sandbox** — you can only send to verified recipient addresses until you request production access (SES console → Account dashboard → "Request production access"). Do this before launch or candidate emails will fail.

**WhatsApp — Meta Business Cloud API:**
1. Create a Meta App with the WhatsApp product added, and a WhatsApp Business Account.
2. Generate a long-lived system-user access token (`WHATSAPP_ACCESS_TOKEN`) and grab the Cloud API phone number ID (`WHATSAPP_PHONE_NUMBER_ID`) from the Meta App dashboard.
3. Meta only allows free-form text messages (what this app sends) to a recipient who has messaged your business number within the last 24 hours, or via a pre-approved message Template outside that window. Free-form sends to cold candidates who haven't messaged in will be rejected by Meta — this is a WhatsApp platform rule, not something the app can bypass. For fully cold outbound, register and use approved message Templates instead (not implemented here).

If either provider's env vars are absent, that channel is simply logged as `simulated` — nothing breaks, it just doesn't send.

## Before deploying to production

- Change `SESSION_SECRET` to a long random string.
- Change the seeded admin password (`Telesales2026!`) immediately after first login — there's currently no in-app "change password" flow, so update it directly via SQL against the `admins` table (Supabase's SQL editor works fine).
- Request SES production access (see above) — otherwise emails to real candidates will silently fail while still in the sandbox.
- Vercel gives you HTTPS by default.

## Project structure

```
server.js              Express app + all API routes; exports the app for Vercel
src/db.js               Postgres connection, schema, seed data (src/db.js's ready() runs once per warm instance)
src/notify.js           Notification templating + AWS SES / WhatsApp Cloud API send + logging
src/storage.js           Supabase Storage upload for CVs
src/auth.js             Admin session middleware
vercel.json             Routes all requests to server.js
public/index.html       Careers page
public/status.html      Candidate application-status lookup
public/admin/           Admin login + console (single-page, hash-routed)
public/js/careers.js    Careers page + application form logic
public/js/admin.js      Admin console logic
public/css/             Design tokens + page styles
```

## Pushing to your own repo

```bash
git add -A
git commit -m "Migrate to Postgres/Supabase + Vercel deployment"
git push
```

(`node_modules/` and `.env` are gitignored.)

## Out of scope (per PRD)

Onboarding, payroll, attendance/leave management, background checks, candidate scoring/AI ranking, video interviews, and calendar-integration are intentionally not built — this is a recruitment tool, not a full HR system.
