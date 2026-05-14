import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultSeller, normalizeInvoice, normalizeSeller, sortInvoices } from './lib/invoices.js';
import { readJson, writeJson } from './lib/fileStore.js';
import { createInvoicePdf } from './lib/pdfInvoice.js';
import { deleteInvoiceCsv, readInvoicesCsv, upsertInvoiceCsv, writeInvoicesCsv } from './lib/csvInvoiceStore.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const currentFile = fileURLToPath(import.meta.url);
const rootDir = resolve(__dirname, '..');
const publicDir = join(rootDir, 'public');
const dataDir = process.env.VERCEL ? join(tmpdir(), 'invoice-studio-data') : join(rootDir, 'data');
const invoicesCsvPath = join(dataDir, 'invoices.csv');
const invoicesJsonPath = join(dataDir, 'invoices.json');
const sellerPath = join(dataDir, 'seller.json');
const port = Number(process.env.PORT || 3000);

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

export async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error' });
  }
}

async function handler(req, res) {
  if (res?.writeHead) {
    await handleRequest(req, res);
    return;
  }

  return handleFetchRequest(req);
}

handler.fetch = handleFetchRequest;

export default handler;

export async function handleApiRequest(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    await handleApi(req, res, url);
  } catch (error) {
    console.error(error);
    sendJson(res, error.statusCode || 500, { error: error.statusCode ? error.message : 'Internal server error' });
  }
}

async function handleFetchRequest(request) {
  try {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      return handleFetchApi(request, url);
    }

    return serveFetchStatic(request, url);
  } catch (error) {
    console.error(error);
    return jsonResponse(error.statusCode || 500, {
      error: error.statusCode ? error.message : 'Internal server error'
    });
  }
}

async function handleFetchApi(request, url) {
  if (request.method === 'GET' && url.pathname === '/api/health') {
    return jsonResponse(200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname === '/api/invoices') {
    const invoices = await loadInvoices();
    return jsonResponse(200, sortInvoices(invoices));
  }

  if (request.method === 'POST' && url.pathname === '/api/invoices') {
    const body = await readFetchBody(request);
    const seller = await readJson(sellerPath, defaultSeller);
    const invoice = normalizeInvoice(body, seller);

    if (!invoice.number) {
      return jsonResponse(400, { error: 'Invoice number is required' });
    }

    if (invoice.items.length === 0) {
      return jsonResponse(400, { error: 'At least one line item is required' });
    }

    const result = await upsertInvoiceCsv(invoicesCsvPath, invoice);
    return jsonResponse(result.existed ? 200 : 201, result.invoice);
  }

  if (request.method === 'GET' && url.pathname === '/api/invoice/pdf') {
    const id = url.searchParams.get('id');

    if (!id) {
      return jsonResponse(400, { error: 'Invoice id is required' });
    }

    const invoices = await loadInvoices();
    const invoice = invoices.find((item) => item.id === id);

    if (!invoice) {
      return jsonResponse(404, { error: 'Invoice not found' });
    }

    const pdf = await createInvoicePdf(invoice);
    const filename = sanitizeFilename(`invoice-${invoice.number || invoice.id}.pdf`);

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(pdf.length),
        'Cache-Control': 'no-store'
      }
    });
  }

  if (request.method === 'DELETE' && url.pathname === '/api/invoice') {
    const id = url.searchParams.get('id');

    if (!id) {
      return jsonResponse(400, { error: 'Invoice id is required' });
    }

    const deleted = await deleteInvoiceCsv(invoicesCsvPath, id);

    if (!deleted) {
      return jsonResponse(404, { error: 'Invoice not found' });
    }

    return jsonResponse(200, { ok: true });
  }

  if (request.method === 'GET' && url.pathname === '/api/seller') {
    const seller = normalizeSeller(await readJson(sellerPath, defaultSeller));
    return jsonResponse(200, seller);
  }

  if (request.method === 'PUT' && url.pathname === '/api/seller') {
    const seller = normalizeSeller(await readFetchBody(request));
    await writeJson(sellerPath, seller);
    return jsonResponse(200, seller);
  }

  return jsonResponse(404, { error: 'Not found' });
}

