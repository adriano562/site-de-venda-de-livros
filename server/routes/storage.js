const crypto = require('node:crypto');
const express = require('express');
const path = require('node:path');
const auth = require('../middleware/auth');
const { createSignedUpload, getPublicObjectUrl } = require('../config/storage');

const router = express.Router();
const imageTypes = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
]);

router.post('/sign', auth, async (req, res) => {
  const { kind, filename, content_type: contentType, size } = req.body;
  const extension = path.extname(String(filename || '')).toLowerCase();
  const isImage = kind === 'cover' || kind === 'banner';
  const bucket = isImage ? 'uploads' : kind === 'ebook' ? 'ebooks' : null;
  const expectedType = isImage ? imageTypes.get(extension) : kind === 'ebook' ? 'application/pdf' : null;
  const maxSize = kind === 'cover' ? 5 : kind === 'banner' ? 10 : kind === 'ebook' ? 18 : 0;

  if (!bucket || !expectedType || contentType !== expectedType) {
    return res.status(400).json({ error: 'Tipo de arquivo inválido.' });
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > maxSize * 1024 * 1024) {
    return res.status(413).json({ error: `O arquivo excede o limite de ${maxSize} MB.` });
  }

  const prefix = kind === 'banner' ? 'banners' : 'books';
  const objectPath = `${prefix}/${crypto.randomUUID()}${kind === 'ebook' ? '.pdf' : extension}`;
  try {
    const { uploadUrl, publicKey } = await createSignedUpload(bucket, objectPath);
    res.json({
      upload_url: uploadUrl,
      api_key: publicKey,
      object_path: kind === 'ebook' ? `ebooks/${objectPath}` : objectPath,
      public_url: isImage ? getPublicObjectUrl(bucket, objectPath) : null
    });
  } catch (error) {
    console.error('Erro ao preparar upload para Supabase Storage:', error);
    res.status(502).json({ error: 'Não foi possível preparar o upload do arquivo.' });
  }
});

module.exports = router;
