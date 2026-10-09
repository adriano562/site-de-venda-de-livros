const assert = require('node:assert/strict');
const test = require('node:test');
const { Writable } = require('node:stream');
const storage = require('./storage');

function readStream(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, encoding, callback) {
        chunks.push(chunk);
        callback();
      }
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    stream.on('error', reject);
    stream.pipe(sink);
  });
}

test('salva e baixa arquivos do Supabase Storage sem expor a chave', async (t) => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://project.supabase.co/';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.SUPABASE_ANON_KEY = 'test-publishable-key';

  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/object/upload/sign/')) {
      return new Response(JSON.stringify({
        signedURL: '/object/upload/sign/uploads/books/cover.png?token=one-time'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (options.method === 'POST') return new Response('{}', { status: 200 });
    if (String(url).includes('/object/info/')) return new Response('{}', { status: 200 });
    return new Response('%PDF-test', { status: 200 });
  };

  t.after(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  });

  const publicUrl = storage.getPublicObjectUrl('uploads', 'cover photo.png');
  assert.equal(publicUrl, 'https://project.supabase.co/storage/v1/object/public/uploads/cover%20photo.png');

  const signedUpload = await storage.createSignedUpload('uploads', 'books/cover.png');
  assert.deepEqual(signedUpload, {
    uploadUrl: 'https://project.supabase.co/storage/v1/object/upload/sign/uploads/books/cover.png?token=one-time',
    publicKey: 'test-publishable-key'
  });
  await storage.uploadObject('uploads', 'cover photo.png', Buffer.from('image'), 'image/png');
  assert.equal(requests[1].url, 'https://project.supabase.co/storage/v1/object/uploads/cover%20photo.png');
  assert.equal(requests[1].options.headers.Authorization, 'Bearer test-service-key');

  const pdf = await storage.getPrivateFile('ebooks/book.pdf');
  assert.equal(pdf.toString(), '%PDF-test');
  const pdfStream = await storage.getPrivateFileStream('ebooks/book.pdf');
  assert.equal((await readStream(pdfStream)).toString(), '%PDF-test');
  assert.equal(await storage.isValidPrivatePdf('ebooks/book.pdf'), true);
  assert.equal(await storage.privateFileExists('ebooks/book.pdf'), true);
  assert.equal(requests[2].url, 'https://project.supabase.co/storage/v1/object/ebooks/book.pdf');
  assert.equal(requests[4].options.headers.Range, 'bytes=0-4');
  assert.equal(requests[5].url, 'https://project.supabase.co/storage/v1/object/info/ebooks/book.pdf');
});
