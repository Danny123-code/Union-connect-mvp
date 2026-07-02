const API = '/api';

const state = {
  user: null,
  company: null,
  vendors: [],
  operations: [],
  currentConversationVendor: null,
  messagesCache: {}, // vendorId -> messages[]
  documents: {},      // vendorId -> documents[]
  currentModalOp: null,
  teammates: []
};

// ---------- API helpers ----------
async function apiRequest(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include'
  });
  let data = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `${method} ${path} failed: ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const apiGet = (path) => apiRequest('GET', path);
const apiPost = (path, body) => apiRequest('POST', path, body);
const apiPatch = (path, body) => apiRequest('PATCH', path, body);

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2200);
}

function initials(str) {
  return (str || '').toUpperCase().substring(0, 2);
}

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

// ---------- Auth screen ----------
function hideAllAuthForms() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('forgotForm').style.display = 'none';
  document.getElementById('resetForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'none';
}

function showLogin() {
  hideAllAuthForms();
  document.getElementById('loginForm').style.display = '';
}

function showForgot() {
  hideAllAuthForms();
  document.getElementById('forgotForm').style.display = '';
  document.getElementById('forgotError').textContent = '';
  document.getElementById('forgotSuccess').style.display = 'none';
}

function showResetForm() {
  hideAllAuthForms();
  document.getElementById('resetForm').style.display = '';
}

function showSignup() {
  hideAllAuthForms();
  document.getElementById('signupForm').style.display = '';
}

async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');
  errorEl.textContent = '';
  if (!email || !password) {
    errorEl.textContent = 'Enter your email and password.';
    return;
  }
  try {
    const result = await apiPost('/auth/login', { email, password });
    state.user = result.user;
    state.company = result.company;
    await enterApp();
  } catch (e) {
    errorEl.textContent = e.message || 'Login failed.';
  }
}

async function signup() {
  const companyName = document.getElementById('signupCompanyName').value.trim();
  const industry = document.getElementById('signupIndustry').value;
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const errorEl = document.getElementById('signupError');
  errorEl.textContent = '';
  if (!companyName || !name || !email || !password) {
    errorEl.textContent = 'All fields are required.';
    return;
  }
  try {
    const result = await apiPost('/auth/signup', { companyName, industry, name, email, password });
    state.user = result.user;
    state.company = result.company;
    await enterApp();
  } catch (e) {
    errorEl.textContent = e.message || 'Could not create workspace.';
  }
}

async function logout() {
  try { await apiPost('/auth/logout'); } catch { /* ignore */ }
  state.user = null;
  state.company = null;
  document.getElementById('appRoot').style.display = 'none';
  document.getElementById('authScreen').style.display = 'flex';
  showLogin();
}

// ---------- Password reset ----------
let pendingResetToken = null;

async function requestPasswordReset() {
  const email = document.getElementById('forgotEmail').value.trim();
  const errorEl = document.getElementById('forgotError');
  const successEl = document.getElementById('forgotSuccess');
  errorEl.textContent = '';
  successEl.style.display = 'none';
  if (!email) {
    errorEl.textContent = 'Enter your email.';
    return;
  }
  try {
    const result = await apiPost('/auth/forgot-password', { email });
    successEl.textContent = result.message || 'If that email has an account, a reset link has been sent.';
    successEl.style.display = '';
  } catch (e) {
    errorEl.textContent = e.message || 'Something went wrong.';
  }
}

async function submitPasswordReset() {
  const password = document.getElementById('resetPassword').value;
  const errorEl = document.getElementById('resetError');
  errorEl.textContent = '';
  if (!password || password.length < 8) {
    errorEl.textContent = 'Password must be at least 8 characters.';
    return;
  }
  try {
    await apiPost('/auth/reset-password', { token: pendingResetToken, password });
    showToast('Password updated. Please log in.');
    window.history.replaceState({}, '', '/');
    showLogin();
  } catch (e) {
    errorEl.textContent = e.message || 'This reset link is invalid or has expired.';
  }
}

async function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appRoot').style.display = 'flex';

  document.getElementById('userAvatar').textContent = initials(state.user.name);
  document.getElementById('userNameLabel').textContent = state.user.name;
  document.getElementById('userRoleLabel').textContent = state.user.role;
  document.getElementById('companyNameLabel').textContent = state.company.name;

  await loadCompanyData();
  renderSidebar();
  renderDashboard();
  renderPanel();
  renderConversationList();
}

// ---------- Data loading ----------
async function loadCompanyData() {
  const [vendors, operations] = await Promise.all([
    apiGet('/vendors'),
    apiGet('/operations')
  ]);
  state.vendors = vendors;
  state.operations = operations;
  state.messagesCache = {};
  state.documents = {};
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
    document.getElementById('headerSubtitle').textContent = `${state.company.name} Vendors`;
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
  } else if (tab === 'team') {
    document.getElementById('teamView').classList.add('active');
    document.getElementById('headerTitle').textContent = 'Team';
    document.getElementById('headerSubtitle').textContent = `People with access to ${state.company.name}`;
    renderTeam();
    renderPanel();
  }
}

// ---------- Rendering ----------
function renderSidebar() {
  const html = state.vendors.map(v => `
    <div class="list-item">
      <div class="list-item-avatar">${initials(v.id)}</div>
      <div class="list-item-info">
        <div class="list-item-name">${escapeHtml(v.name)}</div>
        <div class="list-item-meta">${escapeHtml(v.type)}</div>
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
          <h3>${escapeHtml(v.name)}</h3>
          <p>${escapeHtml(v.type)}</p>
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
        <button class="vendor-btn" onclick="goToConversation('${v.id}', '${escapeHtml(v.name)}')">Message</button>
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

