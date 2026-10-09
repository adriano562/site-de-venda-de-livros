const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `banner_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

// GET /api/banners - Público (ativos) ou Admin (todos)
router.get('/', async (req, res) => {
  try {
    const isAdmin = auth.isAdminToken(req);
    let result;
    if (isAdmin) {
      result = await pool.query('SELECT * FROM banners ORDER BY position ASC');
    } else {
      result = await pool.query('SELECT * FROM banners WHERE is_active = true ORDER BY position ASC');
    }
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/banners - Admin
router.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, subtitle, cta_text, cta_link, is_active, position } = req.body;
    const image_url = req.file ? `/uploads/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO banners (title, subtitle, image_url, cta_text, cta_link, is_active, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [title, subtitle || '', image_url, cta_text || '', cta_link || '', is_active !== 'false', parseInt(position) || 0]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar banner:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/banners/:id - Admin
router.put('/:id', auth, upload.single('image'), async (req, res) => {
  try {
    const { title, subtitle, cta_text, cta_link, is_active, position } = req.body;
    const existing = await pool.query('SELECT * FROM banners WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Banner não encontrado.' });
    }

    const image_url = req.file ? `/uploads/${req.file.filename}` : existing.rows[0].image_url;

    const result = await pool.query(
      `UPDATE banners SET title=$1, subtitle=$2, image_url=$3, cta_text=$4, cta_link=$5, is_active=$6, position=$7
       WHERE id=$8 RETURNING *`,
      [
        title || existing.rows[0].title,
        subtitle !== undefined ? subtitle : existing.rows[0].subtitle,
        image_url,
        cta_text || existing.rows[0].cta_text,
        cta_link || existing.rows[0].cta_link,
        is_active !== undefined ? is_active === 'true' : existing.rows[0].is_active,
        position !== undefined ? parseInt(position) : existing.rows[0].position,
        req.params.id
      ]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/banners/:id - Admin
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM banners WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Banner não encontrado.' });
    }
    res.json({ message: 'Banner removido.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
