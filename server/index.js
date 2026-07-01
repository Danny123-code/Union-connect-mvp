const path = require('path');
const express = require('express');
const cors = require('cors');
const { customAlphabet } = require('nanoid');
const db = require('./db');
const auth = require('./auth');

db.init();

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const INDUSTRIES = [
  { key: 'food', name: '🍗 Food & Beverage' },
  { key: 'manufacturing', name: '🏭 Manufacturing' },
  { key: 'logistics', name: '🚚 Logistics' },
  { key: 'retail', name: '🛍️ Retail' },
  { key: 'construction', name: '🏗️ Construction' },
  { key: 'tech', name: '💻 Technology' }
];

// ---------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------
function requireAuth(req, res, next) {
  const cookies = auth.parseCookies(req);
  const token = cookies.session;
  if (!token) return res.status(401).json({ error: 'not logged in' });

  const session = db.getSession(token);
  if (!session) return res.status(401).json({ error: 'session expired' });

  const user = db.getUserById(session.user_id);
  const company = db.getCompany(session.company_id);
  if (!user || !company) return res.status(401).json({ error: 'account not found' });

  req.user = user;
  req.company = company;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'admin role required' });
  }
  next();
}

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

// ---------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------
app.get('/api/industries', (req, res) => {
  res.json(INDUSTRIES);
});

app.post('/api/auth/signup', (req, res) => {
  const { companyName, industry, name, email, password } = req.body;
  if (!companyName || !industry || !name || !email || !password) {
    return res.status(400).json({ error: 'companyName, industry, name, email and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (!INDUSTRIES.some(i => i.key === industry)) {
    return res.status(400).json({ error: 'unknown industry' });
  }
  if (db.findUserByEmail(email)) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }

  const companyId = auth.generateId();
  const userId = auth.generateId();

  db.createCompany({ id: companyId, name: companyName, industry });
  db.seedCompanyWorkspace(companyId, industry, () => nanoid());
  const user = db.createUser({
    id: userId,
    company_id: companyId,
    email,
    password_hash: auth.hashPassword(password),
    name,
    role: 'admin' // first user of a new company is its admin
  });

  const token = auth.generateToken();
  db.createSession({
    token,
    user_id: user.id,
    company_id: companyId,
    expires_at: new Date(Date.now() + auth.SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  });
  auth.setSessionCookie(res, token);

  res.status(201).json({ user: publicUser(user), company: db.getCompany(companyId) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.findUserByEmail(email);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const token = auth.generateToken();
  db.createSession({
    token,
    user_id: user.id,
    company_id: user.company_id,
    expires_at: new Date(Date.now() + auth.SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  });
  auth.setSessionCookie(res, token);

  res.json({ user: publicUser(user), company: db.getCompany(user.company_id) });
});

app.post('/api/auth/logout', (req, res) => {
  const cookies = auth.parseCookies(req);
  if (cookies.session) db.deleteSession(cookies.session);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user), company: req.company });
});

// ---------------------------------------------------------------------
// Team management (company-scoped, admin-only to add teammates)
// ---------------------------------------------------------------------
app.get('/api/users', requireAuth, (req, res) => {
  res.json(db.listUsersByCompany(req.company.id));
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (db.findUserByEmail(email)) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }
  const user = db.createUser({
    id: auth.generateId(),
    company_id: req.company.id,
    email,
    password_hash: auth.hashPassword(password),
    name,
    role: role === 'admin' ? 'admin' : 'member'
  });
  res.status(201).json(publicUser(user));
});

// ---------------------------------------------------------------------
// Vendors (company-scoped)
// ---------------------------------------------------------------------
app.get('/api/vendors', requireAuth, (req, res) => {
  res.json(db.listVendors(req.company.id));
});

app.post('/api/vendors', requireAuth, (req, res) => {
  const { name, type, rating, active } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const id = (req.body.id || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 12) || nanoid()) + '-' + nanoid().slice(0, 4);
  try {
    const row = db.insertVendor({ id, company_id: req.company.id, name, type, rating, active });
    res.status(201).json(row);
  } catch (e) {
    res.status(409).json({ error: 'vendor with that id already exists', detail: e.message });
  }
});

