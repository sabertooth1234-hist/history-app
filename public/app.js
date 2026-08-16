// ==================================================================
// Coordinate system — single source of truth (unchanged from last pass,
// still correct). Historical years are all that's ever stored; pixel
// position is always derived via yearToPx/pxToYear.
// ==================================================================
const scale = { yearMin: 0, yearMax: 1, pixelsPerYear: 1, labelWidth: 110 };

function computeScale() {
  const container = document.getElementById('timeline-container');
  const trackWidthPx = Math.max(100, container.clientWidth - scale.labelWidth);
  scale.yearMin = currentYearMin;
  scale.yearMax = currentYearMax;
  scale.pixelsPerYear = trackWidthPx / (currentYearMax - currentYearMin);
}
function yearToPx(year) { return (year - scale.yearMin) * scale.pixelsPerYear; }

// ==================================================================
// apiRequest — every mutation goes through this. Checks response.ok,
// surfaces the real error via toast, and throws so the caller's
// subsequent refresh/close logic never runs on a failed request. This
// directly fixes "delete silently does nothing" — a failure is now
// always visible, regardless of what caused it.
// ==================================================================
async function apiRequest(url, options = {}) {
  let res;
  try {
    res = await fetch(url, options);
  } catch (networkErr) {
    showToast('Network error — could not reach the server.');
    throw networkErr;
  }
  if (!res.ok) {
    let message = `Request failed (${res.status}).`;
    try { const body = await res.json(); if (body.error) message = body.error; } catch (e) { /* non-JSON error body */ }
    showToast(message);
    throw new Error(message);
  }
  const contentType = res.headers.get('content-type') || '';
  return contentType.includes('application/json') ? res.json() : null;
}

// ==================================================================
// refreshAfterChange — the one place every mutation's success handler
// calls into. No more remembering, per call site, which of timeline /
// database list / dropdown options needs rebuilding — this always does
// the right set for the given entity type.
// ==================================================================
async function refreshAfterChange(type) {
  await renderTimeline();
  if (type === 'ruler') { renderRulerDatabase(); loadRulerOptions(); }
  if (type === 'entry') { renderEntryDatabase(); loadEntryOptionsForCoinForm(); }
  if (type === 'coin') { renderCoinDatabase(); }
  if (type === 'civilization') { renderCivilizationsTab(); loadCivilizationOptions(); }
  if (type === 'cycle') { renderCyclesTab(); }
  if (type === 'source') { renderSourcesTab(); loadSourceOptionsForRulerForm(); }
}

// ---------- State ----------
let allCivilizations = [];
let allEntries = [];
let allRulersCache = [];
let allCoinsCache = [];
let allSourcesCache = [];
let currentYearMin, currentYearMax;
let zoomLevel = 'medium';
let compareMode = false;
let selectedCoinIds = new Set();
let compareFlipped = false;

// Unified create/edit mode state — one of these is non-null when that
// tab's form is editing an existing record instead of creating a new one.
let editingRulerId = null;
let editingEntryId = null;
let editingCoinId = null;

// ---------- Tab switching ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    if (btn.dataset.tab === 'civilizations') renderCivilizationsTab();
    if (btn.dataset.tab === 'cycles') renderCyclesTab();
    if (btn.dataset.tab === 'sources') renderSourcesTab();
    if (btn.dataset.tab === 'add-ruler') renderRulerDatabase();
    if (btn.dataset.tab === 'add-entry') renderEntryDatabase();
    if (btn.dataset.tab === 'add-coin') renderCoinDatabase();
    document.querySelectorAll('.form-status').forEach(s => s.textContent = '');
  });
});

document.querySelectorAll('form').forEach(form => {
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.type !== 'submit') e.preventDefault();
  });
});

document.querySelectorAll('.zoom-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.zoom-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    zoomLevel = btn.dataset.zoom;
    renderTimeline();
  });
});

// ---------- Load options into forms ----------
async function loadCivilizationOptions() {
  allCivilizations = await fetch('/api/civilizations').then(r => r.json());
  document.querySelectorAll('.civ-select').forEach(sel => {
    sel.innerHTML = allCivilizations.map(c => `<option value="${c.civilization_id}">${c.name}</option>`).join('');
  });
  document.getElementById('entry-civ-checkboxes').innerHTML = allCivilizations.map(c => `
    <label><input type="checkbox" name="civilization_ids" value="${c.civilization_id}"> ${c.name}</label>
  `).join('');
  return allCivilizations;
}
async function loadRulerOptions() {
  allRulersCache = await fetch('/api/rulers').then(r => r.json());
  document.querySelectorAll('.ruler-select').forEach(sel => {
    sel.innerHTML = '<option value="">(none)</option>' +
      allRulersCache.map(r => `<option value="${r.ruler_id}">${r.name}</option>`).join('');
  });
}
async function loadEntryOptionsForCoinForm() {
  allEntries = await fetch('/api/entries?year_min=-3000&year_max=3000').then(r => r.json());
  document.getElementById('coin-event-checkboxes').innerHTML = allEntries.map(e => `
    <label><input type="checkbox" name="event_ids" value="${e.entry_id}"> ${e.title} (${e.year_start})</label>
  `).join('');
}
async function loadSourceOptionsForRulerForm() {
  allSourcesCache = await fetch('/api/sources').then(r => r.json());
  document.getElementById('ruler-source-checkboxes').innerHTML = allSourcesCache.map(s => `
    <label><input type="checkbox" name="source_ids" value="${s.source_id}"> ${s.title}</label>
  `).join('');
}

// ==================================================================
// Unified create/edit: Ruler
// ==================================================================
function resetRulerForm() {
  editingRulerId = null;
  document.getElementById('ruler-form').reset();
  document.getElementById('ruler-form').classList.remove('editing');
  document.getElementById('ruler-form-title').textContent = 'Add Ruler';
  document.getElementById('ruler-submit-btn').textContent = 'Save Ruler';
  const existingPreview = document.getElementById('ruler-portrait-preview');
  if (existingPreview) existingPreview.remove();
}
document.getElementById('ruler-new-btn').addEventListener('click', resetRulerForm);

