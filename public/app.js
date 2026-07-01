const API = '/api';

const state = {
  industry: 'food',
  industries: [],
  vendors: [],
  operations: [],
  currentConversationVendor: null,
  messagesCache: {}, // vendorId -> messages[]
  documents: {},      // vendorId -> documents[]
  currentModalOp: null
};

// ---------- API helpers ----------
async function apiGet(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}

async function apiPatch(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status}`);
  return res.json();
}

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Data loading ----------
async function loadIndustryData() {
  const [vendors, operations] = await Promise.all([
    apiGet(`/vendors?industry=${state.industry}`),
    apiGet(`/operations?industry=${state.industry}`)
  ]);
  state.vendors = vendors;
  state.operations = operations;
  state.messagesCache = {};
  state.documents = {};
}

async function switchIndustry(industry) {
  state.industry = industry;
  state.currentConversationVendor = null;
  await loadIndustryData();
  renderSidebar();
  renderDashboard();
  renderVendors();
  renderOperations();
  renderPanel();
  renderConversationList();
  document.getElementById('chatVendorName').textContent = 'Select a conversation';
  document.getElementById('chatMessages').innerHTML = '';
}

function switchTab(tab) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  event.currentTarget.classList.add('active');

  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));

  if (tab === 'dashboard') {
    document.getElementById('dashboardView').classList.add('active');
    document.getElementById('headerTitle').textContent = 'Operations Dashboard';
    document.getElementById('headerSubtitle').textContent = 'Real-time visibility into vendor operations';
    renderDashboard();
    renderPanel();
  } else if (tab === 'vendors') {
    document.getElementById('vendorsView').classList.add('active');
    document.getElementById('headerTitle').textContent = 'Vendor Management';
    document.getElementById('headerSubtitle').textContent = `${industryLabel()} Vendors`;
    renderVendors();
    renderPanel();
  } else if (tab === 'operations') {
    document.getElementById('operationsView').classList.add('active');
    document.getElementById('headerTitle').textContent = 'All Operations';
    document.getElementById('headerSubtitle').textContent = 'Complete operational history';
    renderOperations();
    renderPanel();
  } else if (tab === 'messaging') {
    document.getElementById('messagingView').classList.add('active');
    document.getElementById('headerTitle').textContent = 'Messaging';
    document.getElementById('headerSubtitle').textContent = 'Vendor communication hub';
    renderConversationList();
    renderPanel();
  }
}

function industryLabel() {
  const found = state.industries.find(i => i.key === state.industry);
  return found ? found.name : state.industry;
}

function initials(id) {
  return (id || '').toUpperCase().substring(0, 2);
}

// ---------- Rendering ----------
function renderSidebar() {
  const html = state.vendors.map(v => `
    <div class="list-item">
      <div class="list-item-avatar">${initials(v.id)}</div>
      <div class="list-item-info">
        <div class="list-item-name">${v.name}</div>
        <div class="list-item-meta">${v.type}</div>
      </div>
      ${v.active > 0 ? `<div class="badge">${v.active}</div>` : ''}
    </div>
  `).join('');
  document.getElementById('vendorsList').innerHTML = html || `<div class="empty-state">No vendors yet</div>`;
}

function renderDashboard() {
  const pending = state.operations.filter(op => op.status === 'pending');
  const recent = [...state.operations].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  document.getElementById('pendingApprovals').innerHTML =
    pending.length ? pending.map(op => createActivityItem(op)).join('') : `<div class="empty-state">No pending approvals</div>`;
  document.getElementById('recentActivity').innerHTML =
    recent.length ? recent.map(op => createActivityItem(op)).join('') : `<div class="empty-state">No activity yet</div>`;
}

function renderVendors() {
  const html = state.vendors.map(v => `
    <div class="vendor-card">
      <div class="vendor-header">
        <div class="vendor-avatar">${initials(v.id)}</div>
        <div class="vendor-info">
          <h3>${v.name}</h3>
          <p>${v.type}</p>
        </div>
      </div>
      <div class="vendor-stats">
        <div class="vendor-stat">
          <div class="vendor-stat-label">Rating</div>
          <div class="vendor-stat-value">${v.rating}⭐</div>
        </div>
        <div class="vendor-stat">
          <div class="vendor-stat-label">Active Orders</div>
          <div class="vendor-stat-value">${v.active}</div>
        </div>
      </div>
      <div class="vendor-actions">
        <button class="vendor-btn" onclick="switchTab('messaging'); document.querySelector('.nav-item:nth-child(4)').classList.add('active'); openConversation('${v.id}', '${escapeHtml(v.name)}')">Message</button>
        <button class="vendor-btn" onclick="alert('${escapeHtml(v.name)}\\n${escapeHtml(v.type)}\\nRating: ${v.rating}\\nActive orders: ${v.active}')">Details</button>
      </div>
    </div>
  `).join('');
  document.getElementById('vendorsGrid').innerHTML = html || `<div class="empty-state">No vendors yet. Click "New Vendor" to add one.</div>`;
}

function renderOperations() {
  document.getElementById('allOperations').innerHTML =
    state.operations.length ? state.operations.map(op => createActivityItem(op)).join('') : `<div class="empty-state">No operations yet</div>`;
}

function renderConversationList() {
  const search = (document.getElementById('conversationSearch')?.value || '').toLowerCase();
  let html = '';
  state.vendors
    .filter(v => v.name.toLowerCase().includes(search))
    .forEach(vendor => {
      const cached = state.messagesCache[vendor.id];
      const lastMsg = cached && cached.length ? cached[cached.length - 1].msg : 'No messages yet';
      html += `
        <div class="conversation-list-item ${state.currentConversationVendor === vendor.id ? 'active' : ''}" onclick="openConversation('${vendor.id}', '${escapeHtml(vendor.name)}')">
          <div class="conversation-avatar-small">${initials(vendor.id)}</div>
          <div class="conversation-preview-info">
            <div class="conversation-name-small">${vendor.name}</div>
            <div class="conversation-preview-text">${escapeHtml(lastMsg)}</div>
          </div>
        </div>
      `;
    });
  document.getElementById('conversationListItems').innerHTML = html || `<div class="empty-state">No vendors yet</div>`;
}

async function openConversation(vendorId, vendorName) {
  state.currentConversationVendor = vendorId;
  document.getElementById('chatVendorName').textContent = vendorName;

  if (!state.messagesCache[vendorId]) {
    state.messagesCache[vendorId] = await apiGet(`/messages?industry=${state.industry}&vendorId=${vendorId}`);
  }
  renderChat(vendorId);
  renderConversationList();
}

function renderChat(vendorId) {
  const msgs = state.messagesCache[vendorId] || [];
  let chatHtml = msgs.map(m => `
    <div class="message-group ${m.sender === 'you' ? 'you' : ''}">
      ${m.sender === 'you' ? '' : `<div class="message-avatar">${initials(vendorId)}</div>`}
      <div class="message-content-wrapper">
        <div class="message-header">
          <div class="message-sender">${escapeHtml(m.from_name)}</div>
          <div class="message-time">${formatTime(m.created_at)}</div>
        </div>
        <div class="message-bubble">${escapeHtml(m.msg)}</div>
      </div>
    </div>
  `).join('');
  document.getElementById('chatMessages').innerHTML = chatHtml || `<div class="empty-state">No messages yet. Say hello!</div>`;
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const msg = input.value.trim();
  if (!msg || !state.currentConversationVendor) return;

  const vendorId = state.currentConversationVendor;
  const saved = await apiPost('/messages', {
    industry: state.industry,
    vendorId,
    msg,
    sender: 'you',
    fromName: 'You'
  });
  state.messagesCache[vendorId] = state.messagesCache[vendorId] || [];
  state.messagesCache[vendorId].push(saved);
  input.value = '';
  renderChat(vendorId);
  renderConversationList();
}

async function renderPanel() {
  let html = '';
  for (const vendor of state.vendors) {
    if (!state.messagesCache[vendor.id]) {
      state.messagesCache[vendor.id] = await apiGet(`/messages?industry=${state.industry}&vendorId=${vendor.id}`);
    }
    if (!state.documents[vendor.id]) {
      state.documents[vendor.id] = await apiGet(`/documents?industry=${state.industry}&vendorId=${vendor.id}`);
    }
    const convList = state.messagesCache[vendor.id] || [];
    const docList = state.documents[vendor.id] || [];

    html += `
      <div style="margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 12px;">${vendor.name}</div>

        ${convList.length > 0 ? `
          <div style="margin-bottom: 12px;">
            ${convList.slice(-2).map(c => `
              <div class="conversation-item" onclick="switchTab('messaging'); document.querySelector('.nav-item:nth-child(4)').classList.add('active'); openConversation('${vendor.id}', '${escapeHtml(vendor.name)}')">
                <div class="avatar">${initials(vendor.id)}</div>
                <div class="conversation-info">
                  <div class="conversation-name" style="font-size: 12px;">${escapeHtml(c.from_name)}</div>
                  <div class="conversation-preview">${escapeHtml(c.msg)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        ${docList.length > 0 ? `
          <div>
            ${docList.slice(0, 2).map(doc => `
              <div class="doc-item">
                <div class="doc-icon"><i class="ti ti-file"></i></div>
                <div class="doc-info">
                  <div class="doc-name">${escapeHtml(doc.name)}</div>
                  <div class="doc-meta">${doc.size || ''} • ${formatTime(doc.created_at)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;">
      </div>
    `;
  }

  document.getElementById('panelContent').innerHTML = html || `<div class="empty-state">No vendors yet</div>`;
  document.getElementById('panelTitle').textContent = `Connected Vendors (${state.vendors.length})`;
}

function createActivityItem(op) {
  const icons = {
    invoice: 'ti-receipt-2',
    po: 'ti-file-text',
    shipment: 'ti-truck',
    contract: 'ti-document',
    task: 'ti-checkbox',
    quote: 'ti-message-circle'
  };

  const statusClass = `status-${op.status}`;
  const actionBtn = op.status === 'pending'
    ? `<button class="action-btn primary" onclick="event.stopPropagation(); quickApprove('${op.id}')">Approve</button>`
    : '';

  return `
    <div class="activity-item" onclick="openModal('${op.id}')">
      <div class="activity-header">
        <div class="activity-icon ${op.type}"><i class="ti ${icons[op.type] || 'ti-file'}"></i></div>
        <div class="activity-content">
          <div class="activity-title">${escapeHtml(op.title)}</div>
          <div class="activity-subtitle">${escapeHtml(op.vendor)} • ${escapeHtml(op.amount || '')}</div>
        </div>
        <div class="activity-status">
          <span class="status-badge ${statusClass}">${op.status.charAt(0).toUpperCase() + op.status.slice(1)}</span>
          ${actionBtn}
        </div>
      </div>
      <div style="font-size: 12px; color: var(--text-tertiary);">${escapeHtml(op.desc || '')}</div>
    </div>
  `;
}

async function quickApprove(opId) {
  await updateOperationStatus(opId, 'approved');
  showToast('Approved');
}

async function updateOperationStatus(opId, status) {
  const updated = await apiPatch(`/operations/${state.industry}/${opId}`, { status });
  const idx = state.operations.findIndex(o => o.id === opId);
  if (idx !== -1) state.operations[idx] = updated;
  renderDashboard();
  renderOperations();
  return updated;
}

function openModal(opId) {
  const op = state.operations.find(o => o.id === opId);
  if (!op) return;

  state.currentModalOp = op;

  document.getElementById('modalTitle').textContent = op.title;
  document.getElementById('modalSubtitle').textContent = op.vendor;

  const fieldsHtml = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px;">
      <div class="obj-field">
        <div class="obj-label">Amount/Value</div>
        <div class="obj-value">${escapeHtml(op.amount || '')}</div>
      </div>
      <div class="obj-field">
        <div class="obj-label">Status</div>
        <div class="obj-value"><span style="background: rgba(26, 26, 26, 0.1); color: #1A1A1A; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 600;">${op.status.charAt(0).toUpperCase() + op.status.slice(1)}</span></div>
      </div>
      <div class="obj-field">
        <div class="obj-label">Type</div>
        <div class="obj-value">${op.type.charAt(0).toUpperCase() + op.type.slice(1)}</div>
      </div>
      <div class="obj-field">
        <div class="obj-label">Vendor</div>
        <div class="obj-value">${escapeHtml(op.vendor)}</div>
      </div>
      <div class="obj-field" style="grid-column: 1 / -1;">
        <div class="obj-label">Description</div>
        <div class="obj-value">${escapeHtml(op.desc || '')}</div>
      </div>
      <div class="obj-field">
        <div class="obj-label">Created</div>
        <div class="obj-value">${formatTime(op.created_at)}</div>
      </div>
      <div class="obj-field">
        <div class="obj-label">Last Updated</div>
        <div class="obj-value">${formatTime(op.updated_at)}</div>
      </div>
    </div>
  `;

  document.getElementById('modalBody').innerHTML = fieldsHtml;
  document.getElementById('modalAction').textContent = op.status === 'pending' ? 'Approve & Proceed' : 'Mark Complete';
  document.getElementById('modalAction').style.display = (op.status === 'completed') ? 'none' : '';
  document.getElementById('detailModal').classList.add('active');
}

function closeModal() {
  document.getElementById('detailModal').classList.remove('active');
}

async function performAction() {
  if (!state.currentModalOp) return;
  const op = state.currentModalOp;
  const nextStatus = op.status === 'pending' ? 'approved' : 'completed';
  await updateOperationStatus(op.id, nextStatus);
  showToast(`${op.title} marked ${nextStatus}`);
  closeModal();
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('detailModal').addEventListener('click', (e) => {
    if (e.target.id === 'detailModal') closeModal();
  });
  document.getElementById('newOpModal').addEventListener('click', (e) => {
    if (e.target.id === 'newOpModal') closeNewOpModal();
  });
  document.getElementById('newVendorModal').addEventListener('click', (e) => {
    if (e.target.id === 'newVendorModal') closeNewVendorModal();
  });
});

// ---------- New Operation ----------
function openNewOperationModal() {
  const select = document.getElementById('newOpVendor');
  select.innerHTML = state.vendors.map(v => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('');
  document.getElementById('newOpTitle').value = '';
  document.getElementById('newOpAmount').value = '';
  document.getElementById('newOpDesc').value = '';
  document.getElementById('newOpModal').classList.add('active');
}

function closeNewOpModal() {
  document.getElementById('newOpModal').classList.remove('active');
}

async function submitNewOperation() {
  const type = document.getElementById('newOpType').value;
  const vendorId = document.getElementById('newOpVendor').value;
  const vendor = state.vendors.find(v => v.id === vendorId);
  const title = document.getElementById('newOpTitle').value.trim();
  const amount = document.getElementById('newOpAmount').value.trim();
  const desc = document.getElementById('newOpDesc').value.trim();

  if (!vendor || !title) {
    showToast('Vendor and title are required');
    return;
  }

  const created = await apiPost('/operations', {
    industry: state.industry,
    type,
    title,
    vendor: vendor.name,
    vendor_id: vendor.id,
    amount,
    desc
  });
  state.operations.unshift(created);
  renderDashboard();
  renderOperations();
  closeNewOpModal();
  showToast('Operation created');
}

// ---------- New Vendor ----------
function openNewVendorModal() {
  document.getElementById('newVendorName').value = '';
  document.getElementById('newVendorType').value = '';
  document.getElementById('newVendorRating').value = '4.5';
  document.getElementById('newVendorActive').value = '0';
  document.getElementById('newVendorModal').classList.add('active');
}

function closeNewVendorModal() {
  document.getElementById('newVendorModal').classList.remove('active');
}

async function submitNewVendor() {
  const name = document.getElementById('newVendorName').value.trim();
  const type = document.getElementById('newVendorType').value.trim();
  const rating = parseFloat(document.getElementById('newVendorRating').value) || 0;
  const active = parseInt(document.getElementById('newVendorActive').value, 10) || 0;

  if (!name) {
    showToast('Vendor name is required');
    return;
  }

  const created = await apiPost('/vendors', { industry: state.industry, name, type, rating, active });
  state.vendors.push(created);
  renderSidebar();
  renderVendors();
  renderPanel();
  closeNewVendorModal();
  showToast('Vendor added');
}

// ---------- Utilities ----------
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return iso;
  }
}

// ---------- Init ----------
async function init() {
  state.industries = await apiGet('/industries');
  await loadIndustryData();
  renderSidebar();
  renderDashboard();
  renderPanel();
  renderConversationList();
}

init();
