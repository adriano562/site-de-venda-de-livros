const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// POST /api/subscribe - Público - assinar newsletter
router.post('/subscribe', async (req, res) => {
  try {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ error: 'Email é obrigatório.' });
    }
    if (email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Informe um e-mail válido.' });
    }

    const existing = await pool.query('SELECT * FROM subscribers WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      if (!existing.rows[0].is_active) {
        await pool.query('UPDATE subscribers SET is_active = true WHERE email = $1', [email]);
        return res.json({ message: 'Inscrição reativada! Você receberá nossas novidades.' });
      }
      return res.json({ message: 'Este e-mail já está inscrito para receber novidades.' });
    }

    await pool.query('INSERT INTO subscribers (email) VALUES ($1)', [email]);
    res.status(201).json({ message: 'Inscrição confirmada! Você receberá nossas novidades.' });
  } catch (err) {
    console.error('Erro ao assinar:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/subscribers - Admin - listar assinantes
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subscribers ORDER BY subscribed_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/subscribers/:id - Admin - remover assinante
router.delete('/:id', auth, async (req, res) => {
  try {
    const result = await pool.query('DELETE FROM subscribers WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Assinante não encontrado.' });
    }
    res.json({ message: 'Assinante removido.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
