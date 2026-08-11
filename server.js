require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const { customAlphabet } = require('nanoid');
const rateLimit = require('express-rate-limit');

const db = require('./src/db');
const { requireAuth } = require('./src/auth');
const { sendNotification } = require('./src/notify');
const { uploadCv, getCvSignedUrl } = require('./src/storage');

const nanoid = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);
const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiting and secure cookies both depend on Express seeing the real
// client IP / protocol. If you deploy behind a reverse proxy or load balancer
// (nginx, an ALB, Cloudflare, etc.) that terminates TLS and forwards
// X-Forwarded-For, set TRUST_PROXY so req.ip and req.secure are accurate:
//   TRUST_PROXY=1        -> trust exactly one hop (most single-LB setups)
//   TRUST_PROXY=loopback -> trust only localhost (app behind local nginx)
// Leave TRUST_PROXY unset if the app is directly internet-facing with no
// proxy in front of it — trusting proxy headers you don't actually have
// lets a client spoof X-Forwarded-For and bypass rate limiting entirely.
if (process.env.TRUST_PROXY) {
  const tp = process.env.TRUST_PROXY;
  app.set('trust proxy', tp === 'true' ? true : (isNaN(Number(tp)) ? tp : Number(tp)));
}

const APPLICANT_FIELDS = [
  'first_name','last_name','email','phone','whatsapp_number','gender','date_of_birth',
  'country','state','city','education_level','employment_status','sales_experience',
  'telesales_experience','experience_duration','previous_company','previous_role',
  'reason_for_applying','comfortable_with_calls','has_smartphone','has_internet',
  'start_availability','preferred_work_arrangement'
];

// Fields required for a *final* submission (excludes explicitly optional/configurable
// PRD fields: gender, date_of_birth, previous_company, previous_role, experience_duration).
const REQUIRED_SUBMIT_FIELDS = [
  'first_name','last_name','email','phone','whatsapp_number',
  'country','state','city','education_level','employment_status',
  'sales_experience','telesales_experience',
  'reason_for_applying','comfortable_with_calls','has_smartphone','has_internet',
  'start_availability','preferred_work_arrangement'
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+()\-\s]{7,20}$/;

// Server-side validation for a final application submission. Returns an array of
// human-readable error strings (empty = valid). Client-side validation exists too,
// but PRD §28 explicitly requires all form input to be validated server-side as well.
function validateSubmission(b) {
  const errors = [];
  for (const f of REQUIRED_SUBMIT_FIELDS) {
    if (!b[f] || !String(b[f]).trim()) errors.push(`${f.replace(/_/g, ' ')} is required`);
  }
  if (b.email && !EMAIL_RE.test(String(b.email).trim())) errors.push('email address is invalid');
  if (b.phone && !PHONE_RE.test(String(b.phone).trim())) errors.push('phone number is invalid');
  if (b.whatsapp_number && !PHONE_RE.test(String(b.whatsapp_number).trim())) errors.push('WhatsApp number is invalid');
  return errors;
}

// ---------- Middleware ----------
app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 12 * 60 * 60 * 1000,
  sameSite: 'lax',
  // Secure by default; set COOKIE_INSECURE=true only for local http:// dev.
  secure: process.env.COOKIE_INSECURE !== 'true'
}));

// Serve the frontend (public/) first — the site should load even if the
// database isn't configured yet. Only /api/* routes need the database.
app.use(express.static(path.join(__dirname, 'public')));

// Ensure DB schema/seed data exists before handling any API request
// (memoized in src/db.js so this only runs once per warm instance).
app.use('/api', async (req, res, next) => {
  try {
    await db.ready();
    next();
  } catch (err) {
    console.error('DB init failed:', err);
    res.status(500).json({ error: 'Database unavailable' });
  }
});

// CV uploads go straight to Supabase Storage — memory storage only, no local disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.doc', '.docx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only PDF, DOC, or DOCX files are allowed'), ok);
  }
});

// Small helper: wraps an async route handler so rejected promises hit Express error handling.
const ah = fn => (req, res, next) => fn(req, res, next).catch(next);

// ---------- Rate limiting (PRD §28: protect against duplicate/spam submissions,
// and brute-force protection on admin login) ----------
const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30, // autosave fires on every step, so this needs headroom above a login-style limit
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a few minutes and try again.' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait a few minutes and try again.' }
});

