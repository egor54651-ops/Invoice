const api = {
  async getInvoices() {
    const response = await fetch('/api/invoices');
    return response.ok ? response.json() : [];
  },
  async saveInvoice(invoice) {
    const response = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(invoice)
    });

    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  },
  async deleteInvoice(id) {
    const response = await fetch(`/api/invoice?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(await apiError(response));
  },
  pdfUrl(id) {
    return `/api/invoice/pdf?id=${encodeURIComponent(id)}`;
  },
  async getSeller() {
    const response = await fetch('/api/seller');
    return response.ok ? response.json() : {};
  },
  async saveSeller(data) {
    const response = await fetch('/api/seller', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error(await apiError(response));
    return response.json();
  }
};

let invoices = [];
let seller = { name: '', address: '', vat: '', email: '', vatRate: 21, currency: '€' };
let currentItems = [];
let editingId = null;

function fmt(value, currency = seller.currency) {
  const symbol = currency || '€';
  return `${symbol}${(Math.round((value || 0) * 100) / 100).toFixed(2)}`;
}

function currencyLabel(symbol) {
  const map = { '€': 'EUR', '$': 'USD', '£': 'GBP', CHF: 'CHF', kr: 'SEK' };
  return map[symbol] || symbol || 'EUR';
}

function flashStatus(message, type = 'ok', targetId = 'save-status-wrap') {
  const element = document.getElementById(targetId);
  if (!element) return;

  element.textContent = message;
  element.className = `save-status ${type}`;

  window.setTimeout(() => {
    element.textContent = '';
    element.className = 'save-status';
  }, 2500);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const prefix = `${year}-`;
  let max = 0;

  invoices.forEach((invoice) => {
    if (invoice.number?.startsWith(prefix)) {
      const number = Number.parseInt(invoice.number.slice(prefix.length), 10);
      if (!Number.isNaN(number) && number > max) max = number;
    }
  });

  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function calcTotals(items) {
  let subtotal = 0;
  let vat = 0;

  (items || []).forEach((item) => {
    const line = (Number(item.qty) || 0) * (Number(item.price) || 0);
    subtotal += line;
    vat += line * ((Number(item.vat) || 0) / 100);
  });

  return { subtotal, vat, total: subtotal + vat };
}

function renderItems() {
  const container = document.getElementById('items-container');
  container.innerHTML = '';

  if (currentItems.length === 0) {
    container.innerHTML = '<div class="items-empty">No line items yet. Click "Add line" to start.</div>';
    return;
  }

  currentItems.forEach((item, index) => {
    const lineTotal = (item.qty || 0) * (item.price || 0);
    const row = document.createElement('div');
    row.className = 'item-row';
    row.innerHTML = `
      <input type="text" data-field="description" data-idx="${index}" value="${escapeAttr(item.description)}" placeholder="Description" />
      <input type="number" data-field="qty" data-idx="${index}" value="${item.qty}" min="0" step="0.01" />
      <input type="number" data-field="price" data-idx="${index}" value="${item.price}" min="0" step="0.01" />
      <input type="number" data-field="vat" data-idx="${index}" value="${item.vat}" min="0" max="100" step="0.1" />
      <div class="item-line-total">${fmt(lineTotal)}</div>
      <button type="button" class="item-remove" data-remove="${index}" aria-label="Remove"><i class="ti ti-x"></i></button>
    `;
    container.appendChild(row);
  });

  container.querySelectorAll('input').forEach((input) => {
    input.addEventListener('input', (event) => {
      const index = Number(event.target.dataset.idx);
      const field = event.target.dataset.field;

      if (field === 'description') currentItems[index].description = event.target.value;
      else currentItems[index][field] = Number.parseFloat(event.target.value) || 0;

      renderTotals();
      const row = document.querySelectorAll('#items-container .item-row')[index];
      if (row) {
        row.querySelector('.item-line-total').textContent = fmt(
          (currentItems[index].qty || 0) * (currentItems[index].price || 0)
        );
      }
    });
  });

  container.querySelectorAll('[data-remove]').forEach((button) => {
    button.addEventListener('click', (event) => {
      currentItems.splice(Number(event.currentTarget.dataset.remove), 1);
      renderItems();
      renderTotals();
    });
  });
}

function renderTotals() {
  const totals = calcTotals(currentItems);
  document.getElementById('sum-subtotal').textContent = fmt(totals.subtotal);
  document.getElementById('sum-vat').textContent = fmt(totals.vat);
  document.getElementById('sum-total').textContent = fmt(totals.total);
  document.getElementById('meta-items').textContent = currentItems.length;
  document.getElementById('summary-number').textContent = document.getElementById('inv-number').value || '—';
}

function showView(name) {
  ['new', 'list', 'settings', 'detail'].forEach((view) => {
    document.getElementById(`view-${view}`).hidden = view !== name;
  });

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.view === name);
  });

  if (name === 'list') renderList();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderList() {
  const stats = document.getElementById('list-stats');
  const totals = invoices.reduce(
    (acc, invoice) => {
      const invoiceTotals = calcTotals(invoice.items || []);
      acc.count += 1;
      acc.total += invoiceTotals.total;
      if (invoice.status === 'paid') acc.paid += invoiceTotals.total;
      else if (invoice.status !== 'draft') acc.outstanding += invoiceTotals.total;
      return acc;
    },
    { count: 0, total: 0, paid: 0, outstanding: 0 }
  );

  stats.innerHTML = `
    ${stat('Invoices', totals.count)}
    ${stat('Invoiced', fmt(totals.total))}
    ${stat('Paid', fmt(totals.paid), true)}
    ${stat('Outstanding', fmt(totals.outstanding))}
  `;

  const container = document.getElementById('list-container');

  if (invoices.length === 0) {
    container.innerHTML = `
      <div class="empty">
        <div class="empty-icon"><i class="ti ti-file-invoice"></i></div>
        <div class="empty-title">No invoices yet</div>
        <div class="empty-sub">Create your first invoice from the New tab.</div>
      </div>
    `;
    return;
  }

  let html = '<div class="list-card">';
  html += '<div class="list-row list-head"><div>Number</div><div>Customer</div><div>Date</div><div class="num-head">Total</div><div>Status</div><div></div></div>';

  invoices.forEach((invoice) => {
    const invoiceTotals = calcTotals(invoice.items || []);
    const dateStr = invoice.date ? new Date(invoice.date).toISOString().slice(0, 10) : '';
    const snapshotCurrency = invoice.seller_snapshot?.currency || invoice.seller?.currency || seller.currency;
    html += `
      <div class="list-row">
        <div class="list-num">${escapeHTML(invoice.number)}</div>
        <div class="list-customer">${escapeHTML(invoice.customer?.name || '—')}</div>
        <div class="list-date">${escapeHTML(dateStr)}</div>
        <div class="num">${fmt(invoiceTotals.total, snapshotCurrency)}</div>
        <div><span class="pill pill-${invoice.status || 'draft'}">${invoice.status || 'draft'}</span></div>
        <div class="list-actions">
          <button class="icon-btn" data-view-inv="${invoice.id}" aria-label="View"><i class="ti ti-eye"></i></button>
          <a class="icon-btn" href="${api.pdfUrl(invoice.id)}" aria-label="Download PDF" title="Download PDF"><i class="ti ti-file-type-pdf"></i></a>
          <button class="icon-btn" data-edit-inv="${invoice.id}" aria-label="Edit"><i class="ti ti-edit"></i></button>
          <button class="icon-btn danger" data-delete-inv="${invoice.id}" aria-label="Delete"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    `;
  });

  html += '</div>';
  container.innerHTML = html;

  container.querySelectorAll('[data-view-inv]').forEach((button) => {
    button.addEventListener('click', () => viewInvoice(button.dataset.viewInv));
  });
  container.querySelectorAll('[data-edit-inv]').forEach((button) => {
    button.addEventListener('click', () => {
      const invoice = invoices.find((item) => item.id === button.dataset.editInv);
      if (invoice) loadIntoForm(invoice);
    });
  });
  container.querySelectorAll('[data-delete-inv]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Delete this invoice? This cannot be undone.')) return;

      try {
        await api.deleteInvoice(button.dataset.deleteInv);
        invoices = await api.getInvoices();
        renderList();
      } catch (error) {
        alert(`Delete failed: ${error.message}`);
      }
    });
  });
}

function stat(label, value, accent = false) {
  return `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value${accent ? ' accent' : ''}">${value}</div></div>`;
}

function viewInvoice(id) {
  const invoice = invoices.find((item) => item.id === id);
  if (!invoice) return;

  const invoiceTotals = calcTotals(invoice.items || []);
  const invoiceSeller = invoice.seller_snapshot || invoice.seller || seller;
  const invoiceCurrency = invoiceSeller.currency || seller.currency;
  const dateStr = invoice.date ? new Date(invoice.date).toISOString().slice(0, 10) : '';
  const dueStr = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : invoice.due || '';

  const rows = (invoice.items || [])
    .map((item) => {
      const line = (item.qty || 0) * (item.price || 0);
      return `
        <tr>
          <td>${escapeHTML(item.description)}</td>
          <td class="num">${item.qty}</td>
          <td class="num">${fmt(item.price, invoiceCurrency)}</td>
          <td class="num">${item.vat || 0}%</td>
          <td class="num">${fmt(line, invoiceCurrency)}</td>
        </tr>
      `;
    })
    .join('');

  document.getElementById('view-detail').innerHTML = `
    <div class="page-head">
      <div><div class="eyebrow">Invoice</div><h1 class="page-title">${escapeHTML(invoice.number)}</h1></div>
      <div class="page-actions">
        <button class="btn-secondary" id="back-to-list" type="button"><i class="ti ti-arrow-left"></i><span>Back</span></button>
        <button class="btn-secondary" id="print-invoice" type="button"><i class="ti ti-printer"></i><span>Print</span></button>
        <a class="btn-secondary" href="${api.pdfUrl(invoice.id)}"><i class="ti ti-file-type-pdf"></i><span>PDF</span></a>
        <button class="btn-primary" id="edit-invoice" type="button"><i class="ti ti-edit"></i><span>Edit</span></button>
      </div>
    </div>
    <div class="detail-paper">
      <div class="detail-head">
        <div>
          <h2 class="detail-title">Invoice ${escapeHTML(invoice.number)}</h2>
          <div class="detail-meta">Issued ${escapeHTML(dateStr)}${dueStr ? ` · Due ${escapeHTML(dueStr)}` : ''}</div>
        </div>
        <span class="pill pill-${invoice.status || 'draft'}">${invoice.status || 'draft'}</span>
      </div>
      <div class="detail-parties">
        <div>
          <div class="party-label">From</div>
          <div class="party-name">${escapeHTML(invoiceSeller.name || 'Your business')}</div>
          ${invoiceSeller.address ? `<div class="party-line">${escapeHTML(invoiceSeller.address)}</div>` : ''}
          ${invoiceSeller.email ? `<div class="party-line">${escapeHTML(invoiceSeller.email)}</div>` : ''}
          ${invoiceSeller.vat ? `<div class="party-line">VAT ${escapeHTML(invoiceSeller.vat)}</div>` : ''}
        </div>
        <div>
          <div class="party-label">Bill to</div>
          <div class="party-name">${escapeHTML(invoice.customer?.name || '—')}</div>
          ${invoice.customer?.address ? `<div class="party-line">${escapeHTML(invoice.customer.address)}</div>` : ''}
          ${invoice.customer?.email ? `<div class="party-line">${escapeHTML(invoice.customer.email)}</div>` : ''}
        </div>
      </div>
      <table class="detail-table">
        <thead>
          <tr><th>Description</th><th class="num-head">Qty</th><th class="num-head">Unit</th><th class="num-head">VAT</th><th class="num-head">Total</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="detail-totals">
        <div class="detail-totals-inner">
          <div class="detail-totals-row"><span>Subtotal</span><span>${fmt(invoiceTotals.subtotal, invoiceCurrency)}</span></div>
          <div class="detail-totals-row"><span>VAT</span><span>${fmt(invoiceTotals.vat, invoiceCurrency)}</span></div>
          <div class="detail-totals-grand"><span>Total due</span><span>${fmt(invoiceTotals.total, invoiceCurrency)}</span></div>
        </div>
      </div>
      ${invoice.notes ? `<div class="detail-notes"><div class="detail-notes-label">Notes</div>${escapeHTML(invoice.notes)}</div>` : ''}
    </div>
  `;

  showView('detail');
  document.getElementById('back-to-list').addEventListener('click', () => showView('list'));
  document.getElementById('print-invoice').addEventListener('click', () => window.print());
  document.getElementById('edit-invoice').addEventListener('click', () => loadIntoForm(invoice));
}

function loadIntoForm(invoice) {
  editingId = invoice.id;
  document.getElementById('inv-number').value = invoice.number || '';
  document.getElementById('inv-date').value = invoice.date ? new Date(invoice.date).toISOString().slice(0, 10) : '';
  document.getElementById('inv-due').value = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : invoice.due || '';
  document.getElementById('inv-status').value = invoice.status || 'draft';
  document.getElementById('cust-name').value = invoice.customer?.name || '';
  document.getElementById('cust-email').value = invoice.customer?.email || '';
  document.getElementById('cust-address').value = invoice.customer?.address || '';
  document.getElementById('inv-notes').value = invoice.notes || '';
  currentItems = (invoice.items || []).map((item) => ({ ...item }));
  renderItems();
  renderTotals();
  showView('new');
}

function csvEscape(value) {
  const string = String(value ?? '');
  if (/[",\n]/.test(string)) return `"${string.replace(/"/g, '""')}"`;
  return string;
}

function exportCSV() {
  if (invoices.length === 0) {
    alert('No invoices to export yet.');
    return;
  }

  const headers = [
    'invoice_number',
    'date',
    'due_date',
    'status',
    'customer_name',
    'customer_email',
    'customer_address',
    'item_description',
    'item_qty',
    'item_unit_price',
    'item_vat_percent',
    'item_line_total',
    'invoice_subtotal',
    'invoice_vat',
    'invoice_total',
    'seller_name',
    'seller_vat_id',
    'currency',
    'notes'
  ];
  const rows = [headers];

  invoices.forEach((invoice) => {
    const invoiceTotals = calcTotals(invoice.items || []);
    const invoiceSeller = invoice.seller_snapshot || invoice.seller || seller;
    const items = invoice.items?.length ? invoice.items : [{ description: '', qty: '', price: '', vat: '' }];
    const dateStr = invoice.date ? new Date(invoice.date).toISOString().slice(0, 10) : '';
    const dueStr = invoice.due_date ? new Date(invoice.due_date).toISOString().slice(0, 10) : '';

    items.forEach((item) => {
      const line = (item.qty || 0) * (item.price || 0);
      rows.push([
        invoice.number,
        dateStr,
        dueStr,
        invoice.status,
        invoice.customer?.name,
        invoice.customer?.email,
        invoice.customer?.address,
        item.description,
        item.qty,
        item.price,
        item.vat,
        (Math.round(line * 100) / 100).toFixed(2),
        invoiceTotals.subtotal.toFixed(2),
        invoiceTotals.vat.toFixed(2),
        invoiceTotals.total.toFixed(2),
        invoiceSeller.name,
        invoiceSeller.vat,
        invoiceSeller.currency || seller.currency,
        invoice.notes
      ]);
    });
  });

  const csv = rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `invoices_${todayISO()}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

async function saveInvoice() {
  const number = document.getElementById('inv-number').value.trim();
  if (!number) {
    flashStatus('Invoice number is required', 'err');
    return;
  }

  if (currentItems.length === 0) {
    flashStatus('Add at least one line item', 'err');
    return;
  }

  const invoice = {
    id: editingId || `inv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    number,
    date: document.getElementById('inv-date').value || null,
    due_date: document.getElementById('inv-due').value || null,
    status: document.getElementById('inv-status').value,
    customer: {
      name: document.getElementById('cust-name').value,
      email: document.getElementById('cust-email').value,
      address: document.getElementById('cust-address').value
    },
    items: currentItems.map((item) => ({ ...item })),
    notes: document.getElementById('inv-notes').value,
    seller: { ...seller }
  };

  try {
    await api.saveInvoice(invoice);
    invoices = await api.getInvoices();
    flashStatus(editingId ? 'Invoice updated' : 'Invoice saved', 'ok');
    editingId = null;
    resetForm();
  } catch (error) {
    flashStatus(`Save failed: ${error.message}`, 'err');
  }
}

async function saveSeller() {
  seller = {
    name: document.getElementById('seller-name').value,
    address: document.getElementById('seller-address').value,
    vat: document.getElementById('seller-vat').value,
    email: document.getElementById('seller-email').value,
    vatRate: Number.parseFloat(document.getElementById('seller-vat-rate').value) || 0,
    currency: document.getElementById('seller-currency').value || '€'
  };

  try {
    seller = await api.saveSeller(seller);
    document.getElementById('meta-currency').textContent = currencyLabel(seller.currency);
    renderItems();
    renderTotals();
    flashStatus('Saved', 'ok', 'settings-status');
  } catch (error) {
    flashStatus(`Save failed: ${error.message}`, 'err', 'settings-status');
  }
}

function resetForm() {
  document.getElementById('inv-number').value = nextInvoiceNumber();
  document.getElementById('inv-date').value = todayISO();

  const due = new Date();
  due.setDate(due.getDate() + 30);
  document.getElementById('inv-due').value = due.toISOString().slice(0, 10);
  document.getElementById('inv-status').value = 'draft';
  document.getElementById('cust-name').value = '';
  document.getElementById('cust-email').value = '';
  document.getElementById('cust-address').value = '';
  document.getElementById('inv-notes').value = '';

  currentItems = [{ description: '', qty: 1, price: 0, vat: seller.vatRate ?? 21 }];
  editingId = null;
  renderItems();
  renderTotals();
}

async function init() {
  try {
    [seller, invoices] = await Promise.all([api.getSeller(), api.getInvoices()]);
    if (!seller || Object.keys(seller).length === 0) {
      seller = { name: '', address: '', vat: '', email: '', vatRate: 21, currency: '€' };
    }
  } catch (error) {
    console.error(error);
  }

  document.getElementById('seller-name').value = seller.name || '';
  document.getElementById('seller-address').value = seller.address || '';
  document.getElementById('seller-vat').value = seller.vat || '';
  document.getElementById('seller-email').value = seller.email || '';
  document.getElementById('seller-vat-rate').value = seller.vatRate ?? 21;
  document.getElementById('seller-currency').value = seller.currency || '€';
  document.getElementById('meta-currency').textContent = currencyLabel(seller.currency);

  document.querySelectorAll('.nav-tab').forEach((tab) => {
    tab.addEventListener('click', () => showView(tab.dataset.view));
  });
  document.getElementById('save-seller').addEventListener('click', saveSeller);
  document.getElementById('export-csv').addEventListener('click', exportCSV);
  document.getElementById('add-item').addEventListener('click', () => {
    currentItems.push({ description: '', qty: 1, price: 0, vat: seller.vatRate ?? 21 });
    renderItems();
    renderTotals();
  });
  document.getElementById('save-invoice').addEventListener('click', saveInvoice);
  document.getElementById('clear-form').addEventListener('click', resetForm);
  document.getElementById('inv-number').addEventListener('input', () => {
    document.getElementById('summary-number').textContent = document.getElementById('inv-number').value || '—';
  });

  resetForm();
}

async function apiError(response) {
  try {
    const payload = await response.json();
    return payload.error || response.statusText;
  } catch {
    return response.statusText;
  }
}

init();
