require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { customAlphabet } = require('nanoid');

const db = require('./src/db');
const { requireAuth } = require('./src/auth');
const { sendNotification } = require('./src/notify');

const nanoid = customAlphabet('0123456789ABCDEFGHJKLMNPQRSTUVWXYZ', 6);
const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Middleware ----------
app.use(express.json());
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'dev-secret-change-me'],
  maxAge: 12 * 60 * 60 * 1000
}));

const uploadDir = path.join(__dirname, 'public', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safe = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + path.extname(file.originalname);
      cb(null, safe);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.doc', '.docx'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only PDF, DOC, or DOCX files are allowed'), ok);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// PUBLIC API
// ============================================================

// Get current job posting (public)
app.get('/api/job', (req, res) => {
  const job = db.prepare('SELECT * FROM job_settings WHERE id = 1').get();
  job.responsibilities = JSON.parse(job.responsibilities || '[]');
  job.requirements = JSON.parse(job.requirements || '[]');
  res.json(job);
});

// Start / autosave an application (upsert by email+phone, keyed on application_id if provided)
app.post('/api/apply/start', (req, res) => {
  const b = req.body;
  let applicant;

  if (b.application_id) {
    applicant = db.prepare('SELECT * FROM applicants WHERE application_id = ?').get(b.application_id);
  }
  if (!applicant && (b.email || b.phone)) {
    applicant = db.prepare('SELECT * FROM applicants WHERE (email = ? AND email != \'\') OR (phone = ? AND phone != \'\') ORDER BY id DESC LIMIT 1')
      .get(b.email || '', b.phone || '');
  }

  const fields = [
    'first_name','last_name','email','phone','whatsapp_number','gender','date_of_birth',
    'country','state','city','education_level','employment_status','sales_experience',
    'telesales_experience','experience_duration','previous_company','previous_role',
    'reason_for_applying','comfortable_with_calls','has_smartphone','has_internet',
    'start_availability','preferred_work_arrangement'
  ];

  if (applicant) {
    const sets = fields.map(f => `${f} = COALESCE(@${f}, ${f})`).join(', ');
    db.prepare(`UPDATE applicants SET ${sets}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...b, id: applicant.id });
    applicant = db.prepare('SELECT * FROM applicants WHERE id = ?').get(applicant.id);
  } else {
    const appId = 'APP-' + nanoid();
    const cols = ['application_id', ...fields];
    const placeholders = cols.map(c => '@' + c).join(', ');
    db.prepare(`INSERT INTO applicants (${cols.join(', ')}) VALUES (${placeholders})`)
      .run({ application_id: appId, ...Object.fromEntries(fields.map(f => [f, b[f] ?? null])) });
    applicant = db.prepare('SELECT * FROM applicants WHERE application_id = ?').get(appId);
  }

  res.json({ application_id: applicant.application_id });
});

// Duplicate check
app.get('/api/apply/check-duplicate', (req, res) => {
  const { email, phone } = req.query;
  const existing = db.prepare(`SELECT application_id, application_status FROM applicants
    WHERE application_status = 'completed' AND ((email = ? AND email != '') OR (phone = ? AND phone != ''))
    ORDER BY id DESC LIMIT 1`).get(email || '', phone || '');
  res.json({ duplicate: !!existing, application_id: existing ? existing.application_id : null });
});

// Submit final application (with optional CV upload)
app.post('/api/apply/submit', upload.single('cv'), (req, res) => {
  const b = req.body;
  if (!b.application_id) return res.status(400).json({ error: 'Missing application_id' });

  const applicant = db.prepare('SELECT * FROM applicants WHERE application_id = ?').get(b.application_id);
  if (!applicant) return res.status(404).json({ error: 'Application not found' });

  const fields = [
    'first_name','last_name','email','phone','whatsapp_number','gender','date_of_birth',
    'country','state','city','education_level','employment_status','sales_experience',
    'telesales_experience','experience_duration','previous_company','previous_role',
    'reason_for_applying','comfortable_with_calls','has_smartphone','has_internet',
    'start_availability','preferred_work_arrangement'
  ];
  const sets = fields.map(f => `${f} = COALESCE(@${f}, ${f})`).join(', ');

  let cvUpdate = '';
  const params = { ...Object.fromEntries(fields.map(f => [f, b[f] ?? null])), id: applicant.id };
  if (req.file) {
    cvUpdate = `, cv_url = @cv_url, cv_filename = @cv_filename`;
    params.cv_url = '/uploads/' + req.file.filename;
    params.cv_filename = req.file.originalname;
  }

  db.prepare(`UPDATE applicants SET ${sets}${cvUpdate},
    application_status = 'completed', submitted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = @id`).run(params);

  const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(applicant.id);
  sendNotification(updated, 'application_received');

  res.json({ application_id: updated.application_id });
});

// Candidate: look up their own application status
app.get('/api/apply/status', (req, res) => {
  const { application_id, email, phone } = req.query;
  let row;
  if (application_id) {
    row = db.prepare('SELECT * FROM applicants WHERE application_id = ?').get(application_id);
  } else {
    row = db.prepare(`SELECT * FROM applicants WHERE (email = ? AND email != '') OR (phone = ? AND phone != '') ORDER BY id DESC LIMIT 1`)
      .get(email || '', phone || '');
  }
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(sanitizeForCandidate(row));
});

function sanitizeForCandidate(row) {
  const { internal_notes, rejection_reason, ...rest } = row;
  return rest;
}

// ============================================================
// ADMIN AUTH
// ============================================================

app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = db.prepare('SELECT * FROM admins WHERE email = ?').get((email || '').toLowerCase());
  if (!admin || !bcrypt.compareSync(password || '', admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  req.session.adminId = admin.id;
  res.json({ id: admin.id, name: admin.name, email: admin.email, role: admin.role });
});

app.post('/api/admin/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => {
  const admin = db.prepare('SELECT id, name, email, role FROM admins WHERE id = ?').get(req.session.adminId);
  res.json(admin);
});

// ============================================================
// ADMIN: DASHBOARD / ANALYTICS
// ============================================================

app.get('/api/admin/stats', requireAuth, (req, res) => {
  const c = (sql, ...p) => db.prepare(sql).get(...p).c;

  const stats = {
    total_started: c(`SELECT COUNT(*) c FROM applicants`),
    incomplete: c(`SELECT COUNT(*) c FROM applicants WHERE application_status = 'started'`),
    completed: c(`SELECT COUNT(*) c FROM applicants WHERE application_status = 'completed'`),
    under_review: c(`SELECT COUNT(*) c FROM applicants WHERE recruitment_stage = 'under_review'`),
    interviews_scheduled: c(`SELECT COUNT(*) c FROM applicants WHERE interview_status = 'scheduled'`),
    interview_attended: c(`SELECT COUNT(*) c FROM applicants WHERE interview_status = 'attended'`),
    interview_no_show: c(`SELECT COUNT(*) c FROM applicants WHERE interview_status = 'did_not_attend'`),
    recruited: c(`SELECT COUNT(*) c FROM applicants WHERE recruitment_stage = 'recruited'`),
    rejected: c(`SELECT COUNT(*) c FROM applicants WHERE recruitment_stage = 'rejected'`)
  };

  stats.completion_rate = stats.total_started ? Math.round((stats.completed / stats.total_started) * 100) : 0;
  stats.interview_to_recruit_rate = stats.interview_attended ? Math.round((stats.recruited / stats.interview_attended) * 100) : 0;
  stats.application_to_recruit_rate = stats.completed ? Math.round((stats.recruited / stats.completed) * 100) : 0;

  stats.by_state = db.prepare(`SELECT state, COUNT(*) count FROM applicants
    WHERE application_status = 'completed' AND state IS NOT NULL AND state != ''
    GROUP BY state ORDER BY count DESC LIMIT 10`).all();

  stats.by_country = db.prepare(`SELECT country, COUNT(*) count FROM applicants
    WHERE application_status = 'completed' AND country IS NOT NULL AND country != ''
    GROUP BY country ORDER BY count DESC LIMIT 10`).all();

  stats.funnel = [
    { label: 'Started Application', value: stats.total_started },
    { label: 'Completed Application', value: stats.completed },
    { label: 'Under Review', value: stats.under_review },
    { label: 'Interview', value: c(`SELECT COUNT(*) c FROM applicants WHERE recruitment_stage = 'interview'`) },
    { label: 'Attended Interview', value: stats.interview_attended },
    { label: 'Recruited', value: stats.recruited }
  ];

  res.json(stats);
});

// ============================================================
// ADMIN: APPLICANTS
// ============================================================

app.get('/api/admin/applicants', requireAuth, (req, res) => {
  const { search, stage, status, country, state, city, interview_attendance,
    sales_experience, telesales_experience, start_availability, sort } = req.query;

  let sql = `SELECT * FROM applicants WHERE 1=1`;
  const params = {};

  if (search) {
    sql += ` AND (first_name || ' ' || last_name LIKE @search OR email LIKE @search OR phone LIKE @search OR application_id LIKE @search)`;
    params.search = `%${search}%`;
  }
  if (stage) { sql += ` AND recruitment_stage = @stage`; params.stage = stage; }
  if (status) { sql += ` AND application_status = @status`; params.status = status; }
  if (country) { sql += ` AND country = @country`; params.country = country; }
  if (state) { sql += ` AND state = @state`; params.state = state; }
  if (city) { sql += ` AND city = @city`; params.city = city; }
  if (interview_attendance) { sql += ` AND interview_status = @interview_attendance`; params.interview_attendance = interview_attendance; }
  if (sales_experience) { sql += ` AND sales_experience = @sales_experience`; params.sales_experience = sales_experience; }
  if (telesales_experience) { sql += ` AND telesales_experience = @telesales_experience`; params.telesales_experience = telesales_experience; }
  if (start_availability) { sql += ` AND start_availability = @start_availability`; params.start_availability = start_availability; }

  const sortMap = {
    newest: 'created_at DESC',
    oldest: 'created_at ASC',
    interview_date: 'interview_date ASC',
    state: 'state ASC',
    stage: 'recruitment_stage ASC'
  };
  sql += ` ORDER BY ${sortMap[sort] || sortMap.newest}`;

  const rows = db.prepare(sql).all(params);
  res.json(rows);
});

app.get('/api/admin/applicants/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  row.internal_notes = JSON.parse(row.internal_notes || '[]');
  const history = db.prepare('SELECT * FROM stage_history WHERE applicant_id = ? ORDER BY created_at DESC').all(req.params.id);
  const notifications = db.prepare('SELECT * FROM notification_log WHERE applicant_id = ? ORDER BY sent_at DESC').all(req.params.id);
  res.json({ ...row, history, notifications });
});

app.patch('/api/admin/applicants/:id', requireAuth, (req, res) => {
  const allowed = ['assigned_recruiter'];
  const sets = allowed.filter(f => f in req.body).map(f => `${f} = @${f}`);
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  db.prepare(`UPDATE applicants SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`)
    .run({ ...req.body, id: req.params.id });
  res.json({ ok: true });
});

app.post('/api/admin/applicants/:id/notes', requireAuth, (req, res) => {
  const row = db.prepare('SELECT internal_notes FROM applicants WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const notes = JSON.parse(row.internal_notes || '[]');
  const admin = db.prepare('SELECT name FROM admins WHERE id = ?').get(req.session.adminId);
  notes.unshift({ author: admin.name, note: req.body.note, created_at: new Date().toISOString() });
  db.prepare(`UPDATE applicants SET internal_notes = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(notes), req.params.id);
  res.json({ ok: true, notes });
});

// Stage change
app.post('/api/admin/applicants/:id/stage', requireAuth, (req, res) => {
  const { new_stage, rejection_reason, notes } = req.body;
  const applicant = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  const admin = db.prepare('SELECT name FROM admins WHERE id = ?').get(req.session.adminId);

  db.prepare(`UPDATE applicants SET recruitment_stage = ?, rejection_reason = COALESCE(?, rejection_reason), updated_at = datetime('now') WHERE id = ?`)
    .run(new_stage, rejection_reason || null, req.params.id);

  db.prepare(`INSERT INTO stage_history (applicant_id, previous_stage, new_stage, changed_by, notes) VALUES (?,?,?,?,?)`)
    .run(req.params.id, applicant.recruitment_stage, new_stage, admin.name, notes || null);

  const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);

  if (new_stage === 'recruited') sendNotification(updated, 'recruited');
  if (new_stage === 'rejected') sendNotification(updated, 'rejected');

  res.json({ ok: true });
});

