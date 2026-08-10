const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Recruiter',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS job_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  job_title TEXT,
  job_summary TEXT,
  responsibilities TEXT,      -- JSON array
  requirements TEXT,          -- JSON array
  min_salary INTEGER,
  max_salary INTEGER,
  currency TEXT DEFAULT '₦',
  commission_description TEXT,
  employment_type TEXT,
  work_arrangement TEXT,
  working_days TEXT,
  working_hours TEXT,
  probation_period TEXT,
  performance_expectations TEXT,
  payment_schedule TEXT,
  application_open INTEGER DEFAULT 1,
  application_deadline TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,       -- application_received | interview_scheduled | interview_reminder | recruited | rejected
  label TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS applicants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT UNIQUE,
  first_name TEXT,
  last_name TEXT,
  email TEXT,
  phone TEXT,
  whatsapp_number TEXT,
  gender TEXT,
  date_of_birth TEXT,

  country TEXT,
  state TEXT,
  city TEXT,

  education_level TEXT,
  employment_status TEXT,
  sales_experience TEXT,
  telesales_experience TEXT,
  experience_duration TEXT,
  previous_company TEXT,
  previous_role TEXT,

  reason_for_applying TEXT,
  comfortable_with_calls TEXT,
  has_smartphone TEXT,
  has_internet TEXT,
  start_availability TEXT,
  preferred_work_arrangement TEXT,

  cv_url TEXT,
  cv_filename TEXT,

  application_status TEXT DEFAULT 'started',      -- started | completed
  recruitment_stage TEXT DEFAULT 'application_received', -- application_received | under_review | interview | recruited | rejected | withdrawn

  interview_status TEXT DEFAULT 'not_scheduled',  -- not_scheduled | scheduled | attended | did_not_attend
  interview_date TEXT,
  interview_time TEXT,
  interview_timezone TEXT,
  interview_type TEXT,
  interview_link TEXT,
  interview_address TEXT,
  interview_instructions TEXT,

  rejection_reason TEXT,
  internal_notes TEXT,        -- JSON array of {author, note, created_at}
  assigned_recruiter TEXT,

  created_at TEXT DEFAULT (datetime('now')),
  submitted_at TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stage_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  previous_stage TEXT,
  new_stage TEXT,
  changed_by TEXT,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notification_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  applicant_id INTEGER REFERENCES applicants(id) ON DELETE CASCADE,
  notification_type TEXT,
  channel TEXT,             -- email | whatsapp
  recipient TEXT,
  status TEXT DEFAULT 'sent', -- pending | sent | failed
  provider_message_id TEXT,
  sent_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// --- Seed admin user ---
const adminCount = db.prepare('SELECT COUNT(*) c FROM admins').get().c;
if (adminCount === 0) {
  const hash = bcrypt.hashSync('Telesales2026!', 10);
  db.prepare(`INSERT INTO admins (name, email, password_hash, role) VALUES (?,?,?,?)`)
    .run('Recruitment Admin', 'admin@company.com', hash, 'Admin');
}

// --- Seed job settings ---
const jobCount = db.prepare('SELECT COUNT(*) c FROM job_settings').get().c;
if (jobCount === 0) {
  db.prepare(`INSERT INTO job_settings (
    id, job_title, job_summary, responsibilities, requirements,
    min_salary, max_salary, currency, commission_description,
    employment_type, work_arrangement, working_days, working_hours,
    probation_period, performance_expectations, payment_schedule,
    application_open, application_deadline
  ) VALUES (1, ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'Telesales Representative',
    'You will contact potential customers, introduce our products and services, explain their benefits, follow up with prospects, and convert qualified leads into paying customers.',
    JSON.stringify([
      'Make outbound calls to prospective customers',
      'Introduce and explain the company\u2019s products or services',
      'Understand customer needs and recommend appropriate solutions',
      'Follow up with interested prospects',
      'Convert qualified prospects into paying customers',
      'Maintain accurate records of calls and customer conversations',
      'Update sales activities and customer information',
      'Meet daily, weekly, and monthly sales targets',
      'Attend required sales training and team meetings',
      'Maintain professional communication with prospects and customers'
    ]),
    JSON.stringify([
      'Good spoken English',
      'Strong communication skills',
      'Comfortable speaking with customers on the phone',
      'Ability to follow up consistently',
      'Basic smartphone and internet literacy',
      'Ability to work toward sales targets',
      'Previous telesales or customer service experience is an advantage but not mandatory'
    ]),
    120000, 180000, '₦',
    'Earn a commission on every successful sale, plus performance bonuses when you exceed monthly targets. Commission is calculated weekly and paid out monthly alongside your base salary.',
    'Full-time', 'Hybrid', 'Monday \u2013 Friday', '9:00 AM \u2013 5:00 PM',
    '3 months', 'Daily call targets, weekly conversions, monthly revenue quota',
    'Monthly, on the last working day',
    1, null
  );
}

// --- Seed notification templates ---
const tplCount = db.prepare('SELECT COUNT(*) c FROM notification_templates').get().c;
if (tplCount === 0) {
  const templates = [
    ['application_received', 'Application Received', 'We Received Your Application',
      'Hi {{first_name}}, thanks for applying for the {{job_title}} role. Your application ID is {{application_id}}. Our recruitment team will review it and update you here and on WhatsApp.'],
    ['interview_scheduled', 'Interview Scheduled', 'You\u2019re Invited to Interview',
      'Congratulations, {{first_name}}! You\u2019ve been selected for the interview stage for the {{job_title}} position. Your interview is scheduled for {{interview_date}} at {{interview_time}}. Method: {{interview_type}}. {{interview_link}} Please be available at the scheduled time.'],
    ['interview_reminder', 'Interview Reminder', 'Reminder: Your Interview Is Tomorrow',
      'Hi {{first_name}}, this is a reminder that your interview for the {{job_title}} role is scheduled for {{interview_date}} at {{interview_time}}. {{interview_link}}'],
    ['recruited', 'Recruited', 'Welcome to the Team!',
      'Congratulations, {{first_name}}! You\u2019ve successfully completed the recruitment process for {{job_title}}. Our team will be in touch shortly with your next steps.'],
    ['rejected', 'Rejected', 'Update on Your Application',
      'Hi {{first_name}}, thank you for your interest in the {{job_title}} role. After reviewing your application, we will not be progressing it further at this time. We appreciate the time you invested in the process.']
  ];
  const stmt = db.prepare('INSERT INTO notification_templates (key, label, subject, body) VALUES (?,?,?,?)');
  templates.forEach(t => stmt.run(...t));
}

module.exports = db;
