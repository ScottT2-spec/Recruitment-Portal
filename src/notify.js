const db = require('./db');

// --- Provider config (set these in production; falls back to simulation if absent) ---
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM_EMAIL; // e.g. 'Careers <careers@yourcompany.com>'

const WHATSAPP_TOKEN = process.env.WHATSAPP_CLOUD_API_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

function fillTemplate(body, vars) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] ?? ''));
}

// --- Real send functions. Each returns { status, provider_message_id, error? }. ---

async function sendEmailReal(to, subject, body) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to,
      subject: subject || 'Update on your application',
      text: body
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Resend API error (${res.status})`);
  return data.id;
}

async function sendWhatsappReal(to, body) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/[^\d+]/g, ''),
      type: 'text',
      text: { body }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `WhatsApp Cloud API error (${res.status})`);
  return data.messages?.[0]?.id;
}

const emailConfigured = !!(RESEND_API_KEY && RESEND_FROM);
const whatsappConfigured = !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);

if (!emailConfigured) {
  console.warn('[notify] RESEND_API_KEY / RESEND_FROM_EMAIL not set — emails will be logged as "simulated", not actually sent.');
}
if (!whatsappConfigured) {
  console.warn('[notify] WHATSAPP_CLOUD_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp messages will be logged as "simulated", not actually sent.');
}

/**
 * Sends email + WhatsApp notifications for a given template key, and writes
 * a row to notification_log per channel attempted. If a channel's provider
 * isn't configured, that channel is logged with status 'simulated' (never
 * 'sent') so the notification log honestly reflects what actually happened.
 * If a real send fails, it's logged as 'failed' with the error message.
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

  const logSend = (channel, recipient, status, providerMessageId, errorNote) => db.query(
    `INSERT INTO notification_log
      (applicant_id, notification_type, channel, recipient, status, provider_message_id, sent_at)
      VALUES ($1,$2,$3,$4,$5,$6, NOW())`,
    [applicant.id, templateKey, channel, recipient, status, providerMessageId || errorNote || null]
  );

  if (applicant.email) {
    if (emailConfigured) {
      try {
        const id = await sendEmailReal(applicant.email, subject, message);
        await logSend('email', applicant.email, 'sent', id);
      } catch (err) {
        console.error('[notify] email send failed:', err.message);
        await logSend('email', applicant.email, 'failed', null, err.message);
      }
    } else {
      await logSend('email', applicant.email, 'simulated', 'sim-' + Math.random().toString(36).slice(2, 10));
    }
  }

  if (applicant.whatsapp_number && whatsappEnabled) {
    if (whatsappConfigured) {
      try {
        const id = await sendWhatsappReal(applicant.whatsapp_number, message);
        await logSend('whatsapp', applicant.whatsapp_number, 'sent', id);
      } catch (err) {
        console.error('[notify] whatsapp send failed:', err.message);
        await logSend('whatsapp', applicant.whatsapp_number, 'failed', null, err.message);
      }
    } else {
      await logSend('whatsapp', applicant.whatsapp_number, 'simulated', 'sim-' + Math.random().toString(36).slice(2, 10));
    }
  }

  return { subject, message };
}

module.exports = { sendNotification, fillTemplate };
