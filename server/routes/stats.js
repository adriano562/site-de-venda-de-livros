const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');

// POST /api/stats/track - Público - registrar visita
router.post('/track', async (req, res) => {
  try {
    const { page } = req.body;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    await pool.query(
      'INSERT INTO page_views (page, ip_address, user_agent) VALUES ($1, $2, $3)',
      [page || '/', ip, userAgent]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/stats/overview - Admin - resumo geral
router.get('/overview', auth, async (req, res) => {
  try {
    const [books, subscribers, orders, viewsToday, revenue, confirmedRevenue, pendingRevenue] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM books'),
      pool.query('SELECT COUNT(*) FROM subscribers WHERE is_active = true'),
      pool.query('SELECT COUNT(*) FROM orders'),
      pool.query("SELECT COUNT(*) FROM page_views WHERE visited_at >= CURRENT_DATE"),
      pool.query("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status != 'cancelado'"),
      pool.query("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status IN ('pago', 'enviado', 'entregue')"),
      pool.query("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = 'pendente'"),
    ]);

    res.json({
      total_books: parseInt(books.rows[0].count),
      total_subscribers: parseInt(subscribers.rows[0].count),
      total_orders: parseInt(orders.rows[0].count),
      views_today: parseInt(viewsToday.rows[0].count),
      total_revenue: parseFloat(revenue.rows[0].total),
      confirmed_revenue: parseFloat(confirmedRevenue.rows[0].total),
      pending_revenue: parseFloat(pendingRevenue.rows[0].total),
    });
  } catch (err) {
    console.error('Erro stats:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/stats/views - Admin - visitas por dia (últimos 30 dias)
router.get('/views', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DATE(visited_at) as date, COUNT(*) as views
      FROM page_views
      WHERE visited_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(visited_at)
      ORDER BY date ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/stats/top-pages - Admin - páginas mais visitadas
router.get('/top-pages', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT page, COUNT(*) as views
      FROM page_views
      GROUP BY page
      ORDER BY views DESC
      LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
