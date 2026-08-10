const db = require('./db');

function fillTemplate(body, vars) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] ?? ''));
}

/**
 * Sends (simulated) email + WhatsApp notifications for a given template key,
 * and writes an entry to notification_log either way.
 *
 * In production, swap the two `logSend` calls' status/provider_message_id
 * assignment with real calls to Resend/SendGrid/SES and the WhatsApp Cloud API.
 */
function sendNotification(applicant, templateKey, extraVars = {}) {
  const tpl = db.prepare('SELECT * FROM notification_templates WHERE key = ?').get(templateKey);
  if (!tpl) return;

  const job = db.prepare('SELECT job_title FROM job_settings WHERE id = 1').get();
  const vars = {
    first_name: applicant.first_name,
    last_name: applicant.last_name,
    application_id: applicant.application_id,
    job_title: job ? job.job_title : 'Telesales Representative',
    interview_date: applicant.interview_date || '',
    interview_time: applicant.interview_time || '',
    interview_type: applicant.interview_type || '',
    interview_link: applicant.interview_link || applicant.interview_address || '',
    ...extraVars
  };

  const message = fillTemplate(tpl.body, vars);
  const subject = tpl.subject ? fillTemplate(tpl.subject, vars) : null;

  const logStmt = db.prepare(`INSERT INTO notification_log
    (applicant_id, notification_type, channel, recipient, status, provider_message_id, sent_at)
    VALUES (?,?,?,?,?,?, datetime('now'))`);

  if (applicant.email) {
    logStmt.run(applicant.id, templateKey, 'email', applicant.email, 'sent', 'sim-' + Math.random().toString(36).slice(2, 10));
  }
  if (applicant.whatsapp_number) {
    logStmt.run(applicant.id, templateKey, 'whatsapp', applicant.whatsapp_number, 'sent', 'sim-' + Math.random().toString(36).slice(2, 10));
  }

  return { subject, message };
}

module.exports = { sendNotification, fillTemplate };
