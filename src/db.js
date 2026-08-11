const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL environment variable (Supabase Postgres connection string).');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false }
});

// query(text, params) -> rows array
async function query(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

// get(text, params) -> first row or undefined
async function get(text, params = []) {
  const rows = await query(text, params);
  return rows[0];
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS admins (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'Recruiter',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
  whatsapp_enabled INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_templates (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  label TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS applicants (
  id SERIAL PRIMARY KEY,
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

  application_status TEXT DEFAULT 'started',
  recruitment_stage TEXT DEFAULT 'application_received',

  interview_status TEXT DEFAULT 'not_scheduled',
  interview_date TEXT,
  interview_time TEXT,
  interview_timezone TEXT,
  interview_type TEXT,
  interview_link TEXT,
  interview_address TEXT,
  interview_instructions TEXT,

  rejection_reason TEXT,
  internal_notes TEXT,
  assigned_recruiter TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stage_history (
  id SERIAL PRIMARY KEY,
  applicant_id INTEGER NOT NULL REFERENCES applicants(id) ON DELETE CASCADE,
  previous_stage TEXT,
  new_stage TEXT,
  changed_by TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notification_log (
  id SERIAL PRIMARY KEY,
  applicant_id INTEGER REFERENCES applicants(id) ON DELETE CASCADE,
  notification_type TEXT,
  channel TEXT,
  recipient TEXT,
  status TEXT DEFAULT 'sent',
  provider_message_id TEXT,
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
`;

let readyPromise = null;

async function initDb() {
  await pool.query(SCHEMA_SQL);

  // Migration for tables created before whatsapp_enabled existed (CREATE TABLE IF
  // NOT EXISTS above won't add columns to an already-existing table).
  await pool.query(`ALTER TABLE job_settings ADD COLUMN IF NOT EXISTS whatsapp_enabled INTEGER DEFAULT 1`);

  const { rows: [{ c: adminCount }] } = await pool.query('SELECT COUNT(*)::int c FROM admins');
  if (adminCount === 0) {
    const hash = bcrypt.hashSync('Telesales2026!', 10);
    await pool.query(
      `INSERT INTO admins (name, email, password_hash, role) VALUES ($1,$2,$3,$4)`,
      ['Recruitment Admin', 'admin@company.com', hash, 'Admin']
    );
  }

  const { rows: [{ c: jobCount }] } = await pool.query('SELECT COUNT(*)::int c FROM job_settings');
  if (jobCount === 0) {
    await pool.query(
      `INSERT INTO job_settings (
        id, job_title, job_summary, responsibilities, requirements,
        min_salary, max_salary, currency, commission_description,
        employment_type, work_arrangement, working_days, working_hours,
        probation_period, performance_expectations, payment_schedule,
        application_open, application_deadline, whatsapp_enabled
      ) VALUES (1, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
      [
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
        1, null, 1
      ]
    );
  }

  const { rows: [{ c: tplCount }] } = await pool.query('SELECT COUNT(*)::int c FROM notification_templates');
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
    for (const t of templates) {
      await pool.query(
        'INSERT INTO notification_templates (key, label, subject, body) VALUES ($1,$2,$3,$4)',
        t
      );
    }
  }
}

// Memoized so schema/seed logic only runs once per warm serverless instance.
function ready() {
  if (!readyPromise) readyPromise = initDb();
  return readyPromise;
}

module.exports = { pool, query, get, ready };