// ============================================================
// PUBLIC API
// ============================================================

// Get current job posting (public)
app.get('/api/job', ah(async (req, res) => {
  const job = await db.get('SELECT * FROM job_settings WHERE id = 1');
  job.responsibilities = JSON.parse(job.responsibilities || '[]');
  job.requirements = JSON.parse(job.requirements || '[]');
  res.json(job);
}));

// Start / autosave an application (upsert by email+phone, keyed on application_id if provided)
app.post('/api/apply/start', applyLimiter, ah(async (req, res) => {
  const b = req.body;
  let applicant;

  if (b.application_id) {
    applicant = await db.get('SELECT * FROM applicants WHERE application_id = $1', [b.application_id]);
  }
  if (!applicant && (b.email || b.phone)) {
    applicant = await db.get(
      `SELECT * FROM applicants WHERE (email = $1 AND email != '') OR (phone = $2 AND phone != '') ORDER BY id DESC LIMIT 1`,
      [b.email || '', b.phone || '']
    );
  }

  if (applicant) {
    const sets = APPLICANT_FIELDS.map((f, i) => `${f} = COALESCE($${i + 1}, ${f})`).join(', ');
    const values = APPLICANT_FIELDS.map(f => b[f] ?? null);
    await db.query(
      `UPDATE applicants SET ${sets}, updated_at = NOW() WHERE id = $${APPLICANT_FIELDS.length + 1}`,
      [...values, applicant.id]
    );
    applicant = await db.get('SELECT * FROM applicants WHERE id = $1', [applicant.id]);
  } else {
    const appId = 'APP-' + nanoid();
    const cols = ['application_id', ...APPLICANT_FIELDS];
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const values = [appId, ...APPLICANT_FIELDS.map(f => b[f] ?? null)];
    await db.query(`INSERT INTO applicants (${cols.join(', ')}) VALUES (${placeholders})`, values);
    applicant = await db.get('SELECT * FROM applicants WHERE application_id = $1', [appId]);
  }

  res.json({ application_id: applicant.application_id });
}));

// Duplicate check
app.get('/api/apply/check-duplicate', applyLimiter, ah(async (req, res) => {
  const { email, phone } = req.query;
  const existing = await db.get(
    `SELECT application_id, application_status FROM applicants
     WHERE application_status = 'completed' AND ((email = $1 AND email != '') OR (phone = $2 AND phone != ''))
     ORDER BY id DESC LIMIT 1`,
    [email || '', phone || '']
  );
  res.json({ duplicate: !!existing, application_id: existing ? existing.application_id : null });
}));

// Submit final application (with optional CV upload)
app.post('/api/apply/submit', applyLimiter, upload.single('cv'), ah(async (req, res) => {
  const b = req.body;
  if (!b.application_id) return res.status(400).json({ error: 'Missing application_id' });

  const applicant = await db.get('SELECT * FROM applicants WHERE application_id = $1', [b.application_id]);
  if (!applicant) return res.status(404).json({ error: 'Application not found' });

  // Validate against the merged view of previously-saved + newly-submitted fields,
  // since earlier steps may already be persisted from autosave.
  const merged = { ...applicant, ...b };
  const errors = validateSubmission(merged);
  if (errors.length) return res.status(400).json({ error: 'Please complete all required fields', details: errors });

  // PRD §29: block a second completed application for the same email/phone by
  // default. Only an admin can lift this, per-application, via the
  // "allow duplicate" action in the admin panel (sets duplicate_override).
  if (!applicant.duplicate_override) {
    const dup = await db.get(
      `SELECT application_id FROM applicants
       WHERE application_status = 'completed' AND id != $1
         AND ((email = $2 AND email != '') OR (phone = $3 AND phone != ''))
       ORDER BY id DESC LIMIT 1`,
      [applicant.id, merged.email || '', merged.phone || '']
    );
    if (dup) {
      return res.status(409).json({
        error: `An application already exists for this email or phone (${dup.application_id}). ` +
          `If you believe this is a mistake, please contact recruitment support — an admin can allow a new submission.`
      });
    }
  }

  const sets = APPLICANT_FIELDS.map((f, i) => `${f} = COALESCE($${i + 1}, ${f})`);
  const values = APPLICANT_FIELDS.map(f => b[f] ?? null);

  if (req.file) {
    let cvUrl;
    try {
      cvUrl = await uploadCv(req.file);
    } catch (err) {
      console.error('CV upload failed:', err);
      return res.status(502).json({ error: 'CV upload failed, please try again' });
    }
    sets.push(`cv_url = $${values.length + 1}`);
    values.push(cvUrl);
    sets.push(`cv_filename = $${values.length + 1}`);
    values.push(req.file.originalname);
  }

  values.push(applicant.id);
  await db.query(
    `UPDATE applicants SET ${sets.join(', ')},
      application_status = 'completed', submitted_at = NOW(), updated_at = NOW()
      WHERE id = $${values.length}`,
    values
  );

  const updated = await db.get('SELECT * FROM applicants WHERE id = $1', [applicant.id]);
  await sendNotification(updated, 'application_received');

  res.json({ application_id: updated.application_id });
}));

