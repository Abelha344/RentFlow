const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');

const MAX_MB = Number(process.env.UPLOAD_MAX_MB) || 10;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function createUploader(subdir) {
  const dest = path.join(__dirname, '../../uploads', subdir);
  ensureDir(dest);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, dest),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${uuidv4()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_MB * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp|avif|pdf|heic/;
      const ext = path.extname(file.originalname).toLowerCase().slice(1);
      const mimeSub = (file.mimetype.split('/')[1] || '').toLowerCase();
      const ok = allowed.test(ext) || allowed.test(mimeSub);
      if (ok) cb(null, true);
      else cb(new Error('Only image (JPG, PNG, WebP, AVIF, GIF, HEIC) and PDF uploads are allowed'));
    },
  });
}

const uploadKyc = createUploader('kyc');
const uploadReceipts = createUploader('receipts');

module.exports = { uploadKyc, uploadReceipts };
