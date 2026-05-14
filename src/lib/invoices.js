export const defaultSeller = {
  name: '',
  address: '',
  vat: '',
  email: '',
  vatRate: 21,
  currency: '€'
};

export function calculateTotals(items = []) {
  return items.reduce(
    (acc, item) => {
      const qty = toNumber(item.qty);
      const price = toNumber(item.price);
      const vatRate = toNumber(item.vat);
      const lineSubtotal = qty * price;

      acc.subtotal += lineSubtotal;
      acc.vat += lineSubtotal * (vatRate / 100);
      acc.total = acc.subtotal + acc.vat;
      return acc;
    },
    { subtotal: 0, vat: 0, total: 0 }
  );
}

export function normalizeSeller(input = {}) {
  return {
    ...defaultSeller,
    name: stringValue(input.name),
    address: stringValue(input.address),
    vat: stringValue(input.vat),
    email: stringValue(input.email),
    vatRate: toNumber(input.vatRate, defaultSeller.vatRate),
    currency: stringValue(input.currency || defaultSeller.currency)
  };
}

export function normalizeInvoice(input = {}, seller = defaultSeller) {
  const now = new Date().toISOString();
  const id = stringValue(input.id) || `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const dueDate = input.due_date ?? input.due ?? null;
  const normalizedSeller = normalizeSeller(input.seller || input.seller_snapshot || seller);

  return {
    id,
    number: stringValue(input.number),
    date: nullableDate(input.date),
    due_date: nullableDate(dueDate),
    status: normalizeStatus(input.status),
    customer: {
      name: stringValue(input.customer?.name),
      email: stringValue(input.customer?.email),
      address: stringValue(input.customer?.address)
    },
    items: normalizeItems(input.items),
    notes: stringValue(input.notes),
    seller_snapshot: normalizedSeller,
    totals: roundTotals(calculateTotals(input.items)),
    created_at: input.created_at || now,
    updated_at: now
  };
}

export function sortInvoices(invoices = []) {
  return [...invoices].sort((a, b) => {
    const aDate = Date.parse(a.created_at || a.date || '') || 0;
    const bDate = Date.parse(b.created_at || b.date || '') || 0;
    return bDate - aDate;
  });
}

function normalizeItems(items = []) {
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => ({
      description: stringValue(item.description),
      qty: toNumber(item.qty),
      price: toNumber(item.price),
      vat: toNumber(item.vat)
    }))
    .filter((item) => item.description || item.qty || item.price);
}

function normalizeStatus(status) {
  const allowed = new Set(['draft', 'sent', 'paid', 'overdue']);
  return allowed.has(status) ? status : 'draft';
}

function nullableDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
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

function stringValue(value) {
  return String(value ?? '').trim();
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
