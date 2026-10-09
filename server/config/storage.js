const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

function getStorageConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY para usar o armazenamento.');
  }
  return { supabaseUrl, serviceKey };
}

function encodeObjectPath(objectPath) {
  return objectPath.split('/').map(encodeURIComponent).join('/');
}

function objectUrl(bucket, objectPath) {
  const { supabaseUrl } = getStorageConfig();
  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
}

function getPublicObjectUrl(bucket, objectPath) {
  const { supabaseUrl } = getStorageConfig();
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`;
}

async function createSignedUpload(bucket, objectPath) {
  const { supabaseUrl, serviceKey } = getStorageConfig();
  const publicKey = process.env.SUPABASE_ANON_KEY;
  if (!publicKey) {
    throw new Error('Configure SUPABASE_ANON_KEY para habilitar uploads.');
  }
  const response = await fetch(`${supabaseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodeObjectPath(objectPath)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ upsert: false })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao criar URL de upload no Supabase Storage (${response.status}): ${details}`);
  }

  const result = await response.json();
  const signedPath = result.signedURL || result.signedUrl;
  if (typeof signedPath !== 'string' || !signedPath) {
    throw new Error('O Supabase Storage não retornou uma URL de upload assinada.');
  }

  const uploadUrl = new URL(
    signedPath.startsWith('/') ? `/storage/v1${signedPath}` : signedPath,
    supabaseUrl
  );
  if (uploadUrl.origin !== new URL(supabaseUrl).origin) {
    throw new Error('O Supabase Storage retornou uma URL de upload inválida.');
  }
  return { uploadUrl: uploadUrl.toString(), publicKey };
}

async function uploadObject(bucket, objectPath, buffer, contentType) {
  const { serviceKey } = getStorageConfig();
  const response = await fetch(objectUrl(bucket, objectPath), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': contentType,
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao salvar arquivo no Supabase Storage (${response.status}): ${details}`);
  }
}

async function getPrivateFile(objectPath) {
  if (typeof objectPath !== 'string' || !objectPath) {
    throw new Error('Caminho do e-book inválido.');
  }
  if (path.isAbsolute(objectPath)) {
    return fs.readFile(objectPath);
  }

  if (!objectPath.startsWith('ebooks/')) {
    throw new Error('Caminho do e-book inválido.');
  }

  const { serviceKey } = getStorageConfig();
  const response = await fetch(objectUrl('ebooks', objectPath.slice('ebooks/'.length)), {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey
    }
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar e-book do Supabase Storage (${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function getPrivateFileStream(objectPath) {
  if (typeof objectPath !== 'string' || !objectPath) {
    throw new Error('Caminho do e-book inválido.');
  }
  if (path.isAbsolute(objectPath)) {
    return fsSync.createReadStream(objectPath);
  }
  if (!objectPath.startsWith('ebooks/')) {
    throw new Error('Caminho do e-book inválido.');
  }

  const { serviceKey } = getStorageConfig();
  const response = await fetch(objectUrl('ebooks', objectPath.slice('ebooks/'.length)), {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey
    }
  });
  if (!response.ok) {
    throw new Error(`Falha ao baixar e-book do Supabase Storage (${response.status}).`);
  }
  if (!response.body) {
    throw new Error('O Supabase Storage retornou um e-book sem conteúdo.');
  }
  return Readable.fromWeb(response.body);
}

async function privateFileExists(objectPath) {
  if (typeof objectPath !== 'string' || !objectPath) return false;
  if (path.isAbsolute(objectPath)) {
    try {
      await fs.access(objectPath);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
  if (!objectPath.startsWith('ebooks/')) return false;

  const { supabaseUrl, serviceKey } = getStorageConfig();
  const infoUrl = `${supabaseUrl}/storage/v1/object/info/ebooks/${encodeObjectPath(objectPath.slice('ebooks/'.length))}`;
  const response = await fetch(infoUrl, {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey
    }
  });
  if (response.status === 404) return false;
  if (!response.ok) {
    throw new Error(`Falha ao conferir e-book no Supabase Storage (${response.status}).`);
  }
  return true;
}

async function isValidPrivatePdf(objectPath) {
  if (typeof objectPath !== 'string' || !objectPath) return false;
  if (path.isAbsolute(objectPath)) {
    const handle = await fs.open(objectPath, 'r');
    try {
      const header = Buffer.alloc(5);
      const { bytesRead } = await handle.read(header, 0, 5, 0);
      return bytesRead === 5 && header.toString('ascii') === '%PDF-';
    } finally {
      await handle.close();
    }
  }
  if (!objectPath.startsWith('ebooks/')) return false;

  const { serviceKey } = getStorageConfig();
  const response = await fetch(objectUrl('ebooks', objectPath.slice('ebooks/'.length)), {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      Range: 'bytes=0-4'
    }
  });
  if (response.status !== 206 && !response.ok) return false;
  if (!response.body) return false;
  const reader = response.body.getReader();
  const header = new Uint8Array(5);
  let bytesRead = 0;
  try {
    while (bytesRead < header.length) {
      const { value, done } = await reader.read();
      if (done) break;
      const count = Math.min(value.length, header.length - bytesRead);
      header.set(value.subarray(0, count), bytesRead);
      bytesRead += count;
    }
  } finally {
    await reader.cancel();
  }
  return bytesRead === 5 && Buffer.from(header).toString('ascii') === '%PDF-';
}

async function deleteObject(bucket, objectPath) {
  const { supabaseUrl, serviceKey } = getStorageConfig();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ prefixes: [objectPath] })
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Falha ao remover arquivo do Supabase Storage (${response.status}): ${details}`);
  }
}

module.exports = {
  deleteObject,
  createSignedUpload,
  getPrivateFile,
  getPrivateFileStream,
  getPublicObjectUrl,
  isValidPrivatePdf,
  privateFileExists,
  uploadObject
};
