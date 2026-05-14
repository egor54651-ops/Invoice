import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { calculateTotals, sortInvoices } from './invoices.js';

export const invoiceCsvHeaders = [
  'invoice_id',
  'invoice_number',
  'date',
  'due_date',
  'status',
  'customer_name',
  'customer_email',
  'customer_address',
  'item_index',
  'item_description',
  'item_qty',
  'item_unit_price',
  'item_vat_percent',
  'seller_name',
  'seller_address',
  'seller_vat_id',
  'seller_email',
  'seller_vat_rate',
  'currency',
  'notes',
  'created_at',
  'updated_at'
];

export async function readInvoicesCsv(filePath) {
  await ensureCsv(filePath);
  const raw = await readFile(filePath, 'utf8');
  const rows = parseCsv(raw);
  if (rows.length <= 1) return [];

  const headers = rows[0];
  const grouped = new Map();

  rows.slice(1).forEach((row) => {
    if (row.every((value) => value === '')) return;

    const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
    const id = record.invoice_id;
    if (!id) return;

    if (!grouped.has(id)) {
      grouped.set(id, {
        id,
        number: record.invoice_number,
        date: record.date || null,
        due_date: record.due_date || null,
        status: record.status || 'draft',
        customer: {
          name: record.customer_name,
          email: record.customer_email,
          address: record.customer_address
        },
        items: [],
        notes: record.notes,
        seller_snapshot: {
          name: record.seller_name,
          address: record.seller_address,
          vat: record.seller_vat_id,
          email: record.seller_email,
          vatRate: toNumber(record.seller_vat_rate, 21),
          currency: record.currency || '€'
        },
        created_at: record.created_at,
        updated_at: record.updated_at
      });
    }

    grouped.get(id).items.push({
      index: toNumber(record.item_index),
      description: record.item_description,
      qty: toNumber(record.item_qty),
      price: toNumber(record.item_unit_price),
      vat: toNumber(record.item_vat_percent)
    });
  });

  return sortInvoices(
    [...grouped.values()].map((invoice) => ({
      ...invoice,
      items: invoice.items.sort((a, b) => (a.index || 0) - (b.index || 0)),
      totals: roundTotals(calculateTotals(invoice.items))
    }))
  );
}

export async function writeInvoicesCsv(filePath, invoices) {
  await mkdir(dirname(filePath), { recursive: true });
  const rows = [invoiceCsvHeaders];

  sortInvoices(invoices).forEach((invoice) => {
    const items = invoice.items?.length ? invoice.items : [{ description: '', qty: '', price: '', vat: '' }];

    items.forEach((item, index) => {
      rows.push([
        invoice.id,
        invoice.number,
        invoice.date || '',
        invoice.due_date || '',
        invoice.status || 'draft',
        invoice.customer?.name || '',
        invoice.customer?.email || '',
        invoice.customer?.address || '',
        index,
        item.description || '',
        item.qty ?? '',
        item.price ?? '',
        item.vat ?? '',
        invoice.seller_snapshot?.name || '',
        invoice.seller_snapshot?.address || '',
        invoice.seller_snapshot?.vat || '',
        invoice.seller_snapshot?.email || '',
        invoice.seller_snapshot?.vatRate ?? '',
        invoice.seller_snapshot?.currency || '€',
        invoice.notes || '',
        invoice.created_at || '',
        invoice.updated_at || ''
      ]);
    });
  });

  const csv = `${rows.map((row) => row.map(csvEscape).join(',')).join('\n')}\n`;
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, csv, 'utf8');
  await rename(tmpPath, filePath);
}

export async function upsertInvoiceCsv(filePath, invoice) {
  const invoices = await readInvoicesCsv(filePath);
  const existingIndex = invoices.findIndex((item) => item.id === invoice.id);

  if (existingIndex >= 0) {
    invoice.created_at = invoices[existingIndex].created_at || invoice.created_at;
    invoices[existingIndex] = invoice;
  } else {
    invoices.push(invoice);
  }

  await writeInvoicesCsv(filePath, invoices);
  return { invoice, existed: existingIndex >= 0 };
}

export async function deleteInvoiceCsv(filePath, id) {
  const invoices = await readInvoicesCsv(filePath);
  const nextInvoices = invoices.filter((invoice) => invoice.id !== id);
  await writeInvoicesCsv(filePath, nextInvoices);
  return nextInvoices.length !== invoices.length;
}

export function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    const next = raw[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function csvEscape(value) {
  const string = String(value ?? '');
  if (/[",\n\r]/.test(string)) return `"${string.replace(/"/g, '""')}"`;
  return string;
}

async function ensureCsv(filePath) {
  try {
    await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await writeInvoicesCsv(filePath, []);
  }
}

function roundTotals(totals) {
  return {
    subtotal: roundMoney(totals.subtotal),
    vat: roundMoney(totals.vat),
    total: roundMoney(totals.total)
  };
}

function roundMoney(value) {
  return Math.round((value || 0) * 100) / 100;
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
