const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_CV_BUCKET || 'cvs';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variable.');
}

// Use placeholders if unset so the module can load; real calls below will fail
// with a clear error instead of crashing the whole process at import time.
const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  { auth: { persistSession: false } }
);

let bucketReadyPromise = null;

async function ensureBucket() {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw error;
  const exists = (buckets || []).some(b => b.name === BUCKET);
  if (!exists) {
    // CVs contain applicant PII — bucket must stay private. Access is via
    // short-lived signed URLs (see getCvSignedUrl), never a public URL.
    const { error: createError } = await supabase.storage.createBucket(BUCKET, { public: false });
    // Ignore "already exists" race between concurrent cold starts.
    if (createError && !/already exists/i.test(createError.message || '')) throw createError;
  }
}

function bucketReady() {
  if (!bucketReadyPromise) bucketReadyPromise = ensureBucket();
  return bucketReadyPromise;
}

/**
 * Uploads a CV file buffer (from multer memoryStorage) to Supabase Storage
 * and returns the storage key (NOT a public URL — the bucket is private).
 * Store this key in cv_url; resolve it to a signed URL on demand via
 * getCvSignedUrl, only from an authenticated admin route.
 */
async function uploadCv(file) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured');
  }
  await bucketReady();

  const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0];
  const key = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + ext;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, file.buffer, {
      contentType: file.mimetype,
      upsert: false
    });
  if (error) throw error;

  return key;
}

/**
 * Produces a time-limited signed URL for an admin to view/download a CV.
 * expiresIn is in seconds (default 5 minutes) — generate fresh on each request,
 * never persist or cache the signed URL itself.
 */
async function getCvSignedUrl(key, expiresIn = 300) {
  if (!key) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(key, expiresIn);
  if (error) throw error;
  return data.signedUrl;
}

module.exports = { uploadCv, getCvSignedUrl };