// Interview scheduling
app.post('/api/admin/applicants/:id/interview', requireAuth, (req, res) => {
  const { interview_date, interview_time, interview_timezone, interview_type,
    interview_link, interview_address, interview_instructions } = req.body;

  const applicant = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });

  const admin = db.prepare('SELECT name FROM admins WHERE id = ?').get(req.session.adminId);
  const prevStage = applicant.recruitment_stage;

  db.prepare(`UPDATE applicants SET
    recruitment_stage = 'interview', interview_status = 'scheduled',
    interview_date = ?, interview_time = ?, interview_timezone = ?, interview_type = ?,
    interview_link = ?, interview_address = ?, interview_instructions = ?,
    updated_at = datetime('now')
    WHERE id = ?`)
    .run(interview_date, interview_time, interview_timezone, interview_type,
      interview_link || null, interview_address || null, interview_instructions || null, req.params.id);

  if (prevStage !== 'interview') {
    db.prepare(`INSERT INTO stage_history (applicant_id, previous_stage, new_stage, changed_by, notes) VALUES (?,?,?,?,?)`)
      .run(req.params.id, prevStage, 'interview', admin.name, 'Interview scheduled');
  }

  const updated = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  sendNotification(updated, 'interview_scheduled');

  res.json({ ok: true });
});

