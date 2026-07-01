const path = require('path');
const express = require('express');
const cors = require('cors');
const { customAlphabet } = require('nanoid');
const db = require('./db');

db.init();

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const app = express();
app.use(cors());
app.use(express.json());

const INDUSTRIES = [
  { key: 'food', name: '🍗 Food & Beverage' },
  { key: 'manufacturing', name: '🏭 Manufacturing' },
  { key: 'logistics', name: '🚚 Logistics' },
  { key: 'retail', name: '🛍️ Retail' },
  { key: 'construction', name: '🏗️ Construction' },
  { key: 'tech', name: '💻 Technology' }
];

function requireIndustry(req, res, next) {
  const industry = req.query.industry || req.body.industry;
  if (!industry) return res.status(400).json({ error: 'industry is required' });
  req.industry = industry;
  next();
}

// ---- Industries ----
app.get('/api/industries', (req, res) => {
  res.json(INDUSTRIES);
});

// ---- Vendors ----
app.get('/api/vendors', requireIndustry, (req, res) => {
  res.json(db.listVendors(req.industry));
});

app.post('/api/vendors', (req, res) => {
  const { industry, name, type, rating, active } = req.body;
  if (!industry || !name) return res.status(400).json({ error: 'industry and name are required' });
  const id = (req.body.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12) || nanoid());
  try {
    const row = db.insertVendor({ id, industry, name, type, rating, active });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: 'vendor with that id already exists in this industry', detail: e.message });
  }
});

// ---- Operations ----
app.get('/api/operations', requireIndustry, (req, res) => {
  res.json(db.listOperations(req.industry));
});

app.post('/api/operations', (req, res) => {
  const { industry, type, title, vendor, vendor_id, amount, desc, status } = req.body;
  if (!industry || !type || !title || !vendor) {
    return res.status(400).json({ error: 'industry, type, title and vendor are required' });
  }
  const icons = { invoice: '📄', po: '📋', shipment: '🚚', contract: '📑', task: '✓', quote: '💬' };
  const id = `${type}-${nanoid()}`;
  const row = db.insertOperation({
    id, industry, type, title, vendor, vendor_id,
    amount, status, desc, icon: icons[type] || '📄'
  });
  db.logActivity(industry, id, 'created', title);
  res.status(201).json(row);
});

app.patch('/api/operations/:industry/:id', (req, res) => {
  const { industry, id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const existing = db.getOperation(industry, id);
  if (!existing) return res.status(404).json({ error: 'operation not found' });
  const prevStatus = existing.status;

  const row = db.updateOperationStatus(industry, id, status);
  db.logActivity(industry, id, 'status_change', `${prevStatus} -> ${status}`);
  res.json(row);
});

// ---- Messages ----
app.get('/api/messages', requireIndustry, (req, res) => {
  const { vendorId } = req.query;
  if (!vendorId) return res.status(400).json({ error: 'vendorId is required' });
  res.json(db.listMessages(req.industry, vendorId));
});

app.post('/api/messages', (req, res) => {
  const { industry, vendorId, msg, sender, fromName } = req.body;
  if (!industry || !vendorId || !msg) {
    return res.status(400).json({ error: 'industry, vendorId and msg are required' });
  }
  const senderVal = sender === 'vendor' ? 'vendor' : 'you';
  const fromNameVal = fromName || (senderVal === 'you' ? 'You' : vendorId);
  const row = db.insertMessage({ industry, vendor_id: vendorId, sender: senderVal, from_name: fromNameVal, msg });
  res.status(201).json(row);
});

// ---- Documents ----
app.get('/api/documents', requireIndustry, (req, res) => {
  const { vendorId } = req.query;
  res.json(db.listDocuments(req.industry, vendorId));
});

app.post('/api/documents', (req, res) => {
  const { industry, vendorId, name, size } = req.body;
  if (!industry || !vendorId || !name) {
    return res.status(400).json({ error: 'industry, vendorId and name are required' });
  }
  const row = db.insertDocument({ industry, vendor_id: vendorId, name, size });
  res.status(201).json(row);
});

// ---- Dashboard summary ----
app.get('/api/dashboard', requireIndustry, (req, res) => {
  const operations = db.listOperations(req.industry);
  const pending = operations.filter(o => o.status === 'pending');
  const vendors = db.listVendors(req.industry);
  res.json({ pending, recent: operations, vendorCount: vendors.length });
});

// ---- Static frontend ----
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Union Connect MVP running on http://localhost:${PORT}`);
});
