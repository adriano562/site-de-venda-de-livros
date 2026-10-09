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
  getPrivateFile,
  getPrivateFileStream,
  getPublicObjectUrl,
  privateFileExists,
  uploadObject
};
