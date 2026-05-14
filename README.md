# Ledger Invoice Studio

Ledger Invoice Studio is a small invoice generation app with saved invoice history. It uses a vanilla HTML/CSS/JS frontend and a Node.js backend that persists invoice history to CSV and seller settings to JSON.

## Project Structure

```text
invoice-studio/
  public/
    index.html      # App shell
    styles.css      # UI styles
    app.js          # Frontend state, forms, views, CSV export
  src/
    server.js       # Static server and API routes
    lib/
      csvInvoiceStore.js # Invoice CSV persistence
      fileStore.js       # Safe JSON file persistence for settings
      invoices.js   # Invoice normalization and totals
      pdfInvoice.js # PDF invoice rendering
  data/             # Local runtime data, generated on first use
  test/
    invoices.test.js
```

## Run Locally

```bash
npm start
```

Open `http://localhost:3000`.

Use another port if needed:

```bash
$env:PORT=3001; npm start
```

## API

- `GET /api/invoices` returns saved invoices.
- `POST /api/invoices` creates or updates an invoice by `id`.
- `DELETE /api/invoice?id=<id>` deletes one invoice.
- `GET /api/invoice/pdf?id=<id>` downloads a customer-ready PDF.
- `GET /api/seller` returns business settings.
- `PUT /api/seller` saves business settings.

## Notes

- Invoice history is stored locally in `data/invoices.csv`.
- Existing `data/invoices.json` history is migrated into CSV the first time the server runs.
- Local `data/*.csv` and `data/*.json` files are ignored by Git because they may contain customer or business details.
- Print support is built into the invoice detail view.
- CSV export is handled in the browser from saved invoices.
