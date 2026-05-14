import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotals, normalizeInvoice, normalizeSeller } from '../src/lib/invoices.js';
import { parseCsv, readInvoicesCsv, writeInvoicesCsv } from '../src/lib/csvInvoiceStore.js';
import { createInvoicePdf } from '../src/lib/pdfInvoice.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('calculateTotals includes VAT per line item', () => {
  const totals = calculateTotals([
    { qty: 2, price: 100, vat: 21 },
    { qty: 1, price: 50, vat: 6 }
  ]);

  assert.equal(totals.subtotal, 250);
  assert.equal(totals.vat, 45);
  assert.equal(totals.total, 295);
});

test('normalizeSeller keeps defaults for missing values', () => {
  const seller = normalizeSeller({ name: 'BE Standard', vatRate: '12' });

  assert.equal(seller.name, 'BE Standard');
  assert.equal(seller.vatRate, 12);
  assert.equal(seller.currency, '€');
});

test('normalizeInvoice stores due_date and seller snapshot', () => {
  const invoice = normalizeInvoice(
    {
      id: 'inv_test',
      number: '2026-0001',
      due: '2026-06-01',
      items: [{ description: 'Consulting', qty: '1', price: '150', vat: '21' }]
    },
    { name: 'BE Standard', currency: '€' }
  );

  assert.equal(invoice.due_date, '2026-06-01');
  assert.equal(invoice.seller_snapshot.name, 'BE Standard');
  assert.equal(invoice.totals.total, 181.5);
});

test('csv invoice storage round-trips multi-line invoices', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'invoice-studio-'));
  const csvPath = join(dir, 'invoices.csv');

  try {
    const invoice = normalizeInvoice({
      id: 'inv_csv',
      number: '2026-0002',
      date: '2026-05-14',
      due_date: '2026-06-14',
      customer: { name: 'ACME, Inc.' },
      items: [
        { description: 'Design', qty: 1, price: 200, vat: 21 },
        { description: 'Support', qty: 2, price: 50, vat: 6 }
      ],
      notes: 'Line one\nLine two'
    });

    await writeInvoicesCsv(csvPath, [invoice]);
    const invoices = await readInvoicesCsv(csvPath);

    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].items.length, 2);
    assert.equal(invoices[0].customer.name, 'ACME, Inc.');
    assert.equal(invoices[0].notes, 'Line one\nLine two');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parseCsv handles quoted commas and newlines', () => {
  assert.deepEqual(parseCsv('a,b\n"one,two","line 1\nline 2"\n'), [
    ['a', 'b'],
    ['one,two', 'line 1\nline 2']
  ]);
});

test('createInvoicePdf returns a PDF buffer', async () => {
  const invoice = normalizeInvoice({
    number: '2026-0003',
    customer: { name: 'Customer' },
    items: [{ description: 'Service', qty: 1, price: 100, vat: 21 }]
  });

  const pdf = await createInvoicePdf(invoice);

  assert.equal(pdf.subarray(0, 4).toString(), '%PDF');
  assert.ok(pdf.length > 1000);
});
