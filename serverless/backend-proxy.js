const http = require('node:http');
const https = require('node:https');

const requestHopByHopHeaders = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
];

function sendError(res, statusCode, message) {
  res.statusCode = statusCode;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: message }));
}

function getBackendUrl(req, baseUrl) {
  let requestUrl;
  try {
    requestUrl = new URL(req.url, baseUrl);
  } catch {
    return null;
  }

  if (requestUrl.origin !== baseUrl.origin) {
    return null;
  }

  if (requestUrl.pathname === '/api/uploads' || requestUrl.pathname.startsWith('/api/uploads/')) {
    requestUrl.pathname = requestUrl.pathname.slice('/api'.length);
  }

  if (requestUrl.pathname === '/') {
    const pathSegments = Array.isArray(req.query?.path)
      ? req.query.path
      : typeof req.query?.path === 'string'
        ? [req.query.path]
        : null;
    if (pathSegments) {
      requestUrl.pathname = `/api/${pathSegments.map(encodeURIComponent).join('/')}`;
    }
  }

  return requestUrl;
}

function proxyToBackend(req, res) {
  if (!process.env.BACKEND_API_URL) {
    sendError(res, 500, 'BACKEND_API_URL não está configurada.');
    return;
  }

  let baseUrl;
  try {
    baseUrl = new URL(process.env.BACKEND_API_URL);
  } catch {
    sendError(res, 500, 'BACKEND_API_URL deve ser uma URL válida.');
    return;
  }

  if (!['http:', 'https:'].includes(baseUrl.protocol)
    || baseUrl.pathname !== '/'
    || baseUrl.search
    || baseUrl.hash
    || baseUrl.username
    || baseUrl.password) {
    sendError(res, 500, 'BACKEND_API_URL deve conter somente a origem HTTP(S) da API.');
    return;
  }

  const backendUrl = getBackendUrl(req, baseUrl);
  if (!backendUrl) {
    sendError(res, 400, 'Caminho de destino inválido.');
    return;
  }

  const transport = backendUrl.protocol === 'https:' ? https : http;
  const headers = { ...req.headers, host: backendUrl.host };
  for (const header of requestHopByHopHeaders) {
    delete headers[header];
  }

  const backendRequest = transport.request({
    protocol: backendUrl.protocol,
    hostname: backendUrl.hostname,
    port: backendUrl.port,
    method: req.method,
    path: `${backendUrl.pathname}${backendUrl.search}`,
    headers
  }, (backendResponse) => {
    const responseHeaders = { ...backendResponse.headers };
    for (const header of requestHopByHopHeaders) {
      delete responseHeaders[header];
    }

    res.writeHead(backendResponse.statusCode || 502, responseHeaders);
    backendResponse.pipe(res);
  });

  backendRequest.on('error', (error) => {
    console.error('Falha ao encaminhar requisição para a API:', error);
    if (!res.headersSent) {
      sendError(res, 502, 'Não foi possível conectar à API.');
    } else {
      res.destroy(error);
    }
  });

  req.on('aborted', () => backendRequest.destroy());
  req.pipe(backendRequest);
}

module.exports = proxyToBackend;
