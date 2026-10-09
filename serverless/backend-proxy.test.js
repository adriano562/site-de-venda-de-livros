const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const proxyToBackend = require('./backend-proxy');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test('encaminha API e uploads para a origem do backend', async (t) => {
  const previousApiUrl = process.env.BACKEND_API_URL;
  const backend = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        method: req.method,
        url: req.url,
        body: Buffer.concat(chunks).toString()
      }));
    });
  });
  const backendPort = await listen(backend);
  process.env.BACKEND_API_URL = `http://127.0.0.1:${backendPort}`;

  const vercel = http.createServer((req, res) => {
    req.query = {};
    proxyToBackend(req, res);
  });
  const vercelPort = await listen(vercel);

  t.after(async () => {
    await Promise.all([close(vercel), close(backend)]);
    if (previousApiUrl === undefined) {
      delete process.env.BACKEND_API_URL;
    } else {
      process.env.BACKEND_API_URL = previousApiUrl;
    }
  });

  const apiResponse = await fetch(`http://127.0.0.1:${vercelPort}/api/books?limit=1`, {
    method: 'POST',
    body: 'livro'
  });
  assert.equal(apiResponse.status, 200);
  assert.deepEqual(await apiResponse.json(), {
    method: 'POST',
    url: '/api/books?limit=1',
    body: 'livro'
  });

  const uploadResponse = await fetch(`http://127.0.0.1:${vercelPort}/api/uploads/capa.png`);
  assert.equal(uploadResponse.status, 200);
  assert.deepEqual(await uploadResponse.json(), {
    method: 'GET',
    url: '/uploads/capa.png',
    body: ''
  });
});
