# Telesales Recruitment Portal

A lightweight, mobile-first recruitment portal for hiring Telesales Representatives — built from the V1 PRD. Candidates apply from their phone in a few minutes; the recruitment team runs the whole pipeline (review → interview → recruited/rejected) from a single admin console, with automatic email + WhatsApp notifications at every stage.

## Stack

- **Backend:** Node.js + Express (exported as a handler so it runs as a Vercel serverless function, or as a normal long-running server anywhere else)
- **Database:** Postgres, hosted on [Supabase](https://supabase.com) (via `pg`)
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no bundler)
- **Auth:** Cookie sessions + bcrypt for the admin console
- **File uploads:** CVs stored in Supabase Storage (public bucket, auto-created on first upload)
- **Notifications:** Email + WhatsApp sends are **simulated** and logged to the Notification Log — swap in a real provider in `src/notify.js` when you're ready (see below)

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
- Automatic (simulated) email + WhatsApp notifications for: application received, interview scheduled, interview reminder, recruited, rejected — with a full send log per applicant.
- Basic audit trail: every stage change is timestamped and attributed to the admin who made it.

## Wiring up real email & WhatsApp

Everything currently funnels through `src/notify.js`, which fills in the templates and writes to `notification_log`. To go live:

1. Add an email provider (Resend, SendGrid, or Amazon SES) and a WhatsApp Cloud API client, with credentials in `.env`.
2. In `sendNotification()`, replace the two `logSend(...)` calls with real API calls, and store the returned `provider_message_id` / `status` from each provider instead of the simulated values.

No other code needs to change — the rest of the app already calls `sendNotification()` at the right points (submission, stage change, interview scheduling, manual reminder).

## Before deploying to production

- Change `SESSION_SECRET` to a long random string.
- Change the seeded admin password (`Telesales2026!`) immediately after first login — there's currently no in-app "change password" flow, so update it directly via SQL against the `admins` table (Supabase's SQL editor works fine).
- Vercel gives you HTTPS by default.

## Project structure

```
server.js              Express app + all API routes; exports the app for Vercel
src/db.js               Postgres connection, schema, seed data (src/db.js's ready() runs once per warm instance)
src/notify.js           Notification templating + (simulated) send + logging
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
