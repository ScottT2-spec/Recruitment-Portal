# Telesales Recruitment Portal

A lightweight, mobile-first recruitment portal for hiring Telesales Representatives — built from the V1 PRD. Candidates apply from their phone in a few minutes; the recruitment team runs the whole pipeline (review → interview → recruited/rejected) from a single admin console, with automatic email + WhatsApp notifications at every stage.

## Stack

Deliberately dependency-light so it runs anywhere with just Node — no build step, no external services required to try it out.

- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3`) — a single `data.sqlite` file, zero setup
- **Frontend:** Vanilla HTML/CSS/JS (no framework, no bundler)
- **Auth:** Cookie sessions + bcrypt for the admin console
- **File uploads:** CVs stored on disk under `public/uploads/`
- **Notifications:** Email + WhatsApp sends are **simulated** and logged to the Notification Log — swap in a real provider in `src/notify.js` when you're ready (see below)

## Getting started

```bash
npm install
cp .env.example .env      # then edit SESSION_SECRET
npm start
```

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

- Change `SESSION_SECRET` in `.env` to a long random string.
- Change the seeded admin password (`Telesales2026!`) immediately after first login — there's currently no in-app "change password" flow, so update it directly via a script or the `admins` table.
- Put the app behind HTTPS.
- Point `data.sqlite` and `public/uploads/` at persistent storage (a mounted volume, or swap SQLite for Postgres) if deploying to an ephemeral filesystem (e.g. most PaaS/container platforms).
- Consider moving CV files to S3 / Cloudflare R2 / Supabase Storage instead of local disk if you're running more than one server instance.

## Project structure

```
server.js              Express app + all API routes
src/db.js               SQLite schema + seed data
src/notify.js           Notification templating + (simulated) send + logging
src/auth.js             Admin session middleware
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
git commit -m "Initial commit: telesales recruitment portal v1"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

(`node_modules/`, `data.sqlite`, `.env`, and uploaded CVs are already gitignored.)

## Out of scope (per PRD)

Onboarding, payroll, attendance/leave management, background checks, candidate scoring/AI ranking, video interviews, and calendar-integration are intentionally not built — this is a recruitment tool, not a full HR system.
