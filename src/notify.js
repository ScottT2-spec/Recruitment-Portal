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
async function sendNotification(applicant, templateKey, extraVars = {}) {
  const tpl = await db.get('SELECT * FROM notification_templates WHERE key = $1', [templateKey]);
  if (!tpl) return;

  const job = await db.get('SELECT job_title, whatsapp_enabled FROM job_settings WHERE id = 1');
  const whatsappEnabled = job ? !!job.whatsapp_enabled : true;
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

  const logSend = (channel, recipient) => db.query(
    `INSERT INTO notification_log
      (applicant_id, notification_type, channel, recipient, status, provider_message_id, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6, NOW())`,
    [applicant.id, templateKey, channel, recipient, 'sent', 'sim-' + Math.random().toString(36).slice(2, 10)]
  );

  if (applicant.email) await logSend('email', applicant.email);
  if (applicant.whatsapp_number && whatsappEnabled) await logSend('whatsapp', applicant.whatsapp_number);

  return { subject, message };
}

module.exports = { sendNotification, fillTemplate };
