const jwt = require('jsonwebtoken');
require('dotenv').config();

function getToken(req) {
  const authorization = req.header('Authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function verifyToken(token) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return null;
  }
}

const auth = (req, res, next) => {
  const token = getToken(req);

  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'admin') {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  req.admin = decoded;
  next();
};

auth.user = (req, res, next) => {
  const token = getToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
  }

  const decoded = verifyToken(token);
  if (!decoded || decoded.role !== 'user') {
    return res.status(401).json({ error: 'Token inválido ou expirado.' });
  }

  req.user = decoded;
  next();
};

auth.isAdminToken = (req) => {
  const token = getToken(req);
  if (!token) return false;

  const decoded = verifyToken(token);
  return Boolean(decoded && decoded.role === 'admin');
};

module.exports = auth;
