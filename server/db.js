// Lightweight, dependency-free persistence layer.
//
// Uses a single JSON file on disk instead of a native-compiled database
// (e.g. better-sqlite3 / sqlite3) so `npm install` never depends on
// downloading prebuilt binaries or compiling native code on the deploy
// host. This keeps the app trivially deployable anywhere Node runs.
//
// Multi-tenant model: every company that signs up gets its own private
// set of vendors/operations/messages/documents, scoped by company_id.
// The six "industries" from the original demo are kept only as seed
// templates used to populate a brand-new company's workspace at signup.

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'union-connect.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let data = null;

function emptyData() {
  return {
    companies: [],
    users: [],
    sessions: [],
    vendors: [],
    operations: [],
    messages: [],
    documents: [],
    activity_log: [],
    nextMessageId: 1,
    nextDocumentId: 1,
    nextActivityId: 1
  };
}

function load() {
  if (fs.existsSync(DB_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
      // backfill fields for DBs created before auth existed
      if (!data.companies) data.companies = [];
      if (!data.users) data.users = [];
      if (!data.sessions) data.sessions = [];
      if (!data.nextActivityId) data.nextActivityId = (data.activity_log ? data.activity_log.length : 0) + 1;
      return;
    } catch (e) {
      console.error('Failed to parse DB file, reinitializing:', e.message);
    }
  }
  data = emptyData();
}

function persist() {
  // Write to a temp file then rename, so a crash mid-write can't corrupt the DB.
  const tmp = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_PATH);
}

function nowIso() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function init() {
  load();
}

// ---------------- Seed templates (used only at company signup) ----------------
function getSeedTemplates() {
  return require('./seed.json');
}

function seedCompanyWorkspace(companyId, industry, idFactory) {
  const seedData = getSeedTemplates();
  const template = seedData.industryData[industry];
  if (!template) return;
  const conversations = seedData.conversations[industry] || {};
  const documents = seedData.documents[industry] || {};

  // Map template vendor ids -> freshly generated ids scoped to this company,
  // so different companies never collide on the same vendor/operation ids.
  const vendorIdMap = {};

  for (const v of template.vendors) {
    const newId = idFactory();
    vendorIdMap[v.id] = newId;
    data.vendors.push({
      id: newId,
      company_id: companyId,
      name: v.name,
      type: v.type,
      rating: v.rating,
      active: v.active,
      created_at: nowIso()
    });
  }

  for (const op of template.operations) {
    const vendorMatch = template.vendors.find(v => v.name === op.vendor);
    data.operations.unshift({
      id: `${op.type}-${idFactory()}`,
      company_id: companyId,
      type: op.type,
      title: op.title,
      vendor: op.vendor,
      vendor_id: vendorMatch ? vendorIdMap[vendorMatch.id] : null,
      amount: op.amount,
      status: op.status,
      desc: op.desc,
      icon: op.icon,
      created_at: nowIso(),
      updated_at: nowIso()
    });
  }

  for (const [templateVendorId, msgs] of Object.entries(conversations)) {
    const newVendorId = vendorIdMap[templateVendorId];
    if (!newVendorId) continue;
    for (const m of msgs) {
      data.messages.push({
        id: data.nextMessageId++,
        company_id: companyId,
        vendor_id: newVendorId,
        sender: 'vendor',
        from_name: m.from,
        msg: m.msg,
        created_at: nowIso()
      });
    }
  }

  for (const [templateVendorId, docs] of Object.entries(documents)) {
    const newVendorId = vendorIdMap[templateVendorId];
    if (!newVendorId) continue;
    for (const d of docs) {
      data.documents.push({
        id: data.nextDocumentId++,
        company_id: companyId,
        vendor_id: newVendorId,
        name: d.name,
        size: d.size,
        created_at: nowIso()
      });
    }
  }
}

// ---------------- Companies ----------------
function createCompany({ id, name, industry }) {
  const row = { id, name, industry, created_at: nowIso() };
  data.companies.push(row);
  persist();
  return row;
}

function getCompany(id) {
  return data.companies.find(c => c.id === id) || null;
}

// ---------------- Users ----------------
function createUser({ id, company_id, email, password_hash, name, role }) {
  const row = {
    id, company_id,
    email: email.toLowerCase(),
    password_hash,
    name,
    role: role || 'member',
    created_at: nowIso()
  };
  data.users.push(row);
  persist();
  return row;
}

