require('dotenv').config();

const setupDatabase = require('./models/setup');
const app = require('./app');

const PORT = process.env.PORT || 3001;

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
