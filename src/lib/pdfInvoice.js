import PDFDocument from 'pdfkit';
import { calculateTotals } from './invoices.js';

export async function createInvoicePdf(invoice) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    drawInvoice(doc, invoice);
    doc.end();
  });
}

function drawInvoice(doc, invoice) {
  const seller = invoice.seller_snapshot || {};
  const currency = seller.currency || '€';
  const totals = calculateTotals(invoice.items || []);
  const pageRight = doc.page.width - doc.page.margins.right;

  doc.fillColor('#0f6e56').fontSize(24).font('Helvetica-Bold').text('Invoice', 48, 48);
  doc.fillColor('#1a1d1b').fontSize(12).font('Helvetica').text(invoice.number || '', 48, 82);

  doc.fontSize(10).fillColor('#656b67');
  doc.text(`Issued: ${invoice.date || '-'}`, 360, 54, { align: 'right' });
  doc.text(`Due: ${invoice.due_date || '-'}`, 360, 70, { align: 'right' });
  doc.text(`Status: ${invoice.status || 'draft'}`, 360, 86, { align: 'right' });

  doc.moveTo(48, 118).lineTo(pageRight, 118).strokeColor('#d8ddd9').stroke();

  drawParty(doc, 'From', seller, 48, 144);
  drawParty(doc, 'Bill To', invoice.customer || {}, 310, 144);

  const tableTop = 260;
  drawTableHeader(doc, tableTop);

  let y = tableTop + 28;
  (invoice.items || []).forEach((item) => {
    if (y > 690) {
      doc.addPage();
      y = 64;
      drawTableHeader(doc, y);
      y += 28;
    }

    const line = (Number(item.qty) || 0) * (Number(item.price) || 0);
    doc.fillColor('#1a1d1b').fontSize(10).font('Helvetica');
    doc.text(item.description || '-', 48, y, { width: 210 });
    doc.text(formatNumber(item.qty), 272, y, { width: 46, align: 'right' });
    doc.text(formatMoney(item.price, currency), 326, y, { width: 70, align: 'right' });
    doc.text(`${formatNumber(item.vat)}%`, 404, y, { width: 48, align: 'right' });
    doc.text(formatMoney(line, currency), 460, y, { width: 86, align: 'right' });

    y += 24;
    doc.moveTo(48, y - 8).lineTo(pageRight, y - 8).strokeColor('#eef1ee').stroke();
  });

  const totalsY = Math.max(y + 20, 560);
  drawTotals(doc, totalsY, totals, currency);

  if (invoice.notes) {
    const notesY = totalsY + 118;
    doc.fillColor('#929993').fontSize(9).font('Helvetica-Bold').text('Notes', 48, notesY);
    doc.fillColor('#656b67').fontSize(10).font('Helvetica').text(invoice.notes, 48, notesY + 18, {
      width: 300,
      lineGap: 3
    });
  }
}

function drawParty(doc, label, party, x, y) {
  doc.fillColor('#929993').fontSize(9).font('Helvetica-Bold').text(label.toUpperCase(), x, y);
  doc.fillColor('#1a1d1b').fontSize(12).font('Helvetica-Bold').text(party.name || '-', x, y + 20, { width: 220 });

  let lineY = y + 42;
  [
    party.address,
    party.email,
    party.vat ? `VAT ${party.vat}` : ''
  ].filter(Boolean).forEach((line) => {
    doc.fillColor('#656b67').fontSize(10).font('Helvetica').text(line, x, lineY, { width: 220 });
    lineY += 15;
  });
}

function drawTableHeader(doc, y) {
  doc.fillColor('#929993').fontSize(9).font('Helvetica-Bold');
  doc.text('DESCRIPTION', 48, y);
  doc.text('QTY', 272, y, { width: 46, align: 'right' });
  doc.text('UNIT', 326, y, { width: 70, align: 'right' });
  doc.text('VAT', 404, y, { width: 48, align: 'right' });
  doc.text('TOTAL', 460, y, { width: 86, align: 'right' });
  doc.moveTo(48, y + 18).lineTo(546, y + 18).strokeColor('#d8ddd9').stroke();
}

function drawTotals(doc, y, totals, currency) {
  drawTotalRow(doc, 'Subtotal', totals.subtotal, currency, y);
  drawTotalRow(doc, 'VAT', totals.vat, currency, y + 22);

  doc.moveTo(350, y + 50).lineTo(546, y + 50).strokeColor('#d8ddd9').stroke();
  doc.fillColor('#656b67').fontSize(11).font('Helvetica').text('Total due', 350, y + 66);
  doc.fillColor('#0f6e56').fontSize(20).font('Helvetica-Bold').text(formatMoney(totals.total, currency), 430, y + 60, {
    width: 116,
    align: 'right'
  });
}

function drawTotalRow(doc, label, value, currency, y) {
  doc.fillColor('#656b67').fontSize(10).font('Helvetica').text(label, 350, y);
  doc.fillColor('#1a1d1b').fontSize(10).font('Helvetica-Bold').text(formatMoney(value, currency), 430, y, {
    width: 116,
    align: 'right'
  });
}

function formatMoney(value, currency) {
  return `${currency}${(Math.round((Number(value) || 0) * 100) / 100).toFixed(2)}`;
}

function formatNumber(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(2);
}