async function serveFetchStatic(request, url) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return textResponse(405, 'Method not allowed');
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    return textResponse(403, 'Forbidden');
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');

    return fileResponse(request, filePath);
  } catch {
    const fallbackPath = join(publicDir, 'index.html');
    try {
      await stat(fallbackPath);
      return fileResponse(request, fallbackPath);
    } catch {
      return textResponse(404, 'Not found');
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === currentFile) {
  const server = createServer(handleRequest);

  server.listen(port, () => {
    console.log(`Invoice Studio running at http://localhost:${port}`);
  });
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/invoices') {
    const invoices = await loadInvoices();
    sendJson(res, 200, sortInvoices(invoices));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/invoices') {
    const body = await readBody(req);
    const seller = await readJson(sellerPath, defaultSeller);
    const invoice = normalizeInvoice(body, seller);

    if (!invoice.number) {
      sendJson(res, 400, { error: 'Invoice number is required' });
      return;
    }

    if (invoice.items.length === 0) {
      sendJson(res, 400, { error: 'At least one line item is required' });
      return;
    }

    const result = await upsertInvoiceCsv(invoicesCsvPath, invoice);
    sendJson(res, result.existed ? 200 : 201, result.invoice);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/invoice/pdf') {
    const id = url.searchParams.get('id');

    if (!id) {
      sendJson(res, 400, { error: 'Invoice id is required' });
      return;
    }

    const invoices = await loadInvoices();
    const invoice = invoices.find((item) => item.id === id);

    if (!invoice) {
      sendJson(res, 404, { error: 'Invoice not found' });
      return;
    }

    const pdf = await createInvoicePdf(invoice);
    const filename = sanitizeFilename(`invoice-${invoice.number || invoice.id}.pdf`);

    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': pdf.length,
      'Cache-Control': 'no-store'
    });
    res.end(pdf);
    return;
  }

  if (req.method === 'DELETE' && url.pathname === '/api/invoice') {
    const id = url.searchParams.get('id');

    if (!id) {
      sendJson(res, 400, { error: 'Invoice id is required' });
      return;
    }

    const deleted = await deleteInvoiceCsv(invoicesCsvPath, id);

    if (!deleted) {
      sendJson(res, 404, { error: 'Invoice not found' });
      return;
    }

    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/seller') {
    const seller = normalizeSeller(await readJson(sellerPath, defaultSeller));
    sendJson(res, 200, seller);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/seller') {
    const seller = normalizeSeller(await readBody(req));
    await writeJson(sellerPath, seller);
    sendJson(res, 200, seller);
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
}

async function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendText(res, 405, 'Method not allowed');
    return;
  }

  const requestedPath = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const filePath = normalize(join(publicDir, requestedPath));

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, 'Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');

    res.writeHead(200, {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });

    if (req.method === 'HEAD') {
      res.end();
      return;
    }

    pipeFile(filePath, res);
  } catch {
    const fallbackPath = join(publicDir, 'index.html');
    try {
      await stat(fallbackPath);
      res.writeHead(200, {
        'Content-Type': contentTypes['.html'],
        'Cache-Control': 'no-store'
      });
      pipeFile(fallbackPath, res);
    } catch {
      sendText(res, 404, 'Not found');
    }
  }
}

function pipeFile(filePath, res) {
  const stream = createReadStream(filePath);
  stream.on('error', (error) => {
    console.error(error);
    if (!res.headersSent) {
      sendText(res, 500, 'Unable to read file');
      return;
    }
    res.destroy(error);
  });
  stream.pipe(res);
}

async function readBody(req) {
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

async function readFetchBody(request) {
  const raw = await request.text();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Invalid JSON');
    error.statusCode = 400;
    throw error;
  }
}

async function fileResponse(request, filePath) {
  return new Response(request.method === 'HEAD' ? null : await readFile(filePath), {
    status: 200,
    headers: {
      'Content-Type': contentTypes[extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    }
  });
}

function jsonResponse(statusCode, payload) {
  return new Response(`${JSON.stringify(payload)}\n`, {
    status: statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function textResponse(statusCode, text) {
  return new Response(text, {
    status: statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(`${JSON.stringify(payload)}\n`);
}

function sendText(res, statusCode, text) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

async function loadInvoices() {
  try {
    await stat(invoicesCsvPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;

    try {
      const legacyInvoices = await readJson(invoicesJsonPath, []);
      await writeInvoicesCsv(invoicesCsvPath, legacyInvoices);
    } catch (legacyError) {
      if (legacyError.code !== 'ENOENT') throw legacyError;
      await writeInvoicesCsv(invoicesCsvPath, []);
    }
  }

  return readInvoicesCsv(invoicesCsvPath);
}

function sanitizeFilename(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '-').replace(/-+/g, '-');
}
