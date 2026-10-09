const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const setupDatabase = require('./models/setup');
const authRoutes = require('./routes/auth');
const booksRoutes = require('./routes/books');
const subscribersRoutes = require('./routes/subscribers');
const bannersRoutes = require('./routes/banners');
const ordersRoutes = require('./routes/orders');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3001;

// Criar pasta de uploads se não existir
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir arquivos estáticos
app.use('/uploads', express.static(uploadsDir));
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));
app.use(express.static(path.join(__dirname, '..'), {
  index: 'index.html',
  extensions: ['html']
}));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/books', booksRoutes);
app.use('/api/subscribers', subscribersRoutes);
app.use('/api', subscribersRoutes); // para /api/subscribe público
app.use('/api/banners', bannersRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/stats', statsRoutes);

// Manifest
app.get('/manifest.json', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'manifest.json'));
});

// SPA fallback - serve index.html para rotas do frontend
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/admin') || req.path.startsWith('/uploads') || req.path.startsWith('/assets')) {
    return next();
  }

  res.sendFile(path.join(__dirname, '..', 'index.html'));
});

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