function goToConversation(vendorId, vendorName) {
  document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.nav-item')[3].classList.add('active'); // Messaging is the 4th nav item
  document.querySelectorAll('.view').forEach(view => view.classList.remove('active'));
  document.getElementById('messagingView').classList.add('active');
  document.getElementById('headerTitle').textContent = 'Messaging';
  document.getElementById('headerSubtitle').textContent = 'Vendor communication hub';
  openConversation(vendorId, vendorName);
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
            <div class="conversation-name-small">${escapeHtml(vendor.name)}</div>
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
    state.messagesCache[vendorId] = await apiGet(`/messages?vendorId=${vendorId}`);
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
  const saved = await apiPost('/messages', { vendorId, msg, sender: 'you' });
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
      state.messagesCache[vendor.id] = await apiGet(`/messages?vendorId=${vendor.id}`);
    }
    if (!state.documents[vendor.id]) {
      state.documents[vendor.id] = await apiGet(`/documents?vendorId=${vendor.id}`);
    }
    const convList = state.messagesCache[vendor.id] || [];
    const docList = state.documents[vendor.id] || [];

    html += `
      <div style="margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-tertiary); text-transform: uppercase; margin-bottom: 12px;">${escapeHtml(vendor.name)}</div>

        ${convList.length > 0 ? `
          <div style="margin-bottom: 12px;">
            ${convList.slice(-2).map(c => `
              <div class="conversation-item" onclick="goToConversation('${vendor.id}', '${escapeHtml(vendor.name)}')">
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
              <div class="doc-item" onclick="${doc.file_path ? `downloadDocument(${doc.id})` : `showToast('No file uploaded for this document')`}" title="${doc.file_path ? 'Click to download' : 'Metadata only, no file uploaded'}">
                <div class="doc-icon"><i class="ti ti-file"></i></div>
                <div class="doc-info">
                  <div class="doc-name">${escapeHtml(doc.name)}</div>
                  <div class="doc-meta">${escapeHtml(doc.size || '')} • ${formatTime(doc.created_at)}</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <button class="vendor-btn" style="width: 100%; margin-top: 4px;" onclick="triggerUpload('${vendor.id}')"><i class="ti ti-upload"></i> Upload document</button>

        <hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;">
      </div>
    `;
  }

  document.getElementById('panelContent').innerHTML = html || `<div class="empty-state">No vendors yet</div>`;
  document.getElementById('panelTitle').textContent = `Connected Vendors (${state.vendors.length})`;
}

let uploadTargetVendorId = null;

function triggerUpload(vendorId) {
  uploadTargetVendorId = vendorId;
  const input = document.getElementById('uploadFileInput');
  input.value = '';
  input.click();
}

