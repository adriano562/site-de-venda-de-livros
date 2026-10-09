const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const express = require('express');
const pool = require('../config/db');
const nodemailer = require('nodemailer');

const originalPoolQuery = pool.query;
const originalPoolConnect = pool.connect;
const originalTransport = nodemailer.createTransport;

test('password reset emails a one-time code and updates the password once', async (t) => {
  const originalEnv = { ...process.env };
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'sender@test.invalid';
  process.env.SMTP_PASS = 'test-password';
  process.env.MAIL_FROM = 'sender@test.invalid';
  process.env.APP_BASE_URL = 'https://nocturnal.test';
  process.env.JWT_SECRET = 'test-jwt-secret';

  const sentEmails = [];
  nodemailer.createTransport = () => ({
    sendMail: async (message) => sentEmails.push(message)
  });

  let savedTokenHash;
  let savedPasswordHash;
  let tokenUsed = false;
  let attempts = 0;
  pool.query = async (sql, params) => {
    if (sql.includes('SELECT id, email, name FROM users')) {
      return { rows: params[0] === 'customer@example.com' ? [{ id: 8, email: params[0], name: 'Cliente' }] : [] };
    }
    if (sql.includes('SELECT 1 FROM password_reset_tokens')) return { rows: [] };
    if (sql.includes('INSERT INTO password_reset_tokens')) {
      [savedTokenHash] = params;
      return { rows: [] };
    }
    if (sql.includes('UPDATE password_reset_tokens') && sql.includes('WHERE user_id')) {
      return { rows: [] };
    }
    if (sql.includes('SET used_at = NOW() WHERE token_hash')) {
      tokenUsed = true;
      return { rows: [] };
    }
    throw new Error(`Query não esperada no teste: ${sql}`);
  };

  pool.connect = async () => ({
    query: async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('SELECT t.user_id, t.token_hash, t.attempts')) {
        const matches = !tokenUsed && params[0] === 'customer@example.com';
        return { rows: matches ? [{ user_id: 8, token_hash: savedTokenHash, attempts }] : [] };
      }
      if (sql.includes('UPDATE users SET password')) {
        savedPasswordHash = params[0];
        return { rows: [] };
      }
      if (sql.includes('UPDATE password_reset_tokens SET attempts')) {
        attempts = params[0];
        if (attempts >= 5) tokenUsed = true;
        return { rows: [] };
      }
      if (sql.includes('UPDATE password_reset_tokens SET used_at')) {
        tokenUsed = true;
        return { rows: [] };
      }
      throw new Error(`Query transacional não esperada no teste: ${sql}`);
    },
    release() {}
  });

  const app = express();
  app.use(express.json());
  app.use('/api/auth', require('./auth'));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unknownResponse = await fetch(`${baseUrl}/api/auth/user/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'missing@example.com' })
    });
    const unknownResult = await unknownResponse.json();
    assert.equal(unknownResponse.status, 200);
    assert.match(unknownResult.message, /Se houver uma conta/);
    assert.equal(sentEmails.length, 0);

    const requestResponse = await fetch(`${baseUrl}/api/auth/user/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'CUSTOMER@example.com' })
    });
    assert.equal(requestResponse.status, 200);
    assert.equal(sentEmails.length, 1);
    const code = sentEmails[0].text.match(/^\d{6}$/m)[0];
    const expectedHash = crypto.createHmac('sha256', process.env.JWT_SECRET).update(`8:${code}`).digest('hex');
    assert.equal(expectedHash, savedTokenHash);
    assert.doesNotMatch(sentEmails[0].text, /localhost|https?:\/\//);

    const resetResponse = await fetch(`${baseUrl}/api/auth/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@example.com', code, password: 'new-strong-password' })
    });
    assert.equal(resetResponse.status, 200);
    assert.equal(await bcrypt.compare('new-strong-password', savedPasswordHash), true);

    const reuseResponse = await fetch(`${baseUrl}/api/auth/user/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'customer@example.com', code, password: 'another-password' })
    });
    assert.equal(reuseResponse.status, 400);
  } finally {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    nodemailer.createTransport = originalTransport;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
});
