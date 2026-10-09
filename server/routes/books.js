const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { deleteObject, getPublicObjectUrl, privateFileExists, uploadObject } = require('../config/storage');

const upload = multer({
  storage: multer.memoryStorage(),
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
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message || 'Não foi possível carregar os arquivos do livro.' });
  });
}

async function validateBookFiles(req, res, next) {
  const cover = req.files?.cover?.[0];
  const ebook = req.files?.ebook?.[0];
  if (cover && cover.size > 5 * 1024 * 1024) {
    return res.status(413).json({ error: 'A capa deve ter no máximo 5 MB.' });
  }
  if (ebook) {
    if (ebook.size > 18 * 1024 * 1024) {
      return res.status(413).json({ error: 'O PDF do livro deve ter no máximo 18 MB para envio por e-mail.' });
    }
    if (ebook.buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return res.status(400).json({ error: 'O arquivo enviado não parece ser um PDF válido.' });
    }
  }
  next();
}

async function removeStoredObjects(objects) {
  await Promise.all(objects.map(async ([bucket, objectPath]) => {
    try {
      await deleteObject(bucket, objectPath);
    } catch (error) {
      console.error('Erro ao remover upload incompleto do Supabase Storage:', error);
    }
  }));
}

async function saveBookFiles(files) {
  const uploadedObjects = [];
  let coverImage = null;
  let ebookPath = null;
  try {
    const cover = files?.cover?.[0];
    const ebook = files?.ebook?.[0];
    if (cover) {
      const objectPath = `book_${crypto.randomUUID()}${path.extname(cover.originalname).toLowerCase()}`;
      await uploadObject('uploads', objectPath, cover.buffer, cover.mimetype);
      uploadedObjects.push(['uploads', objectPath]);
      coverImage = getPublicObjectUrl('uploads', objectPath);
    }
    if (ebook) {
      const objectPath = `book_${crypto.randomUUID()}.pdf`;
      await uploadObject('ebooks', objectPath, ebook.buffer, 'application/pdf');
      uploadedObjects.push(['ebooks', objectPath]);
      ebookPath = `ebooks/${objectPath}`;
    }
    return { coverImage, ebookPath, uploadedObjects };
  } catch (error) {
    await removeStoredObjects(uploadedObjects);
    throw error;
  }
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
    const savedFiles = await saveBookFiles(req.files);
    try {
      const result = await pool.query(
        `INSERT INTO books (title, author, description, price, cover_image, ebook_path, category, is_featured, is_published)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [title, author, description || '', parseFloat(price) || 0, savedFiles.coverImage, savedFiles.ebookPath, category || 'Dark Romance', is_featured === 'true', is_published !== 'false']
      );
      res.status(201).json(publicBook(result.rows[0]));
    } catch (error) {
      await removeStoredObjects(savedFiles.uploadedObjects);
      throw error;
    }
  } catch (err) {
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

    const savedFiles = await saveBookFiles(req.files);
    try {
      const result = await pool.query(
        `UPDATE books SET title=$1, author=$2, description=$3, price=$4, cover_image=$5, ebook_path=$6, category=$7, is_featured=$8, is_published=$9
         WHERE id=$10 RETURNING *`,
        [
          title || existing.rows[0].title,
          author || existing.rows[0].author,
          description !== undefined ? description : existing.rows[0].description,
          price !== undefined ? parseFloat(price) : existing.rows[0].price,
          savedFiles.coverImage || existing.rows[0].cover_image,
          savedFiles.ebookPath || existing.rows[0].ebook_path,
          category || existing.rows[0].category,
          is_featured !== undefined ? is_featured === 'true' : existing.rows[0].is_featured,
          is_published !== undefined ? is_published === 'true' : existing.rows[0].is_published,
          req.params.id
        ]
      );
      res.json(publicBook(result.rows[0]));
    } catch (error) {
      await removeStoredObjects(savedFiles.uploadedObjects);
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
