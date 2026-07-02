const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { customAlphabet } = require('nanoid');
const db = require('./db');
const auth = require('./auth');
const email = require('./email');

db.init();

const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8);

const app = express();
app.set('trust proxy', 1); // needed so req.ip is the real client IP behind Railway/Render's proxy
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const INDUSTRIES = [
  { key: 'food', name: 'Food & Beverage' },
  { key: 'manufacturing', name: 'Manufacturing' },
  { key: 'logistics', name: 'Logistics & Transportation' },
  { key: 'retail', name: 'Retail' },
  { key: 'construction', name: 'Construction' },
  { key: 'tech', name: 'Technology' },
  { key: 'healthcare', name: 'Healthcare' },
  { key: 'hospitality', name: 'Hospitality & Food Service' },
  { key: 'professional-services', name: 'Professional Services' },
  { key: 'real-estate', name: 'Real Estate' },
  { key: 'agriculture', name: 'Agriculture' },
  { key: 'education', name: 'Education' },
  { key: 'energy', name: 'Energy & Utilities' },
  { key: 'finance', name: 'Financial Services' },
  { key: 'nonprofit', name: 'Nonprofit' },
  { key: 'automotive', name: 'Automotive' },
  { key: 'other', name: 'Other' }
];

// ---------------------------------------------------------------------
// Rate limiting (in-memory, per-IP, no new dependency)
// ---------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 10; // 10 attempts per window per IP
const rateLimitStore = new Map();

function rateLimit(req, res, next) {
  const ip = req.ip || (req.connection && req.connection.remoteAddress) || 'unknown';
  const now = Date.now();
  let entry = rateLimitStore.get(ip);
  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    rateLimitStore.set(ip, entry);
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryMinutes = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)) / 60000);
    return res.status(429).json({ error: `Too many attempts. Please try again in about ${retryMinutes} minute${retryMinutes === 1 ? '' : 's'}.` });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) rateLimitStore.delete(ip);
  }
}, RATE_LIMIT_WINDOW_MS).unref();

// ---------------------------------------------------------------------
// File uploads (multer, disk storage on the same volume as the DB)
// ---------------------------------------------------------------------
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'union-connect.json')), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, req.company.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100);
    cb(null, `${Date.now()}-${nanoid()}-${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } }); // 20MB per file

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

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
// Config (support contact, etc.)
// ---------------------------------------------------------------------
app.get('/api/config', (req, res) => {
  res.json({ supportEmail: email.SUPPORT_EMAIL });
});

// ---------------------------------------------------------------------
// Auth routes
// ---------------------------------------------------------------------
app.get('/api/industries', (req, res) => {
  res.json(INDUSTRIES);
});

app.post('/api/auth/signup', rateLimit, (req, res) => {
  const { companyName, industry, name, email: emailAddr, password } = req.body;
  if (!companyName || !industry || !name || !emailAddr || !password) {
    return res.status(400).json({ error: 'companyName, industry, name, email and password are all required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (!INDUSTRIES.some(i => i.key === industry)) {
    return res.status(400).json({ error: 'unknown industry' });
  }
  if (db.findUserByEmail(emailAddr)) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }

  const companyId = auth.generateId();
  const userId = auth.generateId();

  db.createCompany({ id: companyId, name: companyName, industry });
  db.seedCompanyWorkspace(companyId, industry, () => nanoid());
  const user = db.createUser({
    id: userId,
    company_id: companyId,
    email: emailAddr,
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

  // Fire-and-forget: don't make signup wait on an external email API.
  email.sendEmail({
    to: user.email,
    subject: `Welcome to Union Connect, ${user.name}`,
    html: email.welcomeEmail({ name: user.name, companyName })
  }).catch(e => console.error('welcome email failed:', e.message));

  res.status(201).json({ user: publicUser(user), company: db.getCompany(companyId) });
});

app.post('/api/auth/login', rateLimit, (req, res) => {
  const { email: emailAddr, password } = req.body;
  if (!emailAddr || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.findUserByEmail(emailAddr);
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

app.post('/api/auth/forgot-password', rateLimit, (req, res) => {
  const { email: emailAddr } = req.body;
  if (!emailAddr) return res.status(400).json({ error: 'email is required' });

  const user = db.findUserByEmail(emailAddr);
  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to check which emails have accounts.
  if (user) {
    const token = auth.generateToken();
    db.createPasswordReset({
      token,
      user_id: user.id,
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() // 1 hour
    });
    const origin = `${req.protocol}://${req.get('host')}`;
    const resetUrl = `${origin}/?resetToken=${token}`;
    if (!process.env.RESEND_API_KEY) {
      console.log(`[password reset link - no RESEND_API_KEY set] ${resetUrl}`);
    }
    email.sendEmail({
      to: user.email,
      subject: 'Reset your Union Connect password',
      html: email.resetEmail({ name: user.name, resetUrl })
    }).catch(e => console.error('reset email failed:', e.message));
  }
  res.json({ ok: true, message: 'If that email has an account, a reset link has been sent.' });
});

