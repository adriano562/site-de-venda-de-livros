const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const express = require('express');
const pool = require('../config/db');
const nodemailer = require('nodemailer');

const originalPoolQuery = pool.query;
const originalPoolConnect = pool.connect;
const originalTransport = nodemailer.createTransport;
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

test('Pix do Mercado Pago confirmado por webhook envia os PDFs uma única vez', async (t) => {
  const pdfPath = path.join(os.tmpdir(), `nocturnal-test-${crypto.randomUUID()}.pdf`);
  fs.writeFileSync(pdfPath, '%PDF-1.4');
  t.after(() => fs.promises.unlink(pdfPath).catch((err) => {
    if (err.code !== 'ENOENT') throw err;
  }));

  process.env.MERCADOPAGO_ACCESS_TOKEN = 'test-api-key';
  process.env.MERCADOPAGO_WEBHOOK_SECRET = 'test-webhook-secret';
  process.env.JWT_SECRET = 'test-jwt-secret';
  process.env.SMTP_HOST = 'smtp.test';
  process.env.SMTP_PORT = '587';
  process.env.SMTP_USER = 'sender@test.invalid';
  process.env.SMTP_PASS = 'test-password';
  process.env.MAIL_FROM = 'sender@test.invalid';

  const emails = [];
  nodemailer.createTransport = () => ({
    sendMail: async (message) => {
      const attachments = await Promise.all(message.attachments.map(async (attachment) => {
        const chunks = [];
        for await (const chunk of attachment.content) chunks.push(chunk);
        return { ...attachment, content: Buffer.concat(chunks) };
      }));
      emails.push({ ...message, attachments });
    }
  });

  let savedOrders = [];
  let nextOrderId = 77;
  let orderStatus = 'pendente';
  const processedEvents = new Set();
  pool.query = async (sql, params) => {
    if (sql.includes('SELECT id, title, price, ebook_path FROM books')) {
      const ids = params[0];
      return { rows: [
        { id: 12, title: 'Livro teste', price: '4.99', ebook_path: pdfPath },
        { id: 13, title: 'Outro livro', price: '3.49', ebook_path: pdfPath }
      ].filter((book) => ids.includes(book.id)) };
    }
    if (sql.includes('UPDATE orders SET payment_id = $1 WHERE id = ANY($2::int[])')) {
      savedOrders.forEach((order) => { order.payment_id = params[0]; });
      return { rows: [] };
    }
    if (sql.includes("UPDATE orders SET status = 'cancelado'")) {
      orderStatus = 'cancelado';
      return { rows: [] };
    }
    throw new Error(`Query não esperada no teste: ${sql}`);
  };

  pool.connect = async () => ({
    query: async (sql, params) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('INSERT INTO orders')) {
        const order = {
          id: nextOrderId++,
          customer_name: params[0],
          customer_email: params[1],
          book_id: params[2],
          quantity: params[3],
          total_price: params[4],
          product_title: params[5],
          ebook_path: params[6],
          status: 'pendente',
          payment_id: null,
          ebook_sent_at: null
        };
        savedOrders.push(order);
        return { rows: [order] };
      }
      if (sql.includes('INSERT INTO payment_webhook_events')) {
        if (processedEvents.has(params[0])) return { rows: [] };
        processedEvents.add(params[0]);
        return { rows: [{ event_id: params[0] }] };
      }
      if (sql.includes('WHERE o.payment_id = $1')) {
        return {
          rows: savedOrders.map((order) => ({
            ...order,
            status: orderStatus,
            payment_id: '12345',
            book_title: order.product_title,
            ebook_sent_at: order.ebook_sent_at
          }))
        };
      }
      if (sql.includes("UPDATE orders SET status = 'pago', ebook_sent_at")) {
        orderStatus = 'pago';
        savedOrders.forEach((order) => { order.ebook_sent_at = new Date(); });
        return { rows: [] };
      }
      throw new Error(`Query transacional não esperada no teste: ${sql}`);
    },
    release() {}
  });

  global.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.mercadopago.com/')) return originalFetch(url, options);
    assert.equal(options.headers.Authorization, 'Bearer test-api-key');
    if (options.method !== 'POST') {
      return new Response(JSON.stringify({
        id: 12345,
        status: 'approved',
        external_reference: 'orders-77-78',
        metadata: { order_ids: '77,78' },
        transaction_amount: 11.97,
        date_last_updated: '2026-10-06T22:00:00.000Z'
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    const body = JSON.parse(options.body);
    assert.equal(body.payment_method_id, 'pix');
    assert.equal(body.transaction_amount, 11.97);
    assert.equal(body.payer.email, 'cliente@example.com');
    return new Response(JSON.stringify({
      id: 12345,
      point_of_interaction: {
        transaction_data: {
          qr_code: 'pix-copia-e-cola',
          qr_code_base64: 'cXItY29kZQ==',
          ticket_url: 'https://www.mercadopago.com.br/ticket'
        }
      }
    }), { status: 201, headers: { 'Content-Type': 'application/json' } });
  };

  const app = express();
  app.use(express.json());
  app.use('/api/orders', require('./orders'));
  const server = app.listen(0);
  t.after(() => new Promise((resolve) => server.close(resolve)));

  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const unauthenticatedResponse = await originalFetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: 'Pessoa Teste',
        customer_email: 'cliente@example.com',
        items: [{ book_id: 12, quantity: 1 }]
      })
    });
    assert.equal(unauthenticatedResponse.status, 401);

    const userToken = jwt.sign({ id: 1, email: 'cliente@example.com', name: 'Pessoa Teste', role: 'user' }, process.env.JWT_SECRET);
    const createResponse = await originalFetch(`${baseUrl}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${userToken}` },
      body: JSON.stringify({
        customer_name: 'Pessoa Teste',
        customer_email: 'cliente@example.com',
        items: [{ book_id: 12, quantity: 1 }, { book_id: 13, quantity: 2 }]
      })
    });
    const createdOrder = await createResponse.json();
    assert.equal(createResponse.status, 201);
    assert.equal(createdOrder.order_id, 77);
    assert.deepEqual(createdOrder.order_ids, [77, 78]);
    assert.equal(createdOrder.payment.brCode, 'pix-copia-e-cola');
    assert.equal(createdOrder.payment.brCodeBase64, 'data:image/png;base64,cXItY29kZQ==');

    const paymentId = '12345';
    const requestId = 'request-test-1';
    const timestamp = '1791324000';
    const manifest = `id:${paymentId};request-id:${requestId};ts:${timestamp};`;
    const signature = crypto.createHmac('sha256', process.env.MERCADOPAGO_WEBHOOK_SECRET)
      .update(manifest)
      .digest('hex');
    const webhookUrl = `${baseUrl}/api/orders/webhook/mercadopago?data.id=${paymentId}&type=payment`;
    const webhookRequest = () => originalFetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-signature': `ts=${timestamp},v1=${signature}`,
        'x-request-id': requestId
      },
      body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: paymentId } })
    });

    const firstWebhook = await webhookRequest();
    assert.equal(firstWebhook.status, 200);
    assert.equal(orderStatus, 'pago');
    assert.equal(emails.length, 1);
    assert.equal(emails[0].to, 'cliente@example.com');
    assert.equal(emails[0].attachments.length, 2);
    assert.ok(emails[0].attachments.every((attachment) => attachment.content.toString('ascii') === '%PDF-1.4'));

    const duplicateWebhook = await webhookRequest();
    assert.equal(duplicateWebhook.status, 200);
    assert.equal(emails.length, 1);
  } finally {
    pool.query = originalPoolQuery;
    pool.connect = originalPoolConnect;
    nodemailer.createTransport = originalTransport;
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
  }
});
