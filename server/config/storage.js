const fs = require('node:fs');
const path = require('node:path');

const storageDir = path.resolve(process.env.STORAGE_DIR || path.join(__dirname, '..'));
const uploadsDir = path.join(storageDir, 'uploads');
const ebookDir = path.join(storageDir, '.private-books');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(ebookDir, { recursive: true });

module.exports = { uploadsDir, ebookDir };
