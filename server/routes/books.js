const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const ebookDir = path.join(__dirname, '..', '.private-books');
fs.mkdirSync(ebookDir, { recursive: true });

async function removeUploadedFiles(files) {
  await Promise.all(files.map(async (file) => {
    try {
      await fs.promises.unlink(file.path);
    } catch (err) {
      if (err.code !== 'ENOENT') console.error('Erro ao remover upload inválido:', err);
    }
  }));
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, file.fieldname === 'ebook' ? ebookDir : path.join(__dirname, '..', 'uploads')),
  filename: (req, file, cb) => {
    if (file.fieldname === 'ebook') {
      return cb(null, `ebook_${crypto.randomUUID()}.pdf`);
    }
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `book_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'ebook') {
      return cb(ext === '.pdf' && file.mimetype === 'application/pdf' ? null : new Error('O arquivo do livro deve ser PDF.'), ext === '.pdf' && file.mimetype === 'application/pdf');
    }
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    cb(null, allowed.includes(ext));
  },
  limits: { fileSize: 18 * 1024 * 1024 }
});

function uploadBookFiles(req, res, next) {
  upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'ebook', maxCount: 1 }])(req, res, async (err) => {
    if (!err) return next();
    const uploadedFiles = Object.values(req.files || {}).flat();
    await removeUploadedFiles(uploadedFiles);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'Não foi possível carregar os arquivos do livro.' });
  });
}

async function validateBookFiles(req, res, next) {
  const cover = req.files?.cover?.[0];
  const ebook = req.files?.ebook?.[0];
  if (cover && cover.size > 5 * 1024 * 1024) {
    await removeUploadedFiles(Object.values(req.files).flat());
    return res.status(413).json({ error: 'A capa deve ter no máximo 5 MB.' });
  }
  if (ebook) {
    if (ebook.size > 18 * 1024 * 1024) {
      await removeUploadedFiles(Object.values(req.files).flat());
      return res.status(413).json({ error: 'O PDF do livro deve ter no máximo 18 MB para envio por e-mail.' });
    }
    let file;
    try {
      file = await fs.promises.open(ebook.path, 'r');
      const header = Buffer.alloc(5);
      const { bytesRead } = await file.read(header, 0, 5, 0);
      if (bytesRead !== 5 || header.toString('ascii') !== '%PDF-') {
        await removeUploadedFiles([ebook]);
        return res.status(400).json({ error: 'O arquivo enviado não parece ser um PDF válido.' });
      }
    } catch (err) {
      console.error('Erro ao validar o PDF enviado:', err);
      await removeUploadedFiles([ebook]);
      return res.status(400).json({ error: 'Não foi possível validar o PDF enviado.' });
    } finally {
      if (file) await file.close();
    }
  }
  next();
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
router.post('/', auth, uploadBookFiles, validateBookFiles, async (req, res) => {
  try {
    const { title, author, description, price, category, is_featured, is_published } = req.body;
    const coverFile = req.files?.cover?.[0];
    const ebookFile = req.files?.ebook?.[0];
    const cover_image = coverFile ? `/uploads/${coverFile.filename}` : null;
    const ebook_path = ebookFile ? ebookFile.path : null;

    const result = await pool.query(
      `INSERT INTO books (title, author, description, price, cover_image, ebook_path, category, is_featured, is_published)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title, author, description || '', parseFloat(price) || 0, cover_image, ebook_path, category || 'Dark Romance', is_featured === 'true', is_published !== 'false']
    );
    res.status(201).json(publicBook(result.rows[0]));
  } catch (err) {
    await removeUploadedFiles(Object.values(req.files || {}).flat());
    console.error('Erro ao criar livro:', err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/books/:id - Editar livro (admin)
router.put('/:id', auth, uploadBookFiles, validateBookFiles, async (req, res) => {
  try {
    const { title, author, description, price, category, is_featured, is_published } = req.body;
    const existing = await pool.query('SELECT * FROM books WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Livro não encontrado.' });
    }

    const coverFile = req.files?.cover?.[0];
    const ebookFile = req.files?.ebook?.[0];
    const cover_image = coverFile ? `/uploads/${coverFile.filename}` : existing.rows[0].cover_image;
    const ebook_path = ebookFile ? ebookFile.path : existing.rows[0].ebook_path;

    const result = await pool.query(
      `UPDATE books SET title=$1, author=$2, description=$3, price=$4, cover_image=$5, ebook_path=$6, category=$7, is_featured=$8, is_published=$9
       WHERE id=$10 RETURNING *`,
      [
        title || existing.rows[0].title,
        author || existing.rows[0].author,
        description !== undefined ? description : existing.rows[0].description,
        price !== undefined ? parseFloat(price) : existing.rows[0].price,
        cover_image,
        ebook_path,
        category || existing.rows[0].category,
        is_featured !== undefined ? is_featured === 'true' : existing.rows[0].is_featured,
        is_published !== undefined ? is_published === 'true' : existing.rows[0].is_published,
        req.params.id
      ]
    );
    res.json(publicBook(result.rows[0]));
  } catch (err) {
    await removeUploadedFiles(Object.values(req.files || {}).flat());
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
