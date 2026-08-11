const db = require('./db');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

// --- Provider config (set these in production; falls back to simulation if absent) ---
// Email: AWS SES — same provider/library/env-var naming as the AfroStore codebase
// (src/lib/email.ts), for consistency across Prokip apps.
const AWS_SES_REGION = process.env.AWS_SES_REGION || 'us-east-1';
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;
const SES_FROM_EMAIL = process.env.SES_FROM_EMAIL;
const SES_FROM_NAME = process.env.SES_FROM_NAME || 'Careers';

const ses = new SESClient({
  region: AWS_SES_REGION,
  credentials: AWS_ACCESS_KEY_ID
    ? { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY || '' }
    : undefined,
});

// WhatsApp: Meta WhatsApp Business Cloud API — same integration as AfroStore
// (src/lib/whatsapp.ts). Env var name matched to that implementation
// (WHATSAPP_ACCESS_TOKEN, not WHATSAPP_CLOUD_API_TOKEN).
const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;

function fillTemplate(body, vars) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => (vars[key] ?? ''));
}

// --- Real send functions. Each returns { status, provider_message_id, error? }. ---

async function sendEmailReal(to, subject, body) {
  const command = new SendEmailCommand({
    Source: `${SES_FROM_NAME} <${SES_FROM_EMAIL}>`,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject || 'Update on your application', Charset: 'UTF-8' },
      Body: { Text: { Data: body, Charset: 'UTF-8' } },
    },
  });
  const result = await ses.send(command);
  return result.MessageId;
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
      text: { body, preview_url: true }
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || `WhatsApp Cloud API error (${res.status})`);
  return data.messages?.[0]?.id;
}

const emailConfigured = !!(AWS_ACCESS_KEY_ID && AWS_SECRET_ACCESS_KEY && SES_FROM_EMAIL);
const whatsappConfigured = !!(WHATSAPP_TOKEN && WHATSAPP_PHONE_NUMBER_ID);

if (!emailConfigured) {
  console.warn('[notify] AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / SES_FROM_EMAIL not set — emails will be logged as "simulated", not actually sent.');
}
if (!whatsappConfigured) {
  console.warn('[notify] WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID not set — WhatsApp messages will be logged as "simulated", not actually sent.');
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