// Candidate: look up their own application status.
// Security: application_id has real entropy and works alone (it's effectively
// a bearer token only the candidate has). Looking up by contact info alone
// would let anyone who knows/guesses a phone number or email pull someone
// else's full application — so that path requires BOTH email AND phone to
// match the same record, not either one individually.
app.get('/api/apply/status', applyLimiter, ah(async (req, res) => {
  const { application_id, email, phone } = req.query;
  let row;
  if (application_id) {
    row = await db.get('SELECT * FROM applicants WHERE application_id = $1', [application_id]);
  } else if (email && phone) {
    row = await db.get(
      `SELECT * FROM applicants WHERE email = $1 AND phone = $2 AND email != '' AND phone != '' ORDER BY id DESC LIMIT 1`,
      [email, phone]
    );
  } else {
    return res.status(400).json({ error: 'Provide an application ID, or both email and phone.' });
  }
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(sanitizeForCandidate(row));
}));

function sanitizeForCandidate(row) {
  const { internal_notes, rejection_reason, ...rest } = row;
  return rest;
}

// ============================================================
// ADMIN AUTH
// ============================================================

app.post('/api/admin/login', loginLimiter, ah(async (req, res) => {
  const { email, password, remember } = req.body;
  const admin = await db.get('SELECT * FROM admins WHERE email = $1', [(email || '').toLowerCase()]);
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.adminId = admin.id;
  // "Remember me" extends the session cookie from the default 12h to 30 days.
  if (remember) req.sessionOptions.maxAge = 30 * 24 * 60 * 60 * 1000;
  res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });
}));

app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, ah(async (req, res) => {
  const admin = await db.get('SELECT id, name, email, role FROM admins WHERE id = $1', [req.session.adminId]);
  res.json(admin);
}));

// ============================================================
// ADMIN: DASHBOARD / ANALYTICS
// ============================================================

app.get('/api/admin/stats', requireAuth, ah(async (req, res) => {
  const c = async (sql, params = []) => {
    const row = await db.get(sql, params);
    return row.c;
  };

  const stats = {
    total_started: await c(`SELECT COUNT(*)::int c FROM applicants`),
    incomplete: await c(`SELECT COUNT(*)::int c FROM applicants WHERE application_status = 'started'`),
    completed: await c(`SELECT COUNT(*)::int c FROM applicants WHERE application_status = 'completed'`),
    under_review: await c(`SELECT COUNT(*)::int c FROM applicants WHERE recruitment_stage = 'under_review'`),
    // Cumulative: everyone ever invited, regardless of what their interview_status
    // has moved on to since (scheduled -> attended/did_not_attend). A snapshot filter
    // on 'scheduled' alone undercounts this once outcomes are recorded.
    interviews_scheduled: await c(`SELECT COUNT(*)::int c FROM applicants WHERE interview_status != 'not_scheduled'`),
    interview_attended: await c(`SELECT COUNT(*)::int c FROM applicants WHERE interview_status = 'attended'`),
    interview_no_show: await c(`SELECT COUNT(*)::int c FROM applicants WHERE interview_status = 'did_not_attend'`),
    recruited: await c(`SELECT COUNT(*)::int c FROM applicants WHERE recruitment_stage = 'recruited'`),
    rejected: await c(`SELECT COUNT(*)::int c FROM applicants WHERE recruitment_stage = 'rejected'`)
  };

  stats.completion_rate = stats.total_started ? Math.round((stats.completed / stats.total_started) * 100) : 0;
  stats.interview_to_recruit_rate = stats.interview_attended ? Math.round((stats.recruited / stats.interview_attended) * 100) : 0;
  stats.application_to_recruit_rate = stats.completed ? Math.round((stats.recruited / stats.completed) * 100) : 0;

  stats.by_state = await db.query(
    `SELECT state, COUNT(*)::int count FROM applicants
     WHERE application_status = 'completed' AND state IS NOT NULL AND state != ''
     GROUP BY state ORDER BY count DESC LIMIT 10`
  );

  stats.by_country = await db.query(
    `SELECT country, COUNT(*)::int count FROM applicants
     WHERE application_status = 'completed' AND country IS NOT NULL AND country != ''
     GROUP BY country ORDER BY count DESC LIMIT 10`
  );

  stats.funnel = [
    { label: 'Started Application', value: stats.total_started },
    { label: 'Completed Application', value: stats.completed },
    { label: 'Under Review', value: stats.under_review },
    { label: 'Interview', value: await c(`SELECT COUNT(*)::int c FROM applicants WHERE recruitment_stage = 'interview'`) },
    { label: 'Attended Interview', value: stats.interview_attended },
    { label: 'Recruited', value: stats.recruited }
  ];

  res.json(stats);
}));