async function loadRulerIntoForm(id) {
  const r = await apiRequest(`/api/rulers/${id}`).catch(() => null);
  if (!r) return;
  editingRulerId = id;
  const form = document.getElementById('ruler-form');
  form.classList.add('editing');
  form.name.value = r.name;
  form.title.value = r.title || '';
  form.civilization_id.value = r.civilization_id;
  form.reign_start.value = r.reign_start;
  form.reign_end.value = r.reign_end;
  form.biography.value = r.biography || '';
  form.bullets.value = (r.bullet_points || []).map(b => b.bullet_text).join('\n');
  form.background_color_hex.value = r.background_color_hex || '#8899aa';
  form.verified.checked = !!r.verified;
  const sourceIds = (r.sources || []).map(s => s.source_id);
  form.querySelectorAll('input[name="source_ids"]').forEach(cb => cb.checked = sourceIds.includes(Number(cb.value)));

  const existingPreview = document.getElementById('ruler-portrait-preview');
  if (existingPreview) existingPreview.remove();
  if (r.portrait_image_path) {
    const img = document.createElement('img');
    img.id = 'ruler-portrait-preview';
    img.src = r.portrait_image_path;
    img.style.cssText = 'width:80px;border-radius:8px;display:block;margin:6px 0';
    form.querySelector('label').after(img);
  }

  document.getElementById('ruler-form-title').textContent = `Editing: ${r.name}`;
  document.getElementById('ruler-submit-btn').textContent = 'Save Changes';
  document.querySelector('.tab-btn[data-tab="add-ruler"]').click();
}

document.getElementById('ruler-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const bulletPoints = (formData.get('bullets') || '').split('\n').map(s => s.trim()).filter(Boolean);
  formData.set('bullet_points_json', JSON.stringify(bulletPoints));
  formData.delete('bullets');
  formData.set('verified', form.verified.checked ? 'true' : 'false');
  const nameForMsg = formData.get('name');
  const statusEl = form.parentElement.querySelector('.form-status');

  try {
    if (editingRulerId) {
      await apiRequest(`/api/rulers/${editingRulerId}`, { method: 'PUT', body: formData });
      statusEl.textContent = `Saved changes to "${nameForMsg}".`;
    } else {
      await apiRequest('/api/rulers', { method: 'POST', body: formData });
      statusEl.textContent = `Created: "${nameForMsg}".`;
    }
    resetRulerForm();
    await refreshAfterChange('ruler');
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

async function renderRulerDatabase() {
  allRulersCache = await fetch('/api/rulers').then(r => r.json());
  const search = (document.getElementById('ruler-db-search').value || '').toLowerCase();
  const sortBy = document.getElementById('ruler-db-sort').value;
  let rows = allRulersCache.filter(r => r.name.toLowerCase().includes(search));
  rows.sort((a, b) => sortBy === 'name' ? a.name.localeCompare(b.name) : (a.reign_start - b.reign_start));
  const civName = (id) => allCivilizations.find(c => c.civilization_id === id)?.name || '—';

  document.getElementById('ruler-database').innerHTML = `
    <table class="db-table">
      <thead><tr><th></th><th>Name</th><th>Civilization</th><th>Reign</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${rows.map(r => `
          <tr data-id="${r.ruler_id}">
            <td>${r.portrait_image_path ? `<img class="thumb" src="${r.portrait_image_path}">` : ''}</td>
            <td class="db-row-click">${r.name}</td>
            <td>${civName(r.civilization_id)}</td>
            <td>${r.reign_start} – ${r.reign_end}</td>
            <td>
              ${r.portrait_image_path ? '' : '<div class="missing">missing portrait</div>'}
              ${r.verified ? '<div class="ok">verified</div>' : '<div class="missing">unverified</div>'}
            </td>
            <td><button class="db-delete danger">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  // Clicking anywhere on the row (except Delete) loads it straight into
  // the editor — this is the workflow: database → editor, one click.
  document.querySelectorAll('#ruler-database tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.db-delete')) return;
      loadRulerIntoForm(row.dataset.id);
    });
    row.style.cursor = 'pointer';
  });
  document.querySelectorAll('#ruler-database .db-delete').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const row = e.target.closest('tr');
    const r = allRulersCache.find(x => x.ruler_id == row.dataset.id);
    if (!confirm(`Delete ${r.name}? Any coins linked to them will be unlinked, not deleted.`)) return;
    try {
      await apiRequest(`/api/rulers/${row.dataset.id}`, { method: 'DELETE' });
      if (editingRulerId == row.dataset.id) resetRulerForm();
      await refreshAfterChange('ruler');
    } catch (err) { /* toast already shown by apiRequest */ }
  }));
}
document.getElementById('ruler-db-search').addEventListener('input', renderRulerDatabase);
document.getElementById('ruler-db-sort').addEventListener('change', renderRulerDatabase);

// ==================================================================
// Unified create/edit: Event
// ==================================================================
function resetEntryForm() {
  editingEntryId = null;
  document.getElementById('entry-form').reset();
  document.getElementById('entry-form').classList.remove('editing');
  document.getElementById('entry-form-title').textContent = 'Add Historical Event';
  document.getElementById('entry-submit-btn').textContent = 'Save Event';
}
document.getElementById('entry-new-btn').addEventListener('click', resetEntryForm);

async function loadEntryIntoForm(id) {
  const e = await apiRequest(`/api/entries/${id}`).catch(() => null);
  if (!e) return;
  editingEntryId = id;
  const form = document.getElementById('entry-form');
  form.classList.add('editing');
  form.entry_type.value = e.entry_type;
  form.title.value = e.title;
  form.year_start.value = e.year_start;
  form.year_end.value = e.year_end ?? '';
  form.description.value = e.description || '';
  form.bullets.value = (e.bullet_points || []).map(b => b.bullet_text).join('\n');
  form.background_color_hex.value = e.background_color_hex || '#8899aa';
  form.querySelectorAll('input[name="civilization_ids"]').forEach(cb => cb.checked = e.civilization_ids.includes(Number(cb.value)));

  document.getElementById('entry-form-title').textContent = `Editing: ${e.title}`;
  document.getElementById('entry-submit-btn').textContent = 'Save Changes';
  document.querySelector('.tab-btn[data-tab="add-entry"]').click();
}