// ---------------------------------------------------------------------
// Operations (company-scoped; approving/rejecting requires admin)
// ---------------------------------------------------------------------
app.get('/api/operations', requireAuth, (req, res) => {
  res.json(db.listOperations(req.company.id));
});

app.post('/api/operations', requireAuth, (req, res) => {
  const { type, title, vendor, vendor_id, amount, desc, status } = req.body;
  if (!type || !title || !vendor) {
    return res.status(400).json({ error: 'type, title and vendor are required' });
  }
  const icons = { invoice: '📄', po: '📋', shipment: '🚚', contract: '📑', task: '✓', quote: '💬' };
  const id = `${type}-${nanoid()}`;
  const row = db.insertOperation({
    id, company_id: req.company.id, type, title, vendor, vendor_id,
    amount, status, desc, icon: icons[type] || '📄'
  });
  db.logActivity(req.company.id, id, 'created', title);
  res.status(201).json(row);
});

app.patch('/api/operations/:id', requireAuth, (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });

  const existing = db.getOperation(req.company.id, id);
  if (!existing) return res.status(404).json({ error: 'operation not found' });

  if (status === 'approved' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'only an admin can approve operations' });
  }

  const prevStatus = existing.status;
  const row = db.updateOperationStatus(req.company.id, id, status);
  db.logActivity(req.company.id, id, 'status_change', `${prevStatus} -> ${status} (by ${req.user.name})`);
  res.json(row);
});

// ---------------------------------------------------------------------
// Messages (company-scoped)
// ---------------------------------------------------------------------
app.get('/api/messages', requireAuth, (req, res) => {
  const { vendorId } = req.query;
  if (!vendorId) return res.status(400).json({ error: 'vendorId is required' });
  res.json(db.listMessages(req.company.id, vendorId));
});

app.post('/api/messages', requireAuth, (req, res) => {
  const { vendorId, msg, sender } = req.body;
  if (!vendorId || !msg) {
    return res.status(400).json({ error: 'vendorId and msg are required' });
  }
  const senderVal = sender === 'vendor' ? 'vendor' : 'you';
  const fromNameVal = senderVal === 'you' ? req.user.name : vendorId;
  const row = db.insertMessage({ company_id: req.company.id, vendor_id: vendorId, sender: senderVal, from_name: fromNameVal, msg });
  res.status(201).json(row);
});

// ---------------------------------------------------------------------
// Documents (company-scoped)
// ---------------------------------------------------------------------
app.get('/api/documents', requireAuth, (req, res) => {
  const { vendorId } = req.query;
  res.json(db.listDocuments(req.company.id, vendorId));
});

app.post('/api/documents', requireAuth, (req, res) => {
  const { vendorId, name, size } = req.body;
  if (!vendorId || !name) {
    return res.status(400).json({ error: 'vendorId and name are required' });
  }
  const row = db.insertDocument({ company_id: req.company.id, vendor_id: vendorId, name, size });
  res.status(201).json(row);
});

// ---------------------------------------------------------------------
// Dashboard + activity (company-scoped)
// ---------------------------------------------------------------------
app.get('/api/dashboard', requireAuth, (req, res) => {
  const operations = db.listOperations(req.company.id);
  const pending = operations.filter(o => o.status === 'pending');
  const vendors = db.listVendors(req.company.id);
  res.json({ pending, recent: operations, vendorCount: vendors.length });
});

app.get('/api/activity', requireAuth, (req, res) => {
  res.json(db.listActivity(req.company.id));
});

// ---------------------------------------------------------------------
// Static frontend
// ---------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Union Connect running on http://localhost:${PORT}`);
});
