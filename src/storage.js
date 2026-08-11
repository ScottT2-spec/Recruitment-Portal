const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// STORAGE_DRIVER=local (default) stores CVs on disk — zero external services,
// works on any normal server/VPS/container with persistent disk.
// STORAGE_DRIVER=s3 uses any S3-compatible object store (AWS S3, Cloudflare R2,
// Backblaze B2, MinIO, Supabase Storage's S3 endpoint, etc.) — for hosts with
// no persistent disk (e.g. serverless).
const DRIVER = process.env.STORAGE_DRIVER || 'local';

const SIGNING_SECRET = process.env.CV_SIGNING_SECRET || process.env.SESSION_SECRET || 'dev-secret-change-me';

function sign(key, expiresAt) {
  return crypto.createHmac('sha256', SIGNING_SECRET).update(`${key}:${expiresAt}`).digest('hex');
}

function makeKey(file) {
  const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0];
  return Date.now() + '-' + crypto.randomBytes(6).toString('hex') + ext;
}

// ---------------- Local disk driver ----------------
// Files live outside public/ (not statically served) so they're only
// reachable through the signed URL below, keeping applicant CVs private.
const LOCAL_DIR = path.resolve(__dirname, '..', process.env.UPLOAD_DIR || 'data/cv-uploads');

const localDriver = {
  async upload(file) {
    fs.mkdirSync(LOCAL_DIR, { recursive: true });
    const key = makeKey(file);
    fs.writeFileSync(path.join(LOCAL_DIR, key), file.buffer);
    return key;
  },
  async signedUrl(key, expiresIn) {
    const expiresAt = Date.now() + expiresIn * 1000;
    const sig = sign(key, expiresAt);
    return `/api/cv-file/${encodeURIComponent(key)}?exp=${expiresAt}&sig=${sig}`;
  },
  // Used by the /api/cv-file route in server.js to validate + stream the file.
  verifyAndResolve(key, exp, sig) {
    if (!key || !exp || !sig) return null;
    if (Date.now() > Number(exp)) return null;
    const expected = sign(key, exp);
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const filePath = path.join(LOCAL_DIR, key);
    if (!filePath.startsWith(LOCAL_DIR) || !fs.existsSync(filePath)) return null;
    return filePath;
  }
};

// ---------------- S3-compatible driver ----------------
// Works with AWS S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces, MinIO,
// or Supabase Storage's S3-compatible endpoint — same driver, any provider.
let s3Driver = null;
function getS3Driver() {
  if (s3Driver) return s3Driver;

  const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

  const BUCKET = process.env.S3_BUCKET;
  const REGION = process.env.S3_REGION || 'auto';
  const ENDPOINT = process.env.S3_ENDPOINT; // omit for real AWS S3
  const FORCE_PATH_STYLE = process.env.S3_FORCE_PATH_STYLE === 'true';

  if (!BUCKET || !process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY) {
    console.error('S3 storage driver selected but S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY are not fully configured.');
  }

  const client = new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY
    }
  });

  s3Driver = {
    async upload(file) {
      const key = makeKey(file);
      await client.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype
      }));
      return key;
    },
    async signedUrl(key, expiresIn) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn });
    }
  };
  return s3Driver;
}

function driver() {
  return DRIVER === 's3' ? getS3Driver() : localDriver;
}

/** Uploads a CV file buffer (from multer memoryStorage) and returns a storage key. */
async function uploadCv(file) {
  return driver().upload(file);
}

/** Produces a short-lived URL for an admin to view/download a CV. Generate fresh per request. */
async function getCvSignedUrl(key, expiresIn = 300) {
  if (!key) return null;
  return driver().signedUrl(key, expiresIn);
}

module.exports = { uploadCv, getCvSignedUrl, DRIVER, _localVerify: localDriver.verifyAndResolve };
