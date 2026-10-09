const pool = require('../config/db');

async function setupDatabase() {
  const client = await pool.connect();
  try {
    console.log('🔧 Criando tabelas...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        token_hash VARCHAR(64) PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        used_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query('ALTER TABLE password_reset_tokens ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0');

    await client.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) DEFAULT 0,
        cover_image VARCHAR(500),
        ebook_path VARCHAR(500),
        category VARCHAR(100),
        is_featured BOOLEAN DEFAULT false,
        is_published BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        subscribed_at TIMESTAMP DEFAULT NOW(),
        is_active BOOLEAN DEFAULT true
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS banners (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subtitle TEXT,
        image_url VARCHAR(500),
        cta_text VARCHAR(100),
        cta_link VARCHAR(255),
        is_active BOOLEAN DEFAULT true,
        position INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        book_id INTEGER REFERENCES books(id) ON DELETE SET NULL,
        quantity INTEGER DEFAULT 1,
        total_price DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) DEFAULT 'pendente',
        payment_id VARCHAR(255),
        product_title VARCHAR(255),
        ebook_path VARCHAR(500),
        ebook_sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('ALTER TABLE books ADD COLUMN IF NOT EXISTS ebook_path VARCHAR(500)');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_id VARCHAR(255)');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS product_title VARCHAR(255)');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ebook_path VARCHAR(500)');
    await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS ebook_sent_at TIMESTAMP');

    await client.query(`
      CREATE TABLE IF NOT EXISTS payment_webhook_events (
        event_id VARCHAR(255) PRIMARY KEY,
        processed_at TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        id SERIAL PRIMARY KEY,
        page VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent TEXT,
        visited_at TIMESTAMP DEFAULT NOW()
      );
    `);

    console.log('✅ Todas as tabelas criadas com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao criar tabelas:', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = setupDatabase;
