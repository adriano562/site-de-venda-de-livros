const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { sendBookByEmail } = require('../services/mailer');
const { privateFileExists } = require('../config/storage');

function hasValidWebhookSignature(signature, requestId, paymentId, secret) {
  if (typeof signature !== 'string' || !requestId || !paymentId || !secret) return false;
  const fields = Object.fromEntries(signature.split(',').map((part) => {
    const separator = part.indexOf('=');
    return separator < 0 ? [part.trim(), ''] : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
  }));
  if (!/^\d+$/.test(fields.ts || '') || !/^[a-f\d]{64}$/i.test(fields.v1 || '')) return false;

  const manifest = `id:${String(paymentId).toLowerCase()};request-id:${requestId};ts:${fields.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest();
  const received = Buffer.from(fields.v1, 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function getOrderIds(data) {
  const metadataIds = data?.metadata?.order_ids;
  if (typeof metadataIds === 'string') {
    const ids = metadataIds.split(',').map((id) => Number(id));
    if (ids.length && ids.every((id) => Number.isSafeInteger(id) && id > 0)) return ids;
  }
  const metadataId = data?.metadata?.order_id ?? data?.metadata?.orderId;
  if (/^\d+$/.test(String(metadataId ?? ''))) return [Number(metadataId)];
  const externalId = String(data?.externalId || '');
  const match = externalId.match(/^orders?-(\d+(?:-\d+)*)$/);
  return match ? match[1].split('-').map(Number) : [];
}

// POST /api/orders - Público - cria pedido e cobrança Pix
router.post('/', auth.user, async (req, res) => {
  try {
    const { customer_name, customer_email } = req.body;
    if (!String(customer_name || '').trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(customer_email || ''))) {
      return res.status(400).json({ error: 'Informe seu nome e um e-mail válido.' });
    }
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
      return res.status(503).json({ error: 'O pagamento Pix ainda não está configurado.' });
    }

    const requestedItems = Array.isArray(req.body.items)
      ? req.body.items
      : [{ book_id: req.body.book_id, quantity: 1 }];
    if (!requestedItems.length || requestedItems.length > 20) {
      return res.status(400).json({ error: 'O carrinho deve ter entre 1 e 20 livros.' });
    }

    const quantities = new Map();
    for (const item of requestedItems) {
      if (!/^\d+$/.test(String(item?.book_id || '')) ||
          !/^\d+$/.test(String(item?.quantity ?? 1))) {
        return res.status(400).json({ error: 'Livro ou quantidade inválidos no carrinho.' });
      }
      const bookId = Number(item.book_id);
      const quantity = Number(item.quantity ?? 1);
      if (!Number.isSafeInteger(bookId) || bookId < 1 || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20) {
        return res.status(400).json({ error: 'Livro ou quantidade inválidos no carrinho.' });
      }
      const combinedQuantity = (quantities.get(bookId) || 0) + quantity;
      if (combinedQuantity > 20) {
        return res.status(400).json({ error: 'A quantidade máxima por livro é 20.' });
      }
      quantities.set(bookId, combinedQuantity);
    }

    const bookIds = [...quantities.keys()];
    const bookResult = await pool.query(
      'SELECT id, title, price, ebook_path FROM books WHERE id = ANY($1::int[]) AND is_published = true',
      [bookIds]
    );
    if (bookResult.rows.length !== bookIds.length) {
      return res.status(404).json({ error: 'Um ou mais livros do carrinho não foram encontrados.' });
    }

    const books = bookResult.rows.map((book) => ({
      ...book,
      quantity: quantities.get(Number(book.id)),
      unitAmount: Math.round(Number(book.price) * 100)
    }));
    const availableFiles = await Promise.all(books.map((book) => privateFileExists(book.ebook_path)));
    if (availableFiles.some((available) => !available)) {
      return res.status(409).json({ error: 'Um ou mais livros ainda não estão disponíveis em PDF para venda.' });
    }
    const amount = books.reduce((total, book) => total + book.unitAmount * book.quantity, 0);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      return res.status(400).json({ error: 'O total do carrinho deve ser de pelo menos R$ 1,00.' });
    }

    const client = await pool.connect();
    let orders;
    try {
      await client.query('BEGIN');
      orders = [];
      for (const book of books) {
        const result = await client.query(
          `INSERT INTO orders (customer_name, customer_email, book_id, quantity, total_price, product_title, ebook_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [
            String(customer_name).trim(),
            String(customer_email).trim().toLowerCase(),
            book.id,
            book.quantity,
            (book.unitAmount * book.quantity) / 100,
            book.title,
            book.ebook_path
          ]
        );
        orders.push(result.rows[0]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const orderIds = orders.map((order) => Number(order.id));

    let paymentResponse;
    try {
      const response = await fetch('https://api.mercadopago.com/v1/payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Idempotency-Key': crypto.randomUUID(),
          Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`
        },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          transaction_amount: amount / 100,
          description: books.map((book) => book.title).join(', ').slice(0, 500),
          payment_method_id: 'pix',
          payer: { email: String(customer_email).trim().toLowerCase() },
          external_reference: `orders-${orderIds.join('-')}`,
          metadata: { order_ids: orderIds.join(',') },
          ...(process.env.MERCADOPAGO_NOTIFICATION_URL
            ? { notification_url: process.env.MERCADOPAGO_NOTIFICATION_URL }
            : {})
        })
      });
      paymentResponse = await response.json();
      if (!response.ok || !paymentResponse.id || !paymentResponse.point_of_interaction?.transaction_data?.qr_code) {
        const mpDetails = paymentResponse?.cause && Array.isArray(paymentResponse.cause)
          ? paymentResponse.cause.map((cause) => [cause?.code, cause?.description || cause?.message].filter(Boolean).join(': ')).filter(Boolean).join(' | ')
          : paymentResponse?.message || 'Resposta vazia da API do Mercado Pago.';
        const pixAccountNotEnabled = paymentResponse?.cause?.some((cause) =>
          String(cause?.code) === '13253' ||
          /key enabled for QR render/i.test(String(cause?.description || ''))
        );
        const invalidCredentials = response.status === 401 || response.status === 403 ||
          paymentResponse?.error === 'unauthorized' ||
          /access[_ ]token|authorization/i.test(String(paymentResponse?.message || ''));
        const mpMessage = invalidCredentials
          ? 'O Mercado Pago recusou a credencial configurada. Confira o Access Token no painel do Mercado Pago e atualize MERCADOPAGO_ACCESS_TOKEN no servidor.'
          : pixAccountNotEnabled
            ? 'A conta do Mercado Pago configurada não está habilitada para gerar QR Code Pix. Configure uma conta/chave Pix válida para continuar.'
            : 'Não foi possível criar a cobrança Pix com a configuração atual do Mercado Pago.';
        console.error('Mercado Pago não criou a cobrança Pix:', mpDetails || response.status);
        await pool.query("UPDATE orders SET status = 'cancelado' WHERE id = ANY($1::int[])", [orderIds]);
        return res.status(502).json({ error: mpMessage });
      }
    } catch (error) {
      console.error('Falha ao solicitar cobrança Pix:', error.message);
      await pool.query("UPDATE orders SET status = 'cancelado' WHERE id = ANY($1::int[])", [orderIds]);
      return res.status(502).json({ error: 'Não foi possível criar a cobrança Pix. Tente novamente.' });
    }

    await pool.query('UPDATE orders SET payment_id = $1 WHERE id = ANY($2::int[])', [String(paymentResponse.id), orderIds]);
    res.status(201).json({
      order_id: orderIds[0],
      order_ids: orderIds,
      payment: {
        brCode: paymentResponse.point_of_interaction.transaction_data.qr_code,
        brCodeBase64: paymentResponse.point_of_interaction.transaction_data.qr_code_base64
          ? `data:image/png;base64,${paymentResponse.point_of_interaction.transaction_data.qr_code_base64}`
          : null,
        expiresAt: paymentResponse.date_of_expiration || null,
        checkoutUrl: paymentResponse.point_of_interaction.transaction_data.ticket_url || null
      }
    });
  } catch (err) {
    console.error('Erro ao criar pedido:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/orders/webhook/mercadopago - confirmação automática de pagamentos Pix
router.post('/webhook/mercadopago', async (req, res) => {
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return res.status(503).json({ error: 'Webhook Pix não está configurado.' });
  }
  const paymentId = req.query['data.id'] || req.body?.data?.id || req.query.id;
  const eventType = req.query.type || req.body?.type;
  if (eventType && eventType !== 'payment') {
    return res.json({ received: true });
  }
  if (!paymentId || !/^\d+$/.test(String(paymentId))) {
    return res.status(400).json({ error: 'Notificação de pagamento incompleta.' });
  }
  if (!hasValidWebhookSignature(
    req.header('x-signature'),
    req.header('x-request-id'),
    paymentId,
    webhookSecret
  )) {
    return res.status(401).json({ error: 'Assinatura do webhook inválida.' });
  }
  if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'A consulta de pagamentos não está configurada.' });
  }

  let payment;
  try {
    const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(15000)
    });
    payment = await response.json();
    if (!response.ok) {
      console.error('Mercado Pago não retornou o pagamento:', payment.message || response.status);
      return res.status(502).json({ error: 'Não foi possível consultar o pagamento.' });
    }
  } catch (error) {
    console.error('Falha ao consultar pagamento no Mercado Pago:', error.message);
    return res.status(502).json({ error: 'Não foi possível consultar o pagamento.' });
  }
  if (String(payment.id) !== String(paymentId)) {
    return res.status(400).json({ error: 'O pagamento recebido não corresponde à notificação.' });
  }
  if (payment.status !== 'approved') {
    return res.json({ received: true });
  }

  const orderIds = getOrderIds({
    metadata: payment.metadata,
    externalId: payment.external_reference
  });
  if (!orderIds.length) {
    return res.status(400).json({ error: 'Pedido não identificado no pagamento.' });
  }

  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const receivedEvent = await client.query(
      'INSERT INTO payment_webhook_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
      [`mercadopago-payment-${payment.id}-${payment.date_last_updated || payment.status}`]
    );
    if (!receivedEvent.rows.length) {
      await client.query('COMMIT');
      return res.json({ received: true, duplicate: true });
    }

    const orderResult = await client.query(
      `SELECT o.*, COALESCE(o.product_title, b.title) AS book_title,
              COALESCE(o.ebook_path, b.ebook_path) AS ebook_path
       FROM orders o
       LEFT JOIN books b ON b.id = o.book_id
       WHERE o.payment_id = $1
       FOR UPDATE OF o`,
      [String(payment.id)]
    );
    if (!orderResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }
    const orders = orderResult.rows;
    const expectedOrderIds = orderIds.sort((a, b) => a - b);
    const actualOrderIds = orders.map((order) => Number(order.id)).sort((a, b) => a - b);
    if (expectedOrderIds.length !== actualOrderIds.length ||
        expectedOrderIds.some((id, index) => id !== actualOrderIds[index]) ||
        Math.round(orders.reduce((total, order) => total + Number(order.total_price), 0) * 100) !== Math.round(Number(payment.transaction_amount) * 100)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'O pagamento não corresponde ao pedido.' });
    }

    if (orders.some((order) => !order.ebook_sent_at)) {
      const firstOrder = orders[0];
      await sendBookByEmail({
        ...firstOrder,
        books: orders.map((order) => ({
          book_title: order.book_title,
          ebook_path: order.ebook_path
        }))
      });
    }
    await client.query("UPDATE orders SET status = 'pago', ebook_sent_at = COALESCE(ebook_sent_at, NOW()) WHERE payment_id = $1", [String(payment.id)]);
    await client.query('COMMIT');
    return res.json({ received: true });
  } catch (err) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Erro ao desfazer transação do webhook:', rollbackError);
      }
    }
    console.error('Erro ao processar confirmação Pix:', err);
    return res.status(500).json({ error: 'Não foi possível concluir a entrega do pedido.' });
  } finally {
    if (client) client.release();
  }
});

// GET /api/orders - Admin - listar pedidos
router.get('/', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.id, o.customer_name, o.customer_email, o.book_id, o.quantity, o.total_price,
             o.status, o.payment_id, o.ebook_sent_at, o.created_at,
             COALESCE(o.product_title, b.title) AS book_title, b.cover_image AS book_cover
      FROM orders o
      LEFT JOIN books b ON o.book_id = b.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Erro ao listar pedidos:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/orders/:id/status - Admin - atualizar status e reenviar entrega se necessário
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['pendente', 'pago', 'enviado', 'entregue', 'cancelado'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Status inválido. Use: ' + validStatuses.join(', ') });
    }

    const result = await pool.query(
      'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pedido não encontrado.' });
    }

    if (status === 'pago' && !result.rows[0].ebook_sent_at) {
      const orderResult = await pool.query(
        `SELECT o.*, COALESCE(o.product_title, b.title) AS book_title,
                COALESCE(o.ebook_path, b.ebook_path) AS ebook_path
         FROM orders o
         LEFT JOIN books b ON b.id = o.book_id
         WHERE o.id = $1`,
        [req.params.id]
      );
      if (!orderResult.rows.length) {
        return res.status(409).json({ error: 'O livro associado ao pedido não está disponível.' });
      }
      await sendBookByEmail(orderResult.rows[0]);
      const delivered = await pool.query(
        'UPDATE orders SET ebook_sent_at = NOW() WHERE id = $1 RETURNING *',
        [req.params.id]
      );
      return res.json(delivered.rows[0]);
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao atualizar pedido ou enviar livro:', err);
    res.status(500).json({ error: err.message || 'Erro interno.' });
  }
});

module.exports = router;
