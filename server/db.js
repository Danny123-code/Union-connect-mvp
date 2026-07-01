// Lightweight, dependency-free persistence layer.
//
// Uses a single JSON file on disk instead of a native-compiled database
// (e.g. better-sqlite3 / sqlite3) so `npm install` never depends on
// downloading prebuilt binaries or compiling native code on the deploy
// host. This keeps the MVP trivially deployable anywhere Node runs.
//
// Swap this module out for a real SQL database later without touching
// server/index.js much -- the exported function names double as the
// data-access contract.

const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'union-connect.json');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let data = null;

function emptyData() {
  return { vendors: [], operations: [], messages: [], documents: [], activity_log: [], nextMessageId: 1, nextDocumentId: 1 };
}

function load() {
  if (fs.existsSync(DB_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
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
  if (data.vendors.length === 0) {
    seed();
    persist();
  }
}

function seed() {
  const seedData = require('./seed.json');
  const { industryData, conversations, documents } = seedData;

  for (const [industry, ind] of Object.entries(industryData)) {
    for (const v of ind.vendors) {
      data.vendors.push({ id: v.id, industry, name: v.name, type: v.type, rating: v.rating, active: v.active, created_at: nowIso() });
    }
    for (const op of ind.operations) {
      const vendorMatch = ind.vendors.find(v => v.name === op.vendor);
      data.operations.push({
        id: op.id,
        industry,
        type: op.type,
        title: op.title,
        vendor: op.vendor,
        vendor_id: vendorMatch ? vendorMatch.id : null,
        amount: op.amount,
        status: op.status,
        desc: op.desc,
        icon: op.icon,
        created_at: nowIso(),
        updated_at: nowIso()
      });
    }
  }
  for (const [industry, byVendor] of Object.entries(conversations)) {
    for (const [vendorId, msgs] of Object.entries(byVendor)) {
      for (const m of msgs) {
        data.messages.push({ id: data.nextMessageId++, industry, vendor_id: vendorId, sender: 'vendor', from_name: m.from, msg: m.msg, created_at: nowIso() });
      }
    }
  }
  for (const [industry, byVendor] of Object.entries(documents)) {
    for (const [vendorId, docs] of Object.entries(byVendor)) {
      for (const d of docs) {
        data.documents.push({ id: data.nextDocumentId++, industry, vendor_id: vendorId, name: d.name, size: d.size, created_at: nowIso() });
      }
    }
  }
  console.log('Database seeded with demo data.');
}

// ---------------- Vendors ----------------
function listVendors(industry) {
  return data.vendors.filter(v => v.industry === industry).sort((a, b) => a.name.localeCompare(b.name));
}

function insertVendor({ id, industry, name, type, rating, active }) {
  if (data.vendors.some(v => v.id === id && v.industry === industry)) {
    const err = new Error('vendor with that id already exists in this industry');
    err.code = 'CONFLICT';
    throw err;
  }
  const row = { id, industry, name, type: type || '', rating: rating || 0, active: active || 0, created_at: nowIso() };
  data.vendors.push(row);
  persist();
  return row;
}

// ---------------- Operations ----------------
function listOperations(industry) {
  return data.operations
    .filter(o => o.industry === industry)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
}

function getOperation(industry, id) {
  return data.operations.find(o => o.industry === industry && o.id === id) || null;
}

function insertOperation({ id, industry, type, title, vendor, vendor_id, amount, status, desc, icon }) {
  const row = {
    id, industry, type, title, vendor,
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

function updateOperationStatus(industry, id, status) {
  const op = getOperation(industry, id);
  if (!op) return null;
  op.status = status;
  op.updated_at = nowIso();
  persist();
  return op;
}

// ---------------- Messages ----------------
function listMessages(industry, vendorId) {
  return data.messages
    .filter(m => m.industry === industry && m.vendor_id === vendorId)
    .sort((a, b) => a.id - b.id);
}

function insertMessage({ industry, vendor_id, sender, from_name, msg }) {
  const row = { id: data.nextMessageId++, industry, vendor_id, sender, from_name, msg, created_at: nowIso() };
  data.messages.push(row);
  persist();
  return row;
}

// ---------------- Documents ----------------
function listDocuments(industry, vendorId) {
  const rows = data.documents.filter(d => d.industry === industry && (!vendorId || d.vendor_id === vendorId));
  return rows.sort((a, b) => b.id - a.id);
}

function insertDocument({ industry, vendor_id, name, size }) {
  const row = { id: data.nextDocumentId++, industry, vendor_id, name, size: size || '', created_at: nowIso() };
  data.documents.push(row);
  persist();
  return row;
}

// ---------------- Activity log ----------------
function logActivity(industry, opId, action, detail) {
  data.activity_log.push({ id: data.activity_log.length + 1, industry, op_id: opId, action, detail, created_at: nowIso() });
  persist();
}

module.exports = {
  init,
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
  logActivity
};
