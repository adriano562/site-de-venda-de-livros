const express = require('express');
const cors = require('cors');
require('dotenv').config();

const setupDatabase = require('./models/setup');
const { getPublicObjectUrl } = require('./config/storage');
const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const subscribersRoutes = require('./routes/subscribers');
const bannersRoutes = require('./routes/banners');
const ordersRoutes = require('./routes/orders');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/subscribers', subscribersRoutes);
app.use('/api', subscribersRoutes); // para /api/subscribe público
app.use('/api/banners', bannersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/stats', statsRoutes);

// Iniciar
async function start() {
  try {
    await setupDatabase();
    app.listen(PORT, () => {
      console.log(`\n🌙 Nocturnal Chronicles rodando em http://localhost:${PORT}`);
      console.log(`📋 Painel Admin em http://localhost:${PORT}/admin`);
      console.log(`🔗 API em http://localhost:${PORT}/api\n`);
    });
  } catch (err) {
    console.error('❌ Falha ao iniciar:', err);
    process.exit(1);
  }
}

start();