async function handleFileSelected(event) {
  const file = event.target.files[0];
  if (!file || !uploadTargetVendorId) return;
  const formData = new FormData();
  formData.append('file', file);
  formData.append('vendorId', uploadTargetVendorId);
  try {
    const res = await fetch(`${API}/documents/upload`, {
      method: 'POST',
      body: formData,
      credentials: 'include'
    });
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) throw new Error((data && data.error) || 'Upload failed');
    state.documents[uploadTargetVendorId] = state.documents[uploadTargetVendorId] || [];
    state.documents[uploadTargetVendorId].unshift(data);
    renderPanel();
    showToast('Document uploaded');
  } catch (e) {
    showToast(e.message || 'Upload failed');
  }
}

function downloadDocument(docId) {
  window.open(`${API}/documents/${docId}/download`, '_blank');
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
  try {
    await updateOperationStatus(opId, 'approved');
    showToast('Approved');
  } catch (e) {
    showToast(e.message || 'Could not approve');
  }
}

async function updateOperationStatus(opId, status) {
  const updated = await apiPatch(`/operations/${opId}`, { status });
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
  const canApprove = op.status === 'pending' && state.user.role === 'admin';
  const actionBtn = document.getElementById('modalAction');
  if (op.status === 'completed') {
    actionBtn.style.display = 'none';
  } else if (op.status === 'pending' && state.user.role !== 'admin') {
    actionBtn.style.display = 'none';
  } else {
    actionBtn.style.display = '';
    actionBtn.textContent = op.status === 'pending' ? 'Approve & Proceed' : 'Mark Complete';
  }
  document.getElementById('detailModal').classList.add('active');
}

function closeModal() {
  document.getElementById('detailModal').classList.remove('active');
}

async function performAction() {
  if (!state.currentModalOp) return;
  const op = state.currentModalOp;
  const nextStatus = op.status === 'pending' ? 'approved' : 'completed';
  try {
    await updateOperationStatus(op.id, nextStatus);
    showToast(`${op.title} marked ${nextStatus}`);
    closeModal();
  } catch (e) {
    showToast(e.message || 'Action failed');
  }
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
    type, title, vendor: vendor.name, vendor_id: vendor.id, amount, desc
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

  const created = await apiPost('/vendors', { name, type, rating, active });
  state.vendors.push(created);
  renderSidebar();
  renderVendors();
  renderPanel();
  closeNewVendorModal();
  showToast('Vendor added');
}

// ---------- Team ----------
async function renderTeam() {
  state.teammates = await apiGet('/users');
  const html = state.teammates.map(u => `
    <div class="team-member-item">
      <div class="user-avatar">${initials(u.name)}</div>
      <div class="team-member-info">
        <div class="team-member-name">${escapeHtml(u.name)} ${u.id === state.user.id ? '(you)' : ''}</div>
        <div class="team-member-email">${escapeHtml(u.email)}</div>
      </div>
      <span class="role-badge ${u.role}">${u.role}</span>
    </div>
  `).join('');
  document.getElementById('teamList').innerHTML = html || `<div class="empty-state">No teammates yet</div>`;

  const addSection = document.getElementById('addTeammateSection');
  addSection.style.display = state.user.role === 'admin' ? '' : 'none';
}

async function addTeammate() {
  const name = document.getElementById('teamNewName').value.trim();
  const email = document.getElementById('teamNewEmail').value.trim();
  const password = document.getElementById('teamNewPassword').value;
  const role = document.getElementById('teamNewRole').value;
  const errorEl = document.getElementById('teamAddError');
  errorEl.textContent = '';

  if (!name || !email || !password) {
    errorEl.textContent = 'Name, email and password are required.';
    return;
  }

  try {
    await apiPost('/users', { name, email, password, role });
    document.getElementById('teamNewName').value = '';
    document.getElementById('teamNewEmail').value = '';
    document.getElementById('teamNewPassword').value = '';
    document.getElementById('teamNewRole').value = 'member';
    showToast('Teammate added');
    renderTeam();
  } catch (e) {
    errorEl.textContent = e.message || 'Could not add teammate.';
  }
}

// ---------- Init ----------
async function init() {
  const params = new URLSearchParams(window.location.search);
  const resetToken = params.get('resetToken');
  if (resetToken) {
    pendingResetToken = resetToken;
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appRoot').style.display = 'none';
    showResetForm();
    return;
  }
  try {
    const me = await apiGet('/auth/me');
    state.user = me.user;
    state.company = me.company;
    await enterApp();
  } catch {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appRoot').style.display = 'none';
    showLogin();
  }
}

init();
