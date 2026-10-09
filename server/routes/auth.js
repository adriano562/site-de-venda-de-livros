const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { sendPasswordResetEmail } = require('../services/mailer');
require('dotenv').config();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const PASSWORD_RESET_TTL_MINUTES = 10;
const PASSWORD_RESET_MAX_ATTEMPTS = 5;
const PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS = 60;

function hashPasswordResetCode(userId, code) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET não está configurado.');
  return crypto.createHmac('sha256', secret).update(`${userId}:${code}`).digest('hex');
}

function createToken(account, role) {
  return jwt.sign(
    { id: account.id, email: account.email, name: account.name, role },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

// POST /api/auth/setup - Criar primeiro admin (só funciona se não existir nenhum)
router.post('/setup', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password, name } = req.body;

  if (!emailPattern.test(email) || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(password, 'utf8') > 72 || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Informe nome, email válido e senha com pelo menos 8 caracteres.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [4815162342]);
    const existing = await client.query('SELECT COUNT(*) FROM admins');
    if (parseInt(existing.rows[0].count) > 0) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Admin já configurado. Use o login.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await client.query(
      'INSERT INTO admins (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashedPassword, name.trim()]
    );
    await client.query('COMMIT');
    const token = createToken(result.rows[0], 'admin');
    res.status(201).json({ admin: result.rows[0], token });
  } catch (err) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Este email já está cadastrado.' });
    }
    console.error('Erro no setup:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  } finally {
    if (client) client.release();
  }
});

