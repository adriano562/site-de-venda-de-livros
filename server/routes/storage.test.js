const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');
const jwt = require('jsonwebtoken');

function request(server, method, path, token, body) {
  const address = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: address.port,
      method,
      path,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString())
      }));
    });
    req.on('error', reject);
    req.end(payload);
  });
}

test('signed uploads require admin auth and validate files before contacting Supabase', async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.SUPABASE_ANON_KEY = 'test-publishable-key';

  let storageRequests = 0;
  global.fetch = async (url) => {
    storageRequests += 1;
    const requestUrl = new URL(String(url));
    assert.match(requestUrl.pathname, /^\/storage\/v1\/object\/upload\/sign\/ebooks\/books\/[a-f\d-]{36}\.pdf$/i);
    return new Response(JSON.stringify({
      signedURL: `${requestUrl.pathname.replace('/storage/v1', '')}?token=one-time`
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const app = express();
  app.use(express.json());
  app.use('/api/storage', require('./storage'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  const file = {
    kind: 'ebook',
    filename: 'book.pdf',
    content_type: 'application/pdf',
    size: 1024
  };
  const unauthorized = await request(server, 'POST', '/api/storage/sign', null, file);
  assert.equal(unauthorized.status, 401);

  const adminToken = jwt.sign({ role: 'admin' }, process.env.JWT_SECRET);
  const invalid = await request(server, 'POST', '/api/storage/sign', adminToken, {
    ...file,
    content_type: 'application/octet-stream'
  });
  assert.equal(invalid.status, 400);
  assert.equal(storageRequests, 0);

  const signed = await request(server, 'POST', '/api/storage/sign', adminToken, file);
  assert.equal(signed.status, 200);
  assert.match(signed.body.object_path, /^ebooks\/books\/[a-f\d-]{36}\.pdf$/i);
  assert.equal(signed.body.api_key, 'test-publishable-key');
  assert.match(signed.body.upload_url, /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/upload\/sign\/ebooks\/books\/[a-f\d-]{36}\.pdf\?token=one-time$/i);
  assert.equal(storageRequests, 1);
});