app.post('/api/auth/reset-password', rateLimit, (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password are required' });
  if (password.length < 8) return res.status(400).json({ error: 'password must be at least 8 characters' });

  const reset = db.getPasswordReset(token);
  if (!reset) return res.status(400).json({ error: 'this reset link is invalid or has expired' });

  db.updateUserPassword(reset.user_id, auth.hashPassword(password));
  db.deletePasswordReset(token);
  db.deleteSessionsForUser(reset.user_id); // log out everywhere for safety
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Team management (company-scoped, admin-only to add teammates)
// ---------------------------------------------------------------------
app.get('/api/users', requireAuth, (req, res) => {
  res.json(db.listUsersByCompany(req.company.id));
});

app.post('/api/users', requireAuth, requireAdmin, (req, res) => {
  const { name, email: emailAddr, password, role } = req.body;
  if (!name || !emailAddr || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'password must be at least 8 characters' });
  }
  if (db.findUserByEmail(emailAddr)) {
    return res.status(409).json({ error: 'an account with that email already exists' });
  }
  const user = db.createUser({
    id: auth.generateId(),
    company_id: req.company.id,
    email: emailAddr,
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

// Metadata-only creation, kept for backwards compatibility.
app.post('/api/documents', requireAuth, (req, res) => {
  const { vendorId, name, size } = req.body;
  if (!vendorId || !name) {
    return res.status(400).json({ error: 'vendorId and name are required' });
  }
  const row = db.insertDocument({ company_id: req.company.id, vendor_id: vendorId, name, size });
  res.status(201).json(row);
});

// Real file upload — multipart/form-data with fields "file" and "vendorId".
app.post('/api/documents/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  const { vendorId } = req.body;
  if (!vendorId) return res.status(400).json({ error: 'vendorId is required' });

  const row = db.insertDocument({
    company_id: req.company.id,
    vendor_id: vendorId,
    name: req.file.originalname,
    size: formatBytes(req.file.size),
    file_path: path.relative(UPLOAD_DIR, req.file.path),
    mime_type: req.file.mimetype
  });
  res.status(201).json(row);
});

app.get('/api/documents/:id/download', requireAuth, (req, res) => {
  const doc = db.getDocument(req.company.id, req.params.id);
  if (!doc) return res.status(404).json({ error: 'document not found' });
  if (!doc.file_path) return res.status(404).json({ error: 'this document has no uploaded file' });

  const fullPath = path.join(UPLOAD_DIR, doc.file_path);
  if (!fullPath.startsWith(UPLOAD_DIR)) return res.status(400).json({ error: 'invalid path' });
  if (!fs.existsSync(fullPath)) return res.status(404).json({ error: 'file no longer exists on disk' });

  res.download(fullPath, doc.name);
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

// ---------------------------------------------------------------------
// Error handler (must be last) — catches multer errors (file too large, etc.)
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.message });
  }
  if (err) {
    console.error(err);
    return res.status(500).json({ error: 'server error' });
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Union Connect running on http://localhost:${PORT}`);
});