document.getElementById('entry-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const data = Object.fromEntries(formData);
  data.civilization_ids = formData.getAll('civilization_ids');
  data.bullet_points = (data.bullets || '').split('\n').map(s => s.trim()).filter(Boolean);
  delete data.bullets;
  const statusEl = form.parentElement.querySelector('.form-status');
  if (data.civilization_ids.length === 0) { statusEl.textContent = 'Select at least one civilization.'; return; }

  try {
    if (editingEntryId) {
      await apiRequest(`/api/entries/${editingEntryId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      statusEl.textContent = `Saved changes to "${data.title}".`;
    } else {
      await apiRequest('/api/entries', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
      });
      statusEl.textContent = `Created: "${data.title}".`;
    }
    resetEntryForm();
    await refreshAfterChange('entry');
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

async function renderEntryDatabase() {
  allEntries = await fetch('/api/entries?year_min=-3000&year_max=3000').then(r => r.json());
  const search = (document.getElementById('entry-db-search').value || '').toLowerCase();
  const sortBy = document.getElementById('entry-db-sort').value;
  let rows = allEntries.filter(e => e.title.toLowerCase().includes(search));
  rows.sort((a, b) => sortBy === 'title' ? a.title.localeCompare(b.title) : (a.year_start - b.year_start));
  const civNames = (ids) => ids.map(id => allCivilizations.find(c => c.civilization_id === id)?.name).filter(Boolean).join(', ');

  document.getElementById('entry-database').innerHTML = `
    <table class="db-table">
      <thead><tr><th>Title</th><th>Type</th><th>Year</th><th>Civilizations</th><th></th></tr></thead>
      <tbody>
        ${rows.map(e => `
          <tr data-id="${e.entry_id}">
            <td>${e.title}</td>
            <td>${e.entry_type}</td>
            <td>${e.year_start}${e.year_end ? '–' + e.year_end : ''}</td>
            <td>${civNames(e.civilization_ids) || '<span class="missing">none</span>'}</td>
            <td><button class="db-delete danger">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.querySelectorAll('#entry-database tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.db-delete')) return;
      loadEntryIntoForm(row.dataset.id);
    });
    row.style.cursor = 'pointer';
  });
  document.querySelectorAll('#entry-database .db-delete').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const row = e.target.closest('tr');
    if (!confirm('Delete this event?')) return;
    try {
      await apiRequest(`/api/entries/${row.dataset.id}`, { method: 'DELETE' });
      if (editingEntryId == row.dataset.id) resetEntryForm();
      await refreshAfterChange('entry');
    } catch (err) { /* toast already shown */ }
  }));
}
document.getElementById('entry-db-search').addEventListener('input', renderEntryDatabase);
document.getElementById('entry-db-sort').addEventListener('change', renderEntryDatabase);

// ==================================================================
// Unified create/edit: Coin
// ==================================================================
function resetCoinForm() {
  editingCoinId = null;
  document.getElementById('coin-form').reset();
  document.getElementById('coin-form').classList.remove('editing');
  document.getElementById('coin-form-title').textContent = 'Add Coin';
  document.getElementById('coin-submit-btn').textContent = 'Save Coin';
  const preview = document.getElementById('coin-image-preview');
  if (preview) preview.remove();
  const hint = document.getElementById('coin-image-preview-hint');
  if (hint) hint.remove();
}
document.getElementById('coin-new-btn').addEventListener('click', resetCoinForm);

async function loadCoinIntoForm(id) {
  const c = await apiRequest(`/api/coins/${id}`).catch(() => null);
  if (!c) return;
  editingCoinId = id;
  const form = document.getElementById('coin-form');
  form.classList.add('editing');
  form.name.value = c.name || '';
  form.civilization_id.value = c.civilization_id || '';
  form.ruler_id.value = c.ruler_id || '';
  form.year_start.value = c.year_start ?? '';
  form.year_end.value = c.year_end ?? '';
  form.metal.value = c.metal || '';
  form.weight_grams.value = c.weight_grams ?? '';
  form.mint_location.value = c.mint_location || '';
  form.description.value = c.description || '';
  form.historical_significance.value = c.historical_significance || '';
  form.querySelectorAll('input[name="event_ids"]').forEach(cb => cb.checked = (c.event_ids || []).includes(Number(cb.value)));

  // Show the existing coin images with click-to-flip — this was present
  // in the old detail view and was accidentally dropped when that got
  // replaced by this unified form. Restoring it here.
  const existingPreview = document.getElementById('coin-image-preview');
  if (existingPreview) existingPreview.remove();
  if (c.front_image_path || c.back_image_path) {
    let showingFront = true;
    const preview = document.createElement('div');
    preview.id = 'coin-image-preview';
    preview.className = 'coin-flip';
    preview.innerHTML = `<img src="${c.front_image_path || c.back_image_path || ''}" alt="coin">`;
    preview.title = 'Click to flip';
    preview.addEventListener('click', () => {
      showingFront = !showingFront;
      preview.querySelector('img').src = (showingFront ? c.front_image_path : c.back_image_path) || '';
    });
    form.querySelector('h2, label').before(preview);
    const hint = document.createElement('p');
    hint.id = 'coin-image-preview-hint';
    hint.style.cssText = 'font-size:11px;color:#999;margin-top:-4px';
    hint.textContent = 'Click the image to flip front/back';
    preview.after(hint);
  }
  const existingHint = document.getElementById('coin-image-preview-hint');
  if (!c.front_image_path && !c.back_image_path && existingHint) existingHint.remove();

  document.getElementById('coin-form-title').textContent = `Editing: ${c.name || '(unnamed)'}`;
  document.getElementById('coin-submit-btn').textContent = 'Save Changes';
  document.querySelector('.tab-btn[data-tab="add-coin"]').click();
}

document.getElementById('coin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const statusEl = form.parentElement.querySelector('.form-status');
  try {
    if (editingCoinId) {
      await apiRequest(`/api/coins/${editingCoinId}`, { method: 'PUT', body: formData });
      statusEl.textContent = 'Saved changes.';
    } else {
      await apiRequest('/api/coins', { method: 'POST', body: formData });
      statusEl.textContent = 'Coin created.';
    }
    resetCoinForm();
    await refreshAfterChange('coin');
    setTimeout(() => { statusEl.textContent = ''; }, 4000);
  } catch (err) {
    statusEl.textContent = 'Error: ' + err.message;
  }
});

async function renderCoinDatabase() {
  allCoinsCache = await fetch('/api/coins').then(r => r.json());
  const search = (document.getElementById('coin-db-search').value || '').toLowerCase();
  const sortBy = document.getElementById('coin-db-sort').value;
  let rows = allCoinsCache.filter(c => (c.name || '').toLowerCase().includes(search));
  rows.sort((a, b) => sortBy === 'name' ? (a.name || '').localeCompare(b.name || '') : (a.year_start - b.year_start));

  document.getElementById('coin-database').innerHTML = `
    <table class="db-table">
      <thead><tr><th></th><th>Name</th><th>Year</th><th>Metal</th><th>Status</th><th></th></tr></thead>
      <tbody>
        ${rows.map(c => `
          <tr data-id="${c.coin_id}">
            <td>${c.front_image_path ? `<img class="thumb" src="${c.front_image_path}">` : ''}</td>
            <td>${c.name || '(unnamed)'}</td>
            <td>${c.year_start}${c.year_end ? '–' + c.year_end : ''}</td>
            <td>${c.metal || '—'}</td>
            <td>${c.front_image_path && c.back_image_path ? '<div class="ok">images ok</div>' : '<div class="missing">missing image</div>'}</td>
            <td><button class="db-delete danger">Delete</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
  document.querySelectorAll('#coin-database tr[data-id]').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.db-delete')) return;
      loadCoinIntoForm(row.dataset.id);
    });
    row.style.cursor = 'pointer';
  });
  document.querySelectorAll('#coin-database .db-delete').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const row = e.target.closest('tr');
    if (!confirm('Delete this coin?')) return;
    try {
      await apiRequest(`/api/coins/${row.dataset.id}`, { method: 'DELETE' });
      if (editingCoinId == row.dataset.id) resetCoinForm();
      await refreshAfterChange('coin');
    } catch (err) { /* toast already shown */ }
  }));
}
document.getElementById('coin-db-search').addEventListener('input', renderCoinDatabase);
document.getElementById('coin-db-sort').addEventListener('change', renderCoinDatabase);

// ---------- Civilizations tab ----------
async function renderCivilizationsTab() {
  const civs = await fetch('/api/civilizations').then(r => r.json());
  const list = document.getElementById('civilization-list');
  list.innerHTML = civs.map(c => `
    <div class="civ-row" data-id="${c.civilization_id}" draggable="true">
      <span class="drag-handle">⠿</span>
      <div class="swatch" style="background:${c.color_hex}"></div>
      <div class="name">${c.name}</div>
      <div class="range">${c.year_start ?? '—'} to ${c.year_end ?? '—'}</div>
      <button class="edit-civ">Edit</button>
      <button class="dup-civ">Duplicate</button>
      <button class="danger del-civ">Delete</button>
    </div>
  `).join('');

  let draggedId = null;
  list.querySelectorAll('.civ-row').forEach(row => {
    row.addEventListener('dragstart', () => { draggedId = row.dataset.id; row.style.opacity = '0.5'; });
    row.addEventListener('dragend', () => { row.style.opacity = '1'; });
    row.addEventListener('dragover', (e) => e.preventDefault());
    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetId = row.dataset.id;
      if (draggedId === targetId) return;
      const order = [...list.querySelectorAll('.civ-row')].map(r => r.dataset.id);
      const fromIdx = order.indexOf(draggedId);
      const toIdx = order.indexOf(targetId);
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, draggedId);
      try {
        await Promise.all(order.map((id, i) => {
          const civ = civs.find(c => c.civilization_id == id);
          return apiRequest(`/api/civilizations/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...civ, default_column_order: i })
          });
        }));
        await refreshAfterChange('civilization');
      } catch (err) { /* toast already shown */ }
    });
  });

  list.querySelectorAll('.del-civ').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = e.target.closest('.civ-row').dataset.id;
    if (!confirm('Delete this civilization?')) return;
    try {
      await apiRequest(`/api/civilizations/${id}`, { method: 'DELETE' });
      await refreshAfterChange('civilization');
    } catch (err) { /* toast already shown */ }
  }));
  list.querySelectorAll('.dup-civ').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = e.target.closest('.civ-row').dataset.id;
    await apiRequest(`/api/civilizations/${id}/duplicate`, { method: 'POST' });
    await refreshAfterChange('civilization');
  }));
  list.querySelectorAll('.edit-civ').forEach(btn => btn.addEventListener('click', (e) => {
    const row = e.target.closest('.civ-row');
    const civ = civs.find(c => c.civilization_id == row.dataset.id);
    const name = prompt('Name:', civ.name); if (name === null) return;
    const yearStart = prompt('Active range start (blank = follow global range):', civ.year_start ?? '');
    const yearEnd = prompt('Active range end (blank = follow global range):', civ.year_end ?? '');
    apiRequest(`/api/civilizations/${civ.civilization_id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, short_code: civ.short_code, color_hex: civ.color_hex, default_column_order: civ.default_column_order,
        year_start: yearStart === '' ? null : Number(yearStart), year_end: yearEnd === '' ? null : Number(yearEnd)
      })
    }).then(() => refreshAfterChange('civilization'));
  }));
}

document.getElementById('civilization-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  data.year_start = data.year_start === '' ? null : Number(data.year_start);
  data.year_end = data.year_end === '' ? null : Number(data.year_end);
  const statusEl = form.parentElement.querySelector('.form-status');
  try {
    await apiRequest('/api/civilizations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    statusEl.textContent = 'Civilization added.';
    form.reset();
    await refreshAfterChange('civilization');
  } catch (err) { statusEl.textContent = 'Error: ' + err.message; }
});

// ---------- Cycle markers tab ----------
async function renderCyclesTab() {
  const cycles = await fetch('/api/cycles').then(r => r.json());
  const list = document.getElementById('cycle-list');
  list.innerHTML = cycles.map(c => `
    <div class="cycle-row" data-id="${c.cycle_id}">
      <div class="swatch" style="background:${c.color_hex}"></div>
      <div class="info">${c.label_prefix} — ${c.start_year} to ${c.end_year ?? '?'}, every ${c.interval_years} years
        ${c.visible ? '' : '<em>(hidden)</em>'}</div>
      <button class="toggle-cycle">${c.visible ? 'Hide' : 'Show'}</button>
      <button class="edit-cycle">Edit</button>
      <button class="danger del-cycle">Delete</button>
    </div>
  `).join('');

  list.querySelectorAll('.toggle-cycle').forEach(btn => btn.addEventListener('click', async (e) => {
    const c = cycles.find(x => x.cycle_id == e.target.closest('.cycle-row').dataset.id);
    await apiRequest(`/api/cycles/${c.cycle_id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, visible: c.visible ? 0 : 1 })
    });
    await refreshAfterChange('cycle');
  }));
  list.querySelectorAll('.del-cycle').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = e.target.closest('.cycle-row').dataset.id;
    if (!confirm('Delete this cycle definition?')) return;
    await apiRequest(`/api/cycles/${id}`, { method: 'DELETE' });
    await refreshAfterChange('cycle');
  }));
  list.querySelectorAll('.edit-cycle').forEach(btn => btn.addEventListener('click', (e) => {
    const c = cycles.find(x => x.cycle_id == e.target.closest('.cycle-row').dataset.id);
    const startYear = prompt('Starting year:', c.start_year); if (startYear === null) return;
    const endYear = prompt('Ending year:', c.end_year ?? ''); if (endYear === null) return;
    const interval = prompt('Interval (years):', c.interval_years); if (interval === null) return;
    const labelPrefix = prompt('Label prefix:', c.label_prefix);
    apiRequest(`/api/cycles/${c.cycle_id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...c, start_year: Number(startYear), end_year: Number(endYear),
                              interval_years: Number(interval), label_prefix: labelPrefix })
    }).then(() => refreshAfterChange('cycle'));
  }));
}

document.getElementById('cycle-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  data.visible = form.visible.checked;
  const statusEl = form.parentElement.querySelector('.form-status');
  try {
    await apiRequest('/api/cycles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    statusEl.textContent = 'Cycle added.';
    form.reset(); form.interval_years.value = 69;
    await refreshAfterChange('cycle');
  } catch (err) { statusEl.textContent = 'Error: ' + err.message; }
});

// ---------- Sources tab ----------
async function renderSourcesTab() {
  allSourcesCache = await fetch('/api/sources').then(r => r.json());
  const list = document.getElementById('source-list');
  list.innerHTML = allSourcesCache.map(s => `
    <div class="civ-row" data-id="${s.source_id}">
      <div class="name">${s.title}</div>
      <div class="range">${s.author || ''}</div>
      <button class="danger del-source">Delete</button>
    </div>
  `).join('');
  list.querySelectorAll('.del-source').forEach(btn => btn.addEventListener('click', async (e) => {
    const id = e.target.closest('.civ-row').dataset.id;
    if (!confirm('Delete this source?')) return;
    await apiRequest(`/api/sources/${id}`, { method: 'DELETE' });
    await refreshAfterChange('source');
  }));
}
document.getElementById('source-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form));
  const statusEl = form.parentElement.querySelector('.form-status');
  try {
    await apiRequest('/api/sources', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    statusEl.textContent = 'Source added.';
    form.reset();
    await refreshAfterChange('source');
  } catch (err) { statusEl.textContent = 'Error: ' + err.message; }
});

// ---------- Stacking algorithm for overlapping rulers ----------
function assignRows(items, startKey, endKey) {
  const sorted = [...items].sort((a, b) => a[startKey] - b[startKey]);
  const rowEnds = [];
  const placements = [];
  sorted.forEach(item => {
    let row = rowEnds.findIndex(end => item[startKey] > end);
    if (row === -1) { row = rowEnds.length; rowEnds.push(item[endKey]); }
    else { rowEnds[row] = item[endKey]; }
    placements.push({ item, row });
  });
  return { rowsUsed: Math.max(1, rowEnds.length), placements };
}
const ROW_HEIGHT = 30;

// ==================================================================
// Tick step (items 4 + 5) — genuinely width-aware this time. The prior
// version picked a step purely from the zoom level (with a span-based
// fallback only at Detail), but zoom level and visible year range are
// independent in this app — switching to Detail doesn't narrow the
// range, so a 1,674-year span at "step 10" produced ~167 overlapping
// labels crammed into the available width. That's the wall-of-text bug.
//
// The fix: compute the step from THREE things together, as requested —
// available pixel width, current span, and zoom level:
//   1. How many labels can physically fit without overlapping
//      (available width / minimum readable label spacing).
//   2. The zoom level sets a FLOOR — Overview never shows finer than
//      100-year steps even if there's technically room, so it always
//      reads as "the big picture." Medium floors at 25. Detail has no
//      floor — it's purely width-driven, so it naturally shows decades
//      on a wide span and individual years once you narrow the range
//      enough for them to fit, matching "individual years only when
//      there is enough visual space."
//   3. Whichever of those two produces the LARGER (coarser) step wins —
//      that guarantees labels never overlap, regardless of span or zoom.
// ==================================================================
function computeTickStep() {
  const container = document.getElementById('timeline-container');
  const availablePx = Math.max(100, container.clientWidth - scale.labelWidth);
  const minLabelSpacingPx = 55;
  const maxTicksThatFit = Math.max(2, Math.floor(availablePx / minLabelSpacingPx));
  const span = currentYearMax - currentYearMin;
  const widthDrivenStep = span / maxTicksThatFit;

  const zoomFloor = zoomLevel === 'overview' ? 100 : zoomLevel === 'medium' ? 25 : 1;
  const roughStep = Math.max(widthDrivenStep, zoomFloor);

  // Round up to a "nice" step (1-2-5 pattern) so labels are always round
  // numbers, never something like 37 or 83.
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
  return niceSteps.find(s => s >= roughStep) || Math.ceil(roughStep / 1000) * 1000;
}
function fixedTicks(min, max) {
  let step = computeTickStep();
  const span = max - min;
  const niceSteps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 25000];

  // Hard, unconditional backstop: no matter what computeTickStep() came
  // up with (even if the width measurement it relies on is wrong for
  // some environment-specific reason I can't reproduce here), this
  // guarantees no more than HARD_MAX_TICKS labels are ever generated.
  // This makes the wall-of-text bug structurally impossible rather than
  // just unlikely.
  const HARD_MAX_TICKS = 30;
  let i = niceSteps.indexOf(step);
  if (i === -1) i = 0;
  while (span / step > HARD_MAX_TICKS && i < niceSteps.length - 1) {
    i++;
    step = niceSteps[i];
  }

  const ticks = [];
  const start = Math.ceil(min / step) * step;
  for (let yr = start; yr <= max; yr += step) ticks.push(yr);
  return ticks;
}

// ==================================================================
// Timeline rendering
// ==================================================================
async function renderTimeline() {
  currentYearMin = Number(document.getElementById('year-min').value);
  currentYearMax = Number(document.getElementById('year-max').value);
  const showCoins = document.getElementById('show-coins').checked;
  const showCycles = document.getElementById('show-cycles').checked;
  allCoinsCache = [];

  const [civs, rulers, entries, coins, cycles] = await Promise.all([
    fetch('/api/civilizations').then(r => r.json()),
    fetch(`/api/rulers?year_min=${currentYearMin}&year_max=${currentYearMax}`).then(r => r.json()),
    fetch(`/api/entries?year_min=${currentYearMin}&year_max=${currentYearMax}`).then(r => r.json()),
    showCoins ? fetch('/api/coins').then(r => r.json()) : Promise.resolve([]),
    showCycles ? fetch('/api/cycles').then(r => r.json()) : Promise.resolve([])
  ]);

  computeScale();

  const container = document.getElementById('timeline-container');
  container.innerHTML = '';

  const eventStrip = document.createElement('div');
  eventStrip.className = 'event-strip';
  const stripLabel = document.createElement('div');
  stripLabel.className = 'event-strip-label';
  stripLabel.textContent = 'Events';
  eventStrip.appendChild(stripLabel);

  const { rowsUsed: eventRows, placements: eventPlacements } = assignRows(
    entries.map(e => ({ ...e, _end: e.year_end || e.year_start })), 'year_start', '_end'
  );
  eventStrip.style.height = Math.max(40, 10 + eventRows * 22) + 'px';

  eventPlacements.forEach(({ item: e, row }) => {
    const civNames = e.civilization_ids.map(id => civs.find(c => c.civilization_id === id)?.name).filter(Boolean);
    const color = civNames.length ? civs.find(c => c.civilization_id === e.civilization_ids[0])?.color_hex : (e.background_color_hex || '#888');

    const pin = document.createElement('div');
    pin.className = 'event-pin-global';
    pin.style.left = yearToPx(e.year_start) + 'px';
    pin.style.top = (row * 22) + 'px';
    pin.title = `${e.title} — ${e.year_start} (${civNames.join(', ') || 'no civilization set'})`;

    const dot = document.createElement('div');
    dot.className = 'dot';
    dot.style.background = e.background_color_hex || color;
    pin.appendChild(dot);

    if (zoomLevel !== 'overview') {
      const lbl = document.createElement('div');
      lbl.className = 'label';
      lbl.style.background = e.background_color_hex || color;
      lbl.textContent = zoomLevel === 'detail' ? `${e.title} (${e.year_start})` : e.title;
      pin.appendChild(lbl);
    }

    pin.addEventListener('click', (ev) => { if (!ev.__wasDrag) loadEntryIntoForm(e.entry_id); });
    attachDrag(pin, e.year_start, e.year_end || e.year_start, (newStart, newEnd) =>
      apiRequest(`/api/entries/${e.entry_id}/position`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year_start: newStart, year_end: newEnd === newStart ? null : newEnd })
      }).then(() => refreshAfterChange('entry')).catch(() => renderTimeline()), true
    );
    eventStrip.appendChild(pin);
  });
  container.appendChild(eventStrip);

  const axis = document.createElement('div');
  axis.className = 'axis';
  fixedTicks(currentYearMin, currentYearMax).forEach(yr => {
    const label = document.createElement('span');
    label.style.position = 'absolute';
    label.style.left = yearToPx(yr) + 'px';
    label.textContent = yr;
    axis.appendChild(label);
  });
  container.appendChild(axis);

  const lanesWrapper = document.createElement('div');
  lanesWrapper.style.position = 'relative';

  civs.forEach(civ => {
    const civRulers = rulers.filter(r => r.civilization_id === civ.civilization_id);
    const civCoins = coins.filter(c => c.civilization_id === civ.civilization_id);
    const { rowsUsed, placements } = assignRows(civRulers, 'reign_start', 'reign_end');
    const laneHeight = rowsUsed * ROW_HEIGHT + 12;

    const lane = document.createElement('div');
    lane.className = 'lane';
    lane.style.minHeight = laneHeight + 'px';

    const label = document.createElement('div');
    label.className = 'lane-label';
    label.textContent = civ.name;
    lane.appendChild(label);

    const track = document.createElement('div');
    track.className = 'lane-track';
    track.style.minHeight = laneHeight + 'px';

    const activeStart = civ.year_start ?? currentYearMin;
    const activeEnd = civ.year_end ?? currentYearMax;
    if (activeStart > currentYearMin) {
      const band = document.createElement('div');
      band.className = 'inactive-band';
      band.style.left = '0px';
      band.style.width = yearToPx(activeStart) + 'px';
      track.appendChild(band);
    }
    if (activeEnd < currentYearMax) {
      const band = document.createElement('div');
      band.className = 'inactive-band';
      band.style.left = yearToPx(activeEnd) + 'px';
      band.style.right = '0px';
      track.appendChild(band);
    }

    const rulerRows = document.createElement('div');
    rulerRows.className = 'ruler-rows';
    rulerRows.style.height = (rowsUsed * ROW_HEIGHT) + 'px';

    placements.forEach(({ item: r, row }) => {
      const rulerLabel = zoomLevel === 'overview' ? r.name.split(' ').pop() : `${r.name} (${r.reign_start})`;
      const card = makeRangeCard(r.reign_start, r.reign_end, r.background_color_hex || civ.color_hex, '');
      if (r.portrait_image_path && zoomLevel !== 'overview') {
        const img = document.createElement('img');
        img.src = r.portrait_image_path;
        img.className = 'ruler-portrait-thumb';
        card.appendChild(img);
      }
      card.appendChild(document.createTextNode(rulerLabel));
      card.classList.add('ruler-card');
      card.style.top = (row * ROW_HEIGHT + 4) + 'px';
      card.title = `${r.name}${r.title ? ', ' + r.title : ''} (${r.reign_start}–${r.reign_end})`;
      card.addEventListener('click', (ev) => { if (!ev.__wasDrag) loadRulerIntoForm(r.ruler_id); });
      attachDrag(card, r.reign_start, r.reign_end, (newStart, newEnd) =>
        apiRequest(`/api/rulers/${r.ruler_id}/position`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reign_start: newStart, reign_end: newEnd })
        }).then(() => refreshAfterChange('ruler')).catch(() => renderTimeline())
      );
      rulerRows.appendChild(card);
    });
    track.appendChild(rulerRows);

    civCoins.forEach(c => {
      if (c.year_start < currentYearMin || c.year_start > currentYearMax) return;
      allCoinsCache.push(c);
      const marker = document.createElement('div');
      marker.title = c.name;
      marker.style.position = 'absolute';
      marker.style.bottom = '2px';
      marker.style.left = yearToPx(c.year_start) + 'px';

      if (zoomLevel === 'detail' && c.front_image_path) {
        marker.className = 'coin-marker thumb';
        marker.innerHTML = `<img src="${c.front_image_path}" alt="">`;
      } else {
        marker.className = 'coin-marker';
        marker.textContent = '¢';
      }
      if (compareMode && selectedCoinIds.has(c.coin_id)) marker.classList.add('selected');
      marker.addEventListener('click', () => {
        try {
          if (compareMode) {
            if (selectedCoinIds.has(c.coin_id)) selectedCoinIds.delete(c.coin_id);
            else selectedCoinIds.add(c.coin_id);
            marker.classList.toggle('selected');
            renderComparisonPanel();
          } else {
            loadCoinIntoForm(c.coin_id);
          }
        } catch (err) {
          showToast('Something went wrong opening this coin: ' + err.message);
        }
      });
      track.appendChild(marker);
    });

    lane.appendChild(track);
    lanesWrapper.appendChild(lane);
  });
  container.appendChild(lanesWrapper);

  if (showCycles && cycles.length) {
    const overlay = document.createElement('div');
    overlay.className = 'cycle-overlay';
    overlay.style.top = (eventStrip.offsetHeight + axis.offsetHeight) + 'px';

    // Collect every marker instance across every cycle first, so we can
    // detect label collisions globally (not just within one cycle) and
    // stagger them onto separate rows when they'd otherwise overlap —
    // this is what was making "Cycle 30 Cycle 99 Cycle 168..." run
    // together into unreadable, seemingly-misaligned text.
    const allMarkers = [];
    cycles.filter(c => c.visible).forEach(cyc => {
      const cycEnd = cyc.end_year ?? currentYearMax;
      if (cyc.start_year > currentYearMax || cycEnd < currentYearMin) return;
      const firstK = Math.ceil((Math.max(currentYearMin, cyc.start_year) - cyc.start_year) / cyc.interval_years);
      for (let k = firstK; ; k++) {
        const year = cyc.start_year + k * cyc.interval_years;
        if (year > Math.min(currentYearMax, cycEnd)) break;
        if (year < currentYearMin) continue;
        // Sequential occurrence number (1st, 2nd, 3rd... marker of THIS
        // cycle), not the year itself — k=0 at start_year is "1".
        allMarkers.push({ year, color: cyc.color_hex, label: `${cyc.label_prefix} ${k + 1}` });
      }
    });
    allMarkers.sort((a, b) => a.year - b.year);

    const estimatedLabelWidthPx = 80;
    const rowRightEdge = []; // tracks how far each stagger-row is occupied
    allMarkers.forEach(m => {
      const xPx = yearToPx(m.year);
      let row = rowRightEdge.findIndex(edge => xPx > edge);
      if (row === -1) { row = rowRightEdge.length; rowRightEdge.push(xPx + estimatedLabelWidthPx); }
      else { rowRightEdge[row] = xPx + estimatedLabelWidthPx; }

      const line = document.createElement('div');
      line.className = 'cycle-line';
      line.style.left = xPx + 'px';
      line.style.borderColor = m.color;
      const lbl = document.createElement('div');
      lbl.className = 'cycle-label';
      lbl.style.color = m.color;
      lbl.style.top = (-18 - row * 14) + 'px'; // stack upward, row 0 closest to axis
      lbl.textContent = m.label;
      line.appendChild(lbl);
      overlay.appendChild(line);
    });
    container.appendChild(overlay);
  }

  const guideOverlay = document.createElement('div');
  guideOverlay.className = 'event-guide-overlay';
  eventPlacements.forEach(({ item: e }) => {
    const line = document.createElement('div');
    line.className = 'event-guide-line';
    line.style.left = yearToPx(e.year_start) + 'px';
    guideOverlay.appendChild(line);
  });
  container.appendChild(guideOverlay);

  renderComparisonPanel();
}

function makeRangeCard(yearStart, yearEnd, color, label) {
  const card = document.createElement('div');
  card.className = 'card';
  card.style.left = yearToPx(yearStart) + 'px';
  card.style.width = Math.max(10, yearToPx(yearEnd) - yearToPx(yearStart)) + 'px';
  card.style.background = color;
  if (label) card.textContent = label;
  const handle = document.createElement('div');
  handle.className = 'resize-handle';
  card.appendChild(handle);
  card._resizeHandle = handle;
  return card;
}

// ==================================================================
// Drag (item 4) — the critical fix: `dragPixelsPerYear` is captured
// ONCE at pointerdown and used for the rest of that specific drag
// gesture. It never reads the live, shared `scale.pixelsPerYear` again
// after that. This means even if something else on the page triggers a
// re-render (window resize, another action) WHILE a drag is in
// progress, that drag's math is completely unaffected — there's no
// shared mutable state left for it to be corrupted by.
//
// On top of that: committed years are clamped to a sane bound and any
// commit that would produce a nonsensical result is rejected outright,
// so a bug elsewhere can visually glitch but can never actually write
// an impossible value to the database (the server enforces the same
// bound independently, as a second layer).
// ==================================================================
const CLAMP_MIN = -5000, CLAMP_MAX = 5000;

function attachDrag(card, initialStart, initialEnd, onCommit, isPin) {
  let dragging = false, resizing = false, startX, tooltip, dragPixelsPerYear;

  function showTooltip(text, xPx) {
    if (!tooltip) { tooltip = document.createElement('div'); tooltip.className = 'drag-tooltip'; card.appendChild(tooltip); }
    tooltip.style.left = xPx + 'px';
    tooltip.textContent = text;
  }
  function removeTooltip() { if (tooltip) { tooltip.remove(); tooltip = null; } }

  card.addEventListener('pointerdown', (e) => {
    if (!isPin && e.target === card._resizeHandle) resizing = true;
    else dragging = true;
    startX = e.clientX;
    dragPixelsPerYear = scale.pixelsPerYear; // snapshot — see comment above
    card.classList.add('dragging');
    card.setPointerCapture(e.pointerId);
    e.__wasDrag = false;
  });

  card.addEventListener('pointermove', (e) => {
    if (!dragging && !resizing) return;
    e.__wasDrag = true;
    const deltaPx = e.clientX - startX;
    const deltaYears = Math.round(deltaPx / dragPixelsPerYear);

    if (dragging) {
      let newStart = Math.round(initialStart + deltaYears);
      let newEnd = Math.round(initialEnd + deltaYears);
      newStart = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, newStart));
      newEnd = Math.max(CLAMP_MIN, Math.min(CLAMP_MAX, newEnd));
      card.style.left = ((newStart - scale.yearMin) * scale.pixelsPerYear) + 'px';
      showTooltip(`→ ${newStart}`, deltaPx + 10);
      card._pendingStart = newStart; card._pendingEnd = newEnd;
    } else if (resizing) {
      let newEnd = Math.max(initialStart, Math.round(initialEnd + deltaYears));
      newEnd = Math.min(CLAMP_MAX, newEnd);
      card.style.width = Math.max(10, ((newEnd - initialStart) * scale.pixelsPerYear)) + 'px';
      showTooltip(`→ ${newEnd}`, deltaPx + 10);
      card._pendingStart = initialStart; card._pendingEnd = newEnd;
    }
  });

  card.addEventListener('pointerup', (e) => {
    removeTooltip();
    card.classList.remove('dragging');
    if ((dragging || resizing) && card._pendingStart !== undefined) {
      const start = card._pendingStart, end = card._pendingEnd;
      onCommit(start, end);
      if (end < currentYearMin || start > currentYearMax) {
        showToast(`Moved to year ${start} — that's outside the current view (${currentYearMin} to ${currentYearMax}). It hasn't been deleted; widen the year range to see it again.`);
      }
    }
    dragging = false; resizing = false;
    setTimeout(() => { e.__wasDrag = false; }, 0);
  });
}

function showToast(message) {
  let toast = document.getElementById('toast');
  if (!toast) { toast = document.createElement('div'); toast.id = 'toast'; toast.className = 'toast'; document.body.appendChild(toast); }
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('visible'), 6000);
}

document.getElementById('apply-range').addEventListener('click', renderTimeline);
document.getElementById('show-coins').addEventListener('change', renderTimeline);
document.getElementById('show-cycles').addEventListener('change', renderTimeline);
document.getElementById('print-poster').addEventListener('click', () => window.print());
window.addEventListener('resize', renderTimeline);

// ---------- Coin comparison mode ----------
document.getElementById('compare-toggle').addEventListener('click', () => {
  compareMode = !compareMode;
  document.getElementById('compare-toggle').classList.toggle('active', compareMode);
  let banner = document.getElementById('compare-mode-banner');
  if (compareMode) {
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'compare-mode-banner';
      banner.className = 'compare-mode-banner';
      banner.textContent = 'Compare mode active — click coin markers on the timeline to select them.';
      document.getElementById('timeline-container').before(banner);
    }
  } else if (banner) {
    banner.remove();
  }
  renderTimeline();
});
document.getElementById('flip-all-coins').addEventListener('click', () => { compareFlipped = !compareFlipped; renderComparisonPanel(); });
document.getElementById('clear-comparison').addEventListener('click', () => { selectedCoinIds.clear(); renderTimeline(); });
document.getElementById('close-comparison').addEventListener('click', () => document.getElementById('comparison-panel').classList.remove('visible'));

async function renderComparisonPanel() {
  const panel = document.getElementById('comparison-panel');
  const itemsEl = document.getElementById('comparison-items');
  if (selectedCoinIds.size === 0) { panel.classList.remove('visible'); return; }
  panel.classList.add('visible');
  const selected = allCoinsCache.filter(c => selectedCoinIds.has(c.coin_id));
  itemsEl.innerHTML = selected.map(c => {
    const ruler = allRulersCache.find(r => r.ruler_id === c.ruler_id);
    const img = (compareFlipped ? c.back_image_path : c.front_image_path) || '';
    return `
      <div class="comparison-item" data-id="${c.coin_id}">
        <button class="remove">&times;</button>
        <img src="${img}" alt="${c.name || ''}">
        <div><strong>${c.name || '(unnamed)'}</strong></div>
        <div>${c.year_start ?? '?'}${c.year_end ? '–' + c.year_end : ''}</div>
        <div>${c.metal || '—'}${ruler ? ' · ' + ruler.name : ''}</div>
      </div>
    `;
  }).join('');
  itemsEl.querySelectorAll('.remove').forEach(btn => btn.addEventListener('click', (e) => {
    selectedCoinIds.delete(Number(e.target.closest('.comparison-item').dataset.id));
    renderTimeline();
  }));
}

// ---------- Search ----------
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.classList.remove('visible'); return; }
  searchTimer = setTimeout(async () => {
    const results = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then(r => r.json());
    searchResults.innerHTML = results.length
      ? results.map(r => `<div data-type="${r.result_type}" data-id="${r.id}">${r.title} <span style="color:#999">(${r.result_type}, ${r.year_start ?? '?'})</span></div>`).join('')
      : '<div style="color:#999">No results</div>';
    searchResults.classList.add('visible');
  }, 250);
});
searchResults.addEventListener('click', (e) => {
  const row = e.target.closest('div[data-type]');
  if (!row) return;
  searchResults.classList.remove('visible');
  searchInput.value = '';
  if (row.dataset.type === 'ruler') { document.querySelector('[data-tab="add-ruler"]').click(); loadRulerIntoForm(row.dataset.id); }
  else if (row.dataset.type === 'entry') { document.querySelector('[data-tab="add-entry"]').click(); loadEntryIntoForm(row.dataset.id); }
  else if (row.dataset.type === 'coin') { document.querySelector('[data-tab="add-coin"]').click(); loadCoinIntoForm(row.dataset.id); }
});

// ---------- Init ----------
loadCivilizationOptions().then(() => renderTimeline());
loadRulerOptions();
loadEntryOptionsForCoinForm();
loadSourceOptionsForRulerForm();