// Interview attendance
app.post('/api/admin/applicants/:id/attendance', requireAuth, (req, res) => {
  const { status } = req.body; // attended | did_not_attend
  db.prepare(`UPDATE applicants SET interview_status = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, req.params.id);
  res.json({ ok: true });
});

// Send interview reminder manually
app.post('/api/admin/applicants/:id/remind', requireAuth, (req, res) => {
  const applicant = db.prepare('SELECT * FROM applicants WHERE id = ?').get(req.params.id);
  if (!applicant) return res.status(404).json({ error: 'Not found' });
  sendNotification(applicant, 'interview_reminder');
  res.json({ ok: true });
});

// ============================================================
// ADMIN: JOB SETTINGS
// ============================================================

app.get('/api/admin/job-settings', requireAuth, (req, res) => {
  const job = db.prepare('SELECT * FROM job_settings WHERE id = 1').get();
  res.json(job);
});

app.put('/api/admin/job-settings', requireAuth, (req, res) => {
  const b = req.body;
  db.prepare(`UPDATE job_settings SET
    job_title=@job_title, job_summary=@job_summary,
    responsibilities=@responsibilities, requirements=@requirements,
    min_salary=@min_salary, max_salary=@max_salary, currency=@currency,
    commission_description=@commission_description, employment_type=@employment_type,
    work_arrangement=@work_arrangement, working_days=@working_days, working_hours=@working_hours,
    probation_period=@probation_period, performance_expectations=@performance_expectations,
    payment_schedule=@payment_schedule, application_open=@application_open,
    application_deadline=@application_deadline, updated_at=datetime('now')
    WHERE id = 1`).run({
      ...b,
      responsibilities: JSON.stringify(b.responsibilities || []),
      requirements: JSON.stringify(b.requirements || []),
      application_open: b.application_open ? 1 : 0
    });
  res.json({ ok: true });
});

// ============================================================
// ADMIN: NOTIFICATION TEMPLATES
// ============================================================

app.get('/api/admin/templates', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notification_templates').all());
});

app.put('/api/admin/templates/:key', requireAuth, (req, res) => {
  const { subject, body } = req.body;
  db.prepare(`UPDATE notification_templates SET subject = ?, body = ?, updated_at = datetime('now') WHERE key = ?`)
    .run(subject || null, body, req.params.key);
  res.json({ ok: true });
});

// ============================================================
// ADMIN: NOTIFICATION LOG
// ============================================================

app.get('/api/admin/notifications', requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT n.*, a.first_name, a.last_name, a.application_id
    FROM notification_log n JOIN applicants a ON a.id = n.applicant_id
    ORDER BY n.sent_at DESC LIMIT 200`).all();
  res.json(rows);
});

// ---------- Fallbacks ----------
app.get('/admin', (req, res) => res.redirect('/admin/'));

app.listen(PORT, () => {
  console.log(`\n  Telesales Recruitment Portal running:`);
  console.log(`  ➜ Careers page:  http://localhost:${PORT}/`);
  console.log(`  ➜ Admin login:   http://localhost:${PORT}/admin/`);
  console.log(`  ➜ Default admin: admin@company.com / Telesales2026!\n`);
});