// POST /api/auth/login - Login admin
router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const { password } = req.body;

    if (!emailPattern.test(email) || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Email válido e senha são obrigatórios.' });
    }

    const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const admin = result.rows[0];
    const validPassword = await bcrypt.compare(password, admin.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const token = createToken(admin, 'admin');

    res.json({
      admin: { id: admin.id, email: admin.email, name: admin.name },
      token
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/auth/user/register - Criar conta de cliente
router.post('/user/register', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password, name } = req.body;
  if (!emailPattern.test(email) || typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || Buffer.byteLength(password, 'utf8') > 72 || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'Informe nome, email válido e senha com pelo menos 8 caracteres.' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password, name) VALUES ($1, $2, $3) RETURNING id, email, name',
      [email, hashedPassword, name.trim()]
    );
    const user = result.rows[0];
    res.status(201).json({ user, token: createToken(user, 'user') });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Este email já possui uma conta.' });
    }
    console.error('Erro ao criar conta de usuário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/auth/user/login - Login de cliente
router.post('/user/login', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;
  if (!emailPattern.test(email) || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Email válido e senha são obrigatórios.' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0 || !(await bcrypt.compare(password, result.rows[0].password))) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const user = result.rows[0];
    res.json({
      user: { id: user.id, email: user.email, name: user.name },
      token: createToken(user, 'user')
    });
  } catch (err) {
    console.error('Erro no login de usuário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// POST /api/auth/user/forgot-password - Send a time-limited reset link.
router.post('/user/forgot-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  if (!emailPattern.test(email)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length) {
      const user = result.rows[0];
      if (!process.env.JWT_SECRET) {
        console.error('Não foi possível solicitar redefinição de senha: JWT_SECRET não está configurado.');
        return res.status(503).json({ error: 'A recuperação de senha está temporariamente indisponível.' });
      }
      const recentRequest = await pool.query(
        `SELECT 1 FROM password_reset_tokens
         WHERE user_id = $1 AND created_at > NOW() - ($2 * INTERVAL '1 second')
         LIMIT 1`,
        [user.id, PASSWORD_RESET_REQUEST_COOLDOWN_SECONDS]
      );
      if (recentRequest.rows.length) {
        return res.json({ message: 'Se houver uma conta com esse e-mail, enviaremos um código para redefinir a senha.' });
      }

      await pool.query(
        `UPDATE password_reset_tokens
         SET used_at = NOW()
         WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      );
      const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
      const codeHash = hashPasswordResetCode(user.id, code);
      await pool.query(
         `INSERT INTO password_reset_tokens (token_hash, user_id, expires_at, attempts)
          VALUES ($1, $2, NOW() + ($3 * INTERVAL '1 minute'), 0)`,
         [codeHash, user.id, PASSWORD_RESET_TTL_MINUTES]
      );

      try {
         await sendPasswordResetEmail({ email: user.email, name: user.name, code });
      } catch (error) {
         await pool.query(
           'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1',
           [codeHash]
         );
         console.error('Não foi possível enviar o e-mail para redefinir senha:', error);
      }
    }

    return res.json({ message: 'Se houver uma conta com esse e-mail, enviaremos um link para redefinir a senha.' });
  } catch (error) {
    console.error('Erro ao solicitar redefinição de senha:', error);
    return res.status(500).json({ error: 'Não foi possível processar a solicitação.' });
  }
});

// POST /api/auth/user/reset-password - Consume a one-time reset token.
router.post('/user/reset-password', async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { code, password } = req.body;
  if (!emailPattern.test(email) || typeof code !== 'string' || !/^\d{6}$/.test(code) ||
      typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH ||
      Buffer.byteLength(password, 'utf8') > 72) {
    return res.status(400).json({ error: 'Código inválido ou expirado, ou senha fora do tamanho permitido.' });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(503).json({ error: 'A recuperação de senha está temporariamente indisponível.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT t.user_id, t.token_hash, t.attempts
       FROM password_reset_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE u.email = $1 AND t.used_at IS NULL AND t.expires_at > NOW()
       ORDER BY t.created_at DESC
       LIMIT 1
       FOR UPDATE OF t`,
      [email]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Código inválido ou expirado. Solicite um novo código.' });
    }
    const resetRequest = result.rows[0];
    if (resetRequest.attempts >= PASSWORD_RESET_MAX_ATTEMPTS) {
      await client.query(
        'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
        [resetRequest.user_id]
      );
      await client.query('COMMIT');
      return res.status(400).json({ error: 'Limite de tentativas atingido. Solicite um novo código.' });
    }
    const suppliedHash = Buffer.from(hashPasswordResetCode(resetRequest.user_id, code), 'hex');
    const storedHash = Buffer.from(resetRequest.token_hash, 'hex');
    if (suppliedHash.length !== storedHash.length || !crypto.timingSafeEqual(suppliedHash, storedHash)) {
      const attempts = resetRequest.attempts + 1;
      await client.query(
        `UPDATE password_reset_tokens SET attempts = $1, used_at = CASE WHEN $1 >= $2 THEN NOW() ELSE used_at END
         WHERE token_hash = $3`,
        [attempts, PASSWORD_RESET_MAX_ATTEMPTS, resetRequest.token_hash]
      );
      await client.query('COMMIT');
      return res.status(400).json({
        error: attempts >= PASSWORD_RESET_MAX_ATTEMPTS
          ? 'Código incorreto. Limite de tentativas atingido; solicite um novo código.'
          : 'Código incorreto. Confira o e-mail e tente novamente.'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await client.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, resetRequest.user_id]);
    await client.query(
      'UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [resetRequest.user_id]
    );
    await client.query('COMMIT');
    return res.json({ message: 'Senha redefinida. Você já pode entrar com a nova senha.' });
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer redefinição de senha:', rollbackError);
      }
    }
    console.error('Erro ao redefinir senha:', error);
    return res.status(500).json({ error: 'Não foi possível redefinir a senha.' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/auth/user/me - Validar sessão de cliente
router.get('/user/me', auth.user, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Conta não encontrada.' });
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Erro ao consultar usuário:', err);
    res.status(500).json({ error: 'Erro interno do servidor.' });
  }
});

// GET /api/auth/admin/me - Validar sessão administrativa
router.get('/admin/me', auth, (req, res) => {
  res.json({ admin: { id: req.admin.id, email: req.admin.email, name: req.admin.name } });
});

module.exports = router;
