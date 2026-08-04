'use strict';

const $ = (sel) => document.querySelector(sel);

const ROOM_LABELS = { private: 'Privada', dorm: 'Dorm' };

function showLogin() {
  $('#login-view').classList.remove('hidden');
  $('#app-view').classList.add('hidden');
}

function showApp() {
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  loadReservations();
  loadAvailability();
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('Sesión expirada');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Error del servidor');
  }
  return res.json();
}

async function login(e) {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: $('#username').value, password: $('#password').value }),
    });
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
}

async function logout() {
  try {
    await api('/api/logout', { method: 'POST' });
  } catch {
    /* noop */
  }
  showLogin();
}

// ---- Reservations ----

async function loadReservations() {
  const body = $('#reservations-body');
  body.innerHTML = '';
  const empty = $('#reservations-empty');
  try {
    const { reservations } = await api('/api/admin/reservations');
    if (!reservations.length) {
      empty.textContent = 'No hay reservas todavía.';
      return;
    }
    empty.textContent = '';
    for (const r of reservations) {
      const tr = document.createElement('tr');
      const type = ROOM_LABELS[r.roomType] || r.roomType;
      const created = r.createdAt ? new Date(r.createdAt).toLocaleString() : '';
      tr.innerHTML = `
        <td><strong>${escapeHtml(r.name)} ${escapeHtml(r.surname)}</strong></td>
        <td>${escapeHtml(r.checkIn)}</td>
        <td>${escapeHtml(r.checkOut)}</td>
        <td>${escapeHtml(type)}</td>
        <td>${escapeHtml(String(r.guests))}</td>
        <td>${escapeHtml(created)}</td>
        <td><button class="btn danger small" data-id="${r.id}">Eliminar</button></td>`;
      tr.querySelector('button').addEventListener('click', () => deleteReservation(r.id));
      body.appendChild(tr);
    }
  } catch (err) {
    empty.textContent = err.message;
  }
}

async function deleteReservation(id) {
  if (!confirm('¿Eliminar esta reserva y liberar esos días?')) return;
  try {
    await api(`/api/admin/reservations/${id}`, { method: 'DELETE' });
    loadReservations();
    loadAvailability();
  } catch (err) {
    alert(err.message);
  }
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Availability ----

async function loadAvailability() {
  const roomType = $('#avail-roomtype').value;
  const days = $('#avail-days').value;
  const grid = $('#availability-grid');
  grid.innerHTML = '';
  try {
    const { list } = await api(`/api/admin/availability?roomType=${roomType}&days=${days}`);
    const today = new Date().toISOString().slice(0, 10);
    for (const item of list) {
      const cell = document.createElement('button');
      cell.className = 'cell';
      if (item.date < today) cell.classList.add('past');
      else if (item.available) cell.classList.add('available');
      else cell.classList.add('blocked');

      const d = new Date(`${item.date}T00:00:00Z`);
      const label = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' });
      cell.innerHTML = `<span class="day">${escapeHtml(label)}</span><span class="state"></span>`;
      cell.title = item.available ? 'Disponible — tocar para bloquear' : 'Ocupado — tocar para liberar';
      cell.addEventListener('click', () => toggleAvailability(item));
      grid.appendChild(cell);
    }
  } catch (err) {
    grid.innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
  }
}

async function toggleAvailability(item) {
  if (item.date < new Date().toISOString().slice(0, 10)) return;
  try {
    await api('/api/admin/availability', {
      method: 'POST',
      body: JSON.stringify({ roomType: $('#avail-roomtype').value, date: item.date, available: !item.available }),
    });
    loadAvailability();
  } catch (err) {
    alert(err.message);
  }
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
      $('#tab-' + tab.dataset.tab).classList.remove('hidden');
      if (tab.dataset.tab === 'availability') loadAvailability();
      else loadReservations();
    });
  });
}

function bind() {
  $('#login-form').addEventListener('submit', login);
  $('#logout').addEventListener('click', logout);
  $('#avail-roomtype').addEventListener('change', loadAvailability);
  $('#avail-days').addEventListener('change', loadAvailability);
  bindTabs();
}

(async function init() {
  bind();
  try {
    await api('/api/admin/reservations');
    showApp();
  } catch {
    showLogin();
  }
})();