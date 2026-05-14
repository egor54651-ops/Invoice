import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultSeller, normalizeInvoice, normalizeSeller, sortInvoices } from './lib/invoices.js';
import { readJson, writeJson } from './lib/fileStore.js';
import { createInvoicePdf } from './lib/pdfInvoice.js';
import { deleteInvoiceCsv, readInvoicesCsv, upsertInvoiceCsv, writeInvoicesCsv } from './lib/csvInvoiceStore.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = resolve(__dirname, '..');
const publicDir = join(rootDir, 'public');
const dataDir = join(rootDir, 'data');
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

const server = createServer(async (req, res) => {
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
});

server.listen(port, () => {
  console.log(`Invoice Studio running at http://localhost:${port}`);
});

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

    createReadStream(filePath).pipe(res);
  } catch {
    const fallbackPath = join(publicDir, 'index.html');
    res.writeHead(200, {
      'Content-Type': contentTypes['.html'],
      'Cache-Control': 'no-store'
    });
    createReadStream(fallbackPath).pipe(res);
  }
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
