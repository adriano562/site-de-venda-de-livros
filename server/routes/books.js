const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { deleteObject, getPublicObjectUrl, isValidPrivatePdf } = require('../config/storage');

const coverPathPattern = /^books\/[a-f\d-]{36}\.(?:jpe?g|png|webp)$/i;
const ebookPathPattern = /^ebooks\/books\/[a-f\d-]{36}\.pdf$/i;

async function removeBookFiles(coverPath, ebookPath) {
  const objects = [
    ...(coverPath ? [['uploads', coverPath]] : []),
    ...(ebookPath ? [['ebooks', ebookPath.slice('ebooks/'.length)]] : [])
  ];
  await Promise.all(objects.map(async ([bucket, objectPath]) => {
    try {
      await deleteObject(bucket, objectPath);
    } catch (cleanupError) {
      console.error('Erro ao remover upload não utilizado do Supabase Storage:', cleanupError);
    }
  }));
}

async function validateBookUpload(coverPath, ebookPath, res) {
  if (coverPath && !coverPathPattern.test(coverPath)) {
    res.status(400).json({ error: 'Caminho da capa inválido.' });
    return false;
  }
  if (ebookPath && !ebookPathPattern.test(ebookPath)) {
    res.status(400).json({ error: 'Caminho do PDF inválido.' });
    return false;
  }
  if (ebookPath && !(await isValidPrivatePdf(ebookPath))) {
    res.status(400).json({ error: 'O PDF enviado não é válido ou não está disponível.' });
    return false;
  }
  return true;
}

function publicBook(book) {
  const { ebook_path, ...details } = book;
  return { ...details, ebook_available: Boolean(ebook_path) };
}

// GET /api/books - Listar todos (público pode ver publicados, admin vê todos)
router.get('/', async (req, res) => {
  try {
    const isAdmin = auth.isAdminToken(req);
    let result;
    if (isAdmin) {
      result = await pool.query('SELECT * FROM books ORDER BY created_at DESC');
    } else {
      result = await pool.query('SELECT * FROM books WHERE is_published = true ORDER BY created_at DESC');
    }
    res.json(result.rows.map(publicBook));
  } catch (err) {
    console.error('Erro ao listar livros:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/books/:id - Detalhes de um livro
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM books WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado.' });
    }
    res.json(publicBook(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/books - Criar livro (admin)
router.post('/', auth, async (req, res) => {
  try {
    const { title, author, description, price, category, is_featured, is_published } = req.body;
    const coverPath = req.body.cover_path || null;
    const ebookPath = req.body.ebook_path || null;
    if (!(await validateBookUpload(coverPath, ebookPath, res))) return;
    try {
      const result = await pool.query(
        `INSERT INTO books (title, author, description, price, cover_image, ebook_path, category, is_featured, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, author, description || '', parseFloat(price) || 0, coverPath ? getPublicObjectUrl('uploads', coverPath) : null, ebookPath, category || 'Dark Romance', is_featured === 'true', is_published !== 'false']
      );
      res.status(201).json(publicBook(result.rows[0]));
    } catch (error) {
      await removeBookFiles(coverPath, ebookPath);
      throw error;
    }
  } catch (err) {
    console.error('Erro ao criar livro:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/books/:id - Editar livro (admin)
router.put('/:id', auth, async (req, res) => {
  try {
    const { title, author, description, price, category, is_featured, is_published } = req.body;
    const existing = await pool.query('SELECT * FROM books WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado.' });
    }

    const coverPath = req.body.cover_path || null;
    const ebookPath = req.body.ebook_path || null;
    if (!(await validateBookUpload(coverPath, ebookPath, res))) return;
    try {
      const result = await pool.query(
        `UPDATE books SET title=$1, author=$2, description=$3, price=$4, cover_image=$5, ebook_path=$6, category=$7, is_featured=$8, is_published=$9
         WHERE id=$10 RETURNING *`,
        [
          title || existing.rows[0].title,
          author || existing.rows[0].author,
          description !== undefined ? description : existing.rows[0].description,
          price !== undefined ? parseFloat(price) : existing.rows[0].price,
          coverPath ? getPublicObjectUrl('uploads', coverPath) : existing.rows[0].cover_image,
          ebookPath || existing.rows[0].ebook_path,
          category || existing.rows[0].category,
          is_featured !== undefined ? is_featured === 'true' : existing.rows[0].is_featured,
          is_published !== undefined ? is_published === 'true' : existing.rows[0].is_published,
          req.params.id
        ]
      );
      res.json(publicBook(result.rows[0]));
    } catch (error) {
      await removeBookFiles(coverPath, ebookPath);
      throw error;
    }
  } catch (err) {
    console.error('Erro ao editar livro:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/books/:id - Remover livro (admin)
router.delete('/:id', auth, async (req, res) => {
  try {
    const outstanding = await pool.query(
      `SELECT id FROM orders
       WHERE book_id = $1
         AND (status = 'pendente' OR (status IN ('pago', 'enviado') AND ebook_sent_at IS NULL))
       LIMIT 1`,
      [req.params.id]
    );
    if (outstanding.rows.length) {
      return res.status(409).json({ error: 'Não é possível remover este livro enquanto houver pedidos aguardando pagamento ou entrega.' });
    }

    const result = await pool.query('DELETE FROM books WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado.' });
    }
    res.json({ message: 'Livro removido.', book: publicBook(result.rows[0]) });
  } catch (err) {
    res.status(500).json({ error: 'Erro interno.' });
  }
});

module.exports = router;