// ============================================================
// ADMIN: APPLICANTS
// ============================================================

app.get('/api/admin/applicants', requireAuth, ah(async (req, res) => {
  const { search, stage, status, country, state, city, interview_attendance,
    sales_experience, telesales_experience, start_availability, sort } = req.query;

  let sql = `SELECT * FROM applicants WHERE 1=1`;
  const params = [];
  const nextParam = value => {
    params.push(value);
    return `$${params.length}`;
  };

  if (search) {
    const p = `%${search}%`;
    sql += ` AND (first_name || ' ' || last_name ILIKE ${nextParam(p)} OR email ILIKE ${nextParam(p)} OR phone ILIKE ${nextParam(p)} OR application_id ILIKE ${nextParam(p)})`;
  }
  if (stage) sql += ` AND recruitment_stage = ${nextParam(stage)}`;
  if (status) sql += ` AND application_status = ${nextParam(status)}`;
  if (country) sql += ` AND country = ${nextParam(country)}`;
  if (state) sql += ` AND state = ${nextParam(state)}`;
  if (city) sql += ` AND city = ${nextParam(city)}`;
  if (interview_attendance) sql += ` AND interview_status = ${nextParam(interview_attendance)}`;
  if (sales_experience) sql += ` AND sales_experience = ${nextParam(sales_experience)}`;
  if (telesales_experience) sql += ` AND telesales_experience = ${nextParam(telesales_experience)}`;
  if (start_availability) sql += ` AND start_availability = ${nextParam(start_availability)}`;

  const sortMap = {
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    interview_date: 'interview_date ASC',
    state: 'state ASC',
    stage: 'recruitment_stage ASC'
  };
  sql += ` ORDER BY ${sortMap[sort] || sortMap.newest}`;

  const rows = await db.query(sql, params);
  res.json(rows);
}));

// Distinct country/state values for admin filter dropdowns (completed applications only)
app.get('/api/admin/applicants/meta/locations', requireAuth, ah(async (req, res) => {
  const countries = await db.query(
    `SELECT DISTINCT country FROM applicants WHERE application_status = 'completed' AND country IS NOT NULL AND country != '' ORDER BY country`
  );
  const states = await db.query(
    `SELECT DISTINCT state FROM applicants WHERE application_status = 'completed' AND state IS NOT NULL AND state != '' ORDER BY state`
  );
  res.json({
    countries: countries.map(r => r.country),
    states: states.map(r => r.state)
  });
}));

// Signed, short-lived URL to view/download an applicant's CV. Generated fresh
// per request — the stored cv_url is a private storage key, not a public link.
app.get('/api/admin/applicants/:id/cv', requireAuth, ah(async (req, res) => {
  const row = await db.get('SELECT cv_url, cv_filename FROM applicants WHERE id = $1', [req.params.id]);
  if (!row || !row.cv_url) return res.status(404).json({ error: 'No CV on file' });
  const url = await getCvSignedUrl(row.cv_url);
  res.json({ url, filename: row.cv_filename });
}));

