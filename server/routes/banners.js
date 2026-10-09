const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { getPublicObjectUrl } = require('../config/storage');
const bannerPathPattern = /^banners\/[a-f\d-]{36}\.(?:jpe?g|png|webp)$/i;

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
router.post('/', auth, async (req, res) => {
  try {
    const { title, subtitle, cta_text, cta_link, is_active, position, image_path } = req.body;
    if (image_path && !bannerPathPattern.test(image_path)) {
      return res.status(400).json({ error: 'Caminho da imagem inválido.' });
    }
    const image_url = image_path ? getPublicObjectUrl('uploads', image_path) : null;

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
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, subtitle, cta_text, cta_link, is_active, position, image_path } = req.body;
    if (image_path && !bannerPathPattern.test(image_path)) {
      return res.status(400).json({ error: 'Caminho da imagem inválido.' });
    }
    const existing = await pool.query('SELECT * FROM banners WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Banner não encontrado.' });
    }

    const image_url = image_path ? getPublicObjectUrl('uploads', image_path) : existing.rows[0].image_url;

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
    console.error('Erro ao editar banner:', err);
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
