const express = require('express');
const cors = require('cors');

const { getPublicObjectUrl } = require('./config/storage');
const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const subscribersRoutes = require('./routes/subscribers');
const bannersRoutes = require('./routes/banners');
const ordersRoutes = require('./routes/orders');
const statsRoutes = require('./routes/stats');
const storageRoutes = require('./routes/storage');

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/uploads/:filename', (req, res) => {
  try {
    res.redirect(302, getPublicObjectUrl('uploads', req.params.filename));
  } catch (err) {
    console.error('Erro ao gerar URL da imagem:', err);
    res.status(500).json({ error: 'Armazenamento de arquivos não configurado.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/subscribers', subscribersRoutes);
app.use('/api', subscribersRoutes);
app.use('/api/banners', bannersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/stats', statsRoutes);

module.exports = app;