app.get('/api/admin/applicants/:id', requireAuth, ah(async (req, res) => {
  const row = await db.get('SELECT * FROM applicants WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.internal_notes = JSON.parse(row.internal_notes || '[]');
  const history = await db.query('SELECT * FROM stage_history WHERE applicant_id = $1 ORDER BY created_at DESC', [req.params.id]);
  const notifications = await db.query('SELECT * FROM notification_log WHERE applicant_id = $1 ORDER BY sent_at DESC', [req.params.id]);
  res.json({ ...row, history, notifications });
}));

app.patch('/api/admin/applicants/:id', requireAuth, ah(async (req, res) => {
  const allowed = ['assigned_recruiter'];
  const present = allowed.filter(f => f in req.body);
  if (!present.length) return res.status(400).json({ error: 'Nothing to update' });
  const sets = present.map((f, i) => `${f} = $${i + 1}`);
  const values = present.map(f => req.body[f]);
  values.push(req.params.id);
  await db.query(`UPDATE applicants SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${values.length}`, values);
  res.json({ ok: true });
}));

// Admin-only override: lets this specific in-progress application bypass the
// duplicate-email/phone block on next submit (PRD §29 — "Admin may still
// manually allow duplicates where necessary").
app.post('/api/admin/applicants/:id/allow-duplicate', requireAuth, ah(async (req, res) => {
  await db.query(`UPDATE applicants SET duplicate_override = 1, updated_at = NOW() WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
}));

app.post('/api/admin/applicants/:id/notes', requireAuth, ah(async (req, res) => {
  const row = await db.get('SELECT internal_notes FROM applicants WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const notes = JSON.parse(row.internal_notes || '[]');
  const admin = await db.get('SELECT name FROM admins WHERE id = $1', [req.session.adminId]);
  notes.unshift({ author: admin.name, note: req.body.note, created_at: new Date().toISOString() });
  await db.query(`UPDATE applicants SET internal_notes = $1, updated_at = NOW() WHERE id = $2`, [JSON.stringify(notes), req.params.id]);
  res.json({ ok: true, notes });
}));

// Stage change
app.post('/api/admin/applicants/:id/stage', requireAuth, ah(async (req, res) => {
  const { new_stage, rejection_reason, notes } = req.body;
  const applicant = await db.get('SELECT * FROM applicants WHERE id = $1', [req.params.id]);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  const admin = await db.get('SELECT name FROM admins WHERE id = $1', [req.session.adminId]);

  await db.query(
    `UPDATE applicants SET recruitment_stage = $1, rejection_reason = COALESCE($2, rejection_reason), updated_at = NOW() WHERE id = $3`,
    [new_stage, rejection_reason || null, req.params.id]
  );

  await db.query(
    `INSERT INTO stage_history (applicant_id, previous_stage, new_stage, changed_by, notes) VALUES ($1,$2,$3,$4,$5)`,
    [req.params.id, applicant.recruitment_stage, new_stage, admin.name, notes || null]
  );

  const updated = await db.get('SELECT * FROM applicants WHERE id = $1', [req.params.id]);

  if (new_stage === 'recruited') await sendNotification(updated, 'recruited');
  if (new_stage === 'rejected') await sendNotification(updated, 'rejected');

  res.json({ ok: true });
}));

// Interview scheduling
app.post('/api/admin/applicants/:id/interview', requireAuth, ah(async (req, res) => {
  const { interview_date, interview_time, interview_timezone, interview_type,
    interview_link, interview_address, interview_instructions } = req.body;

  const applicant = await db.get('SELECT * FROM applicants WHERE id = $1', [req.params.id]);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  const admin = await db.get('SELECT name FROM admins WHERE id = $1', [req.session.adminId]);
  const prevStage = applicant.recruitment_stage;

  await db.query(
    `UPDATE applicants SET
      recruitment_stage = 'interview', interview_status = 'scheduled',
      interview_date = $1, interview_time = $2, interview_timezone = $3, interview_type = $4,
      interview_link = $5, interview_address = $6, interview_instructions = $7,
      updated_at = NOW()
      WHERE id = $8`,
    [interview_date, interview_time, interview_timezone, interview_type,
      interview_link || null, interview_address || null, interview_instructions || null, req.params.id]
  );

  if (prevStage !== 'interview') {
    await db.query(
      `INSERT INTO stage_history (applicant_id, previous_stage, new_stage, changed_by, notes) VALUES ($1,$2,$3,$4,$5)`,
      [req.params.id, prevStage, 'interview', admin.name, 'Interview scheduled']
    );
  }

  const updated = await db.get('SELECT * FROM applicants WHERE id = $1', [req.params.id]);
  await sendNotification(updated, 'interview_scheduled');

  res.json({ ok: true });
}));

// Interview attendance
app.post('/api/admin/applicants/:id/attendance', requireAuth, ah(async (req, res) => {
  const { status } = req.body; // attended | did_not_attend
  await db.query(`UPDATE applicants SET interview_status = $1, updated_at = NOW() WHERE id = $2`, [status, req.params.id]);
  res.json({ ok: true });
}));

// Send interview reminder manually
app.post('/api/admin/applicants/:id/remind', requireAuth, ah(async (req, res) => {
  const applicant = await db.get('SELECT * FROM applicants WHERE id = $1', [req.params.id]);
  if (!applicant) return res.status(404).json({ error: 'Not found' });
  await sendNotification(applicant, 'interview_reminder');
  res.json({ ok: true });
}));

// ============================================================
// ADMIN: JOB SETTINGS
// ============================================================

app.get('/api/admin/job-settings', requireAuth, ah(async (req, res) => {
  const job = await db.get('SELECT * FROM job_settings WHERE id = 1');
  res.json(job);
}));

app.put('/api/admin/job-settings', requireAuth, ah(async (req, res) => {
  const b = req.body;
  await db.query(
    `UPDATE job_settings SET
      job_title=$1, job_summary=$2,
      responsibilities=$3, requirements=$4,
      min_salary=$5, max_salary=$6, currency=$7,
      commission_description=$8, employment_type=$9,
      work_arrangement=$10, working_days=$11, working_hours=$12,
      probation_period=$13, performance_expectations=$14,
      payment_schedule=$15, application_open=$16,
      application_deadline=$17, whatsapp_enabled=$18, updated_at=NOW()
      WHERE id = 1`,
    [
      b.job_title, b.job_summary,
      JSON.stringify(b.responsibilities || []), JSON.stringify(b.requirements || []),
      b.min_salary, b.max_salary, b.currency,
      b.commission_description, b.employment_type,
      b.work_arrangement, b.working_days, b.working_hours,
      b.probation_period, b.performance_expectations,
      b.payment_schedule, b.application_open ? 1 : 0,
      b.application_deadline, b.whatsapp_enabled ? 1 : 0
    ]
  );
  res.json({ ok: true });
}));

// ============================================================
// ADMIN: NOTIFICATION TEMPLATES
// ============================================================

app.get('/api/admin/templates', requireAuth, ah(async (req, res) => {
  res.json(await db.query('SELECT * FROM notification_templates'));
}));

app.put('/api/admin/templates/:key', requireAuth, ah(async (req, res) => {
  const { subject, body } = req.body;
  await db.query(
    `UPDATE notification_templates SET subject = $1, body = $2, updated_at = NOW() WHERE key = $3`,
    [subject || null, body, req.params.key]
  );
  res.json({ ok: true });
}));

// ============================================================
// ADMIN: NOTIFICATION LOG
// ============================================================

app.get('/api/admin/notifications', requireAuth, ah(async (req, res) => {
  const rows = await db.query(
    `SELECT n.*, a.first_name, a.last_name, a.application_id
     FROM notification_log n JOIN applicants a ON a.id = n.applicant_id
     ORDER BY n.sent_at DESC LIMIT 200`
  );
  res.json(rows);
}));

// ---------- Fallbacks ----------
app.get('/admin', (req, res) => res.redirect('/admin/'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Vercel imports this module and calls the exported app as a serverless function.
// Locally (or on any long-running host), start a normal listener.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Telesales Recruitment Portal running:`);
    console.log(`  ➜ Careers page:  http://localhost:${PORT}/`);
    console.log(`  ➜ Admin login:   http://localhost:${PORT}/admin/`);
    console.log(`  ➜ Default admin: admin@company.com / Telesales2026!\n`);
  });
}

module.exports = app;