function findUserByEmail(email) {
  return data.users.find(u => u.email === email.toLowerCase()) || null;
}

function getUserById(id) {
  return data.users.find(u => u.id === id) || null;
}

function listUsersByCompany(companyId) {
  return data.users
    .filter(u => u.company_id === companyId)
    .map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, created_at: u.created_at }));
}

// ---------------- Sessions ----------------
function createSession({ token, user_id, company_id, expires_at }) {
  const row = { token, user_id, company_id, expires_at, created_at: nowIso() };
  data.sessions.push(row);
  persist();
  return row;
}

function getSession(token) {
  const session = data.sessions.find(s => s.token === token);
  if (!session) return null;
  if (new Date(session.expires_at).getTime() < Date.now()) {
    return null;
  }
  return session;
}

function deleteSession(token) {
  const before = data.sessions.length;
  data.sessions = data.sessions.filter(s => s.token !== token);
  if (data.sessions.length !== before) persist();
}

// ---------------- Vendors ----------------
function listVendors(companyId) {
  return data.vendors.filter(v => v.company_id === companyId).sort((a, b) => a.name.localeCompare(b.name));
}

function insertVendor({ id, company_id, name, type, rating, active }) {
  if (data.vendors.some(v => v.id === id && v.company_id === company_id)) {
    const err = new Error('vendor with that id already exists');
    err.code = 'CONFLICT';
    throw err;
  }
  const row = { id, company_id, name, type: type || '', rating: rating || 0, active: active || 0, created_at: nowIso() };
  data.vendors.push(row);
  persist();
  return row;
}

// ---------------- Operations ----------------
function listOperations(companyId) {
  return data.operations
    .filter(o => o.company_id === companyId)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function getOperation(companyId, id) {
  return data.operations.find(o => o.company_id === companyId && o.id === id) || null;
}

function insertOperation({ id, company_id, type, title, vendor, vendor_id, amount, status, desc, icon }) {
  const row = {
    id, company_id, type, title, vendor,
    vendor_id: vendor_id || null,
    amount: amount || '',
    status: status || 'pending',
    desc: desc || '',
    icon: icon || '',
    created_at: nowIso(),
    updated_at: nowIso()
  };
  data.operations.unshift(row);
  persist();
  return row;
}

function updateOperationStatus(companyId, id, status) {
  const op = getOperation(companyId, id);
  if (!op) return null;
  op.status = status;
  op.updated_at = nowIso();
  persist();
  return op;
}

// ---------------- Messages ----------------
function listMessages(companyId, vendorId) {
  return data.messages
    .filter(m => m.company_id === companyId && m.vendor_id === vendorId)
    .sort((a, b) => a.id - b.id);
}

function insertMessage({ company_id, vendor_id, sender, from_name, msg }) {
  const row = { id: data.nextMessageId++, company_id, vendor_id, sender, from_name, msg, created_at: nowIso() };
  data.messages.push(row);
  persist();
  return row;
}

// ---------------- Documents ----------------
function listDocuments(companyId, vendorId) {
  const rows = data.documents.filter(d => d.company_id === companyId && (!vendorId || d.vendor_id === vendorId));
  return rows.sort((a, b) => b.id - a.id);
}

function insertDocument({ company_id, vendor_id, name, size }) {
  const row = { id: data.nextDocumentId++, company_id, vendor_id, name, size: size || '', created_at: nowIso() };
  data.documents.push(row);
  persist();
  return row;
}

// ---------------- Activity log ----------------
function logActivity(companyId, opId, action, detail) {
  data.activity_log.push({ id: data.nextActivityId++, company_id: companyId, op_id: opId, action, detail, created_at: nowIso() });
  persist();
}

function listActivity(companyId) {
  return data.activity_log
    .filter(a => a.company_id === companyId)
    .sort((a, b) => b.id - a.id);
}

module.exports = {
  init,
  seedCompanyWorkspace,
  createCompany,
  getCompany,
  createUser,
  findUserByEmail,
  getUserById,
  listUsersByCompany,
  createSession,
  getSession,
  deleteSession,
  listVendors,
  insertVendor,
  listOperations,
  getOperation,
  insertOperation,
  updateOperationStatus,
  listMessages,
  insertMessage,
  listDocuments,
  insertDocument,
  logActivity,
  listActivity
};
