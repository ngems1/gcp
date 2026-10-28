import { api, ApiError, setServedByListener } from './api.js';
import { h, setOptions, STATUS_LABELS } from './dom.js';

const $ = (id) => document.getElementById(id);

const state = { employees: [], meta: null, status: 'loading', errorMessage: '' };

// ---------- rendering ----------

function setState(kind, message, retry) {
  const box = $('state');
  box.className = kind === 'error' ? 'state error' : 'state';
  box.replaceChildren(message);
  if (retry) box.append(h('div', {}, h('button', { class: 'btn', type: 'button', onClick: retry, text: 'Try again' })));
  box.hidden = false;
  $('table-wrap').hidden = true;
}

function renderStats() {
  const list = state.employees;
  $('stat-total').textContent = list.length;
  $('stat-active').textContent = list.filter((e) => e.status === 'active').length;
  $('stat-leave').textContent = list.filter((e) => e.status === 'on_leave').length;
  $('stat-depts').textContent = new Set(list.map((e) => e.department)).size;
}

function visibleEmployees() {
  const q = $('search').value.trim().toLowerCase();
  const dept = $('filter-department').value;
  const status = $('filter-status').value;
  return state.employees.filter((e) =>
    (!dept || e.department === dept) &&
    (!status || e.status === status) &&
    (!q || `${e.firstName} ${e.lastName} ${e.email} ${e.role}`.toLowerCase().includes(q)));
}

function renderTable() {
  if (state.status === 'loading') return setState('loading', 'Loading employees…');
  if (state.status === 'error') return setState('error', state.errorMessage, init);

  const rows = visibleEmployees();
  if (rows.length === 0) {
    const filtered = state.employees.length > 0;
    return setState('empty', filtered
      ? 'No employees match your search or filters.'
      : 'No employees yet. Click “Add employee” to create the first one.');
  }

  $('state').hidden = true;
  $('table-wrap').hidden = false;
  $('rows').replaceChildren(...rows.map((e) => {
    const name = `${e.firstName} ${e.lastName}`;
    return h('tr', {},
      h('td', {}, h('span', { class: 'name', text: name })),
      h('td', { text: e.email }),
      h('td', { text: e.department }),
      h('td', { text: e.role }),
      h('td', { text: e.hireDate }),
      h('td', {}, h('span', { class: `badge ${e.status}`, text: STATUS_LABELS[e.status] || e.status })),
      h('td', { class: 'actions' },
        h('button', { class: 'btn small', type: 'button', 'aria-label': `Edit ${name}`, onClick: () => openForm(e), text: 'Edit' }),
        h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Delete ${name}`, onClick: () => askDelete(e), text: 'Delete' })));
  }));
}

function render() {
  renderStats();
  renderTable();
}

// ---------- data ----------

async function loadEmployees() {
  state.status = 'loading';
  renderTable();
  try {
    state.employees = await api.list();
    state.status = 'ready';
  } catch (err) {
    state.status = 'error';
    state.errorMessage = err instanceof ApiError ? err.message : 'Something went wrong.';
  }
  render();
}

// ---------- add / edit dialog ----------

const formDialog = $('form-dialog');
const form = $('employee-form');
let editingId = null;
let opener = null;

function clearErrors() {
  $('form-error').hidden = true;
  form.querySelectorAll('.field-error').forEach((s) => { s.textContent = ''; });
  form.querySelectorAll('[aria-invalid]').forEach((i) => i.removeAttribute('aria-invalid'));
}

function showFieldErrors(fields, fallback) {
  let first = null;
  let shown = false;
  for (const [name, msg] of Object.entries(fields)) {
    const slot = form.querySelector(`[data-error-for="${CSS.escape(name)}"]`);
    const input = form.elements[name];
    if (!slot || !input) continue;
    slot.textContent = msg;
    input.setAttribute('aria-invalid', 'true');
    first = first || input;
    shown = true;
  }
  if (!shown) {
    $('form-error').textContent = fallback;
    $('form-error').hidden = false;
  }
  first?.focus();
}

function openForm(employee) {
  opener = document.activeElement;
  editingId = employee ? employee.id : null;
  clearErrors();
  form.reset();
  $('form-title').textContent = employee ? 'Edit employee' : 'Add employee';
  if (employee) {
    for (const key of ['firstName', 'lastName', 'email', 'department', 'role', 'hireDate', 'status']) {
      form.elements[key].value = employee[key];
    }
  } else {
    form.elements.status.value = 'active';
  }
  formDialog.showModal();
  form.elements.firstName.focus();
}

function closeForm() {
  formDialog.close();
  opener?.focus?.();
}

form.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  clearErrors();
  const payload = Object.fromEntries(new FormData(form).entries());
  const submit = $('form-submit');
  submit.disabled = true;
  try {
    if (editingId) await api.update(editingId, payload);
    else await api.create(payload);
    closeForm();
    await loadEmployees();
  } catch (err) {
    if (err instanceof ApiError) showFieldErrors(err.fields, err.message);
    else showFieldErrors({}, 'Something went wrong.');
  } finally {
    submit.disabled = false;
  }
});
$('form-cancel').addEventListener('click', closeForm);
$('add-btn').addEventListener('click', () => openForm(null));

// ---------- delete confirmation ----------

const confirmDialog = $('confirm-dialog');
let pendingDelete = null;

function askDelete(employee) {
  opener = document.activeElement;
  pendingDelete = employee;
  $('confirm-error').hidden = true;
  $('confirm-text').textContent =
    `Delete ${employee.firstName} ${employee.lastName} (${employee.email})? This cannot be undone.`;
  confirmDialog.showModal();
  $('confirm-cancel').focus();
}

function closeConfirm() {
  confirmDialog.close();
  opener?.focus?.();
}

$('confirm-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const ok = $('confirm-ok');
  ok.disabled = true;
  try {
    await api.remove(pendingDelete.id);
    closeConfirm();
    await loadEmployees();
  } catch (err) {
    // A 404 means it is already gone; refresh instead of trapping the user.
    if (err instanceof ApiError && err.status === 404) {
      closeConfirm();
      await loadEmployees();
    } else {
      $('confirm-error').textContent = err.message;
      $('confirm-error').hidden = false;
    }
  } finally {
    ok.disabled = false;
  }
});
$('confirm-cancel').addEventListener('click', closeConfirm);

// ---------- init ----------

setServedByListener((name) => { $('served-by').textContent = name; });

for (const id of ['search', 'filter-department', 'filter-status']) {
  $(id).addEventListener('input', renderTable);
}

async function init() {
  try {
    state.meta = await api.meta();
    const depts = state.meta.departments.map((d) => ({ value: d, label: d }));
    const statuses = state.meta.statuses.map((s) => ({ value: s, label: STATUS_LABELS[s] || s }));
    setOptions($('filter-department'), depts, { placeholder: 'All departments' });
    setOptions($('filter-status'), statuses, { placeholder: 'All statuses' });
    setOptions(form.elements.department, depts, { placeholder: 'Select…' });
    setOptions(form.elements.status, statuses);
  } catch {
    // The list request below shows the error state with a retry button.
  }
  await loadEmployees();
}

init();
