/**
 * licencias.js — Panel de Licencias de software por cliente (/licencias).
 * Autocontenida (ver docs/01-arquitectura.md): incluye su propia copia de
 * los helpers/topbar comunes a todas las páginas.
 */

const $ = sel => document.querySelector(sel);
const state = { clientes: [], config: {}, usuario: null };
const LISTA_DEFAULTS = { programas_licencia: ['Microsoft Office', 'Kaspersky', 'Otro'] };

const IC = {
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  chevron: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/></svg>`,
};

function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }
function fmtFecha(iso) { if (!iso) return '—'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; }

async function api(path, opts) {
  const options = opts || {};
  let res;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  } catch (err) { throw new Error('No se ha podido conectar con el servidor.'); }
  if (res.status === 401) { location.href = '/login'; throw new Error('Sesión caducada.'); }
  if (!res.ok) {
    let msg = `Error ${res.status} en ${path}`;
    try {
      const text = await res.text();
      if (text) { try { msg = JSON.parse(text).error || msg; } catch { msg += ': ' + text.slice(0, 120); } }
    } catch (_) {}
    throw new Error(msg);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}
function confirmar(mensaje, { titulo = 'Confirmar', textoOk = 'Aceptar', textoCancelar = 'Cancelar', peligro = false } = {}) {
  const dlg = $('#modal-confirm');
  $('#confirm-titulo').textContent = titulo;
  $('#confirm-mensaje').textContent = mensaje;
  const btnOk = $('#confirm-btn-ok');
  btnOk.textContent = textoOk;
  btnOk.className = 'btn ' + (peligro ? 'btn-danger' : 'btn-primary');
  $('#confirm-btn-cancel').textContent = textoCancelar;
  return new Promise(resolve => { dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true }); dlg.showModal(); });
}
function avisar(mensaje, { titulo = 'Aviso' } = {}) {
  const dlg = $('#modal-alert');
  $('#alert-titulo').textContent = titulo; $('#alert-mensaje').textContent = mensaje;
  return new Promise(resolve => { dlg.addEventListener('close', () => resolve(), { once: true }); dlg.showModal(); });
}
document.querySelectorAll('dialog [data-close]').forEach(btn => btn.addEventListener('click', () => btn.closest('dialog').close()));
function poblarSelect(selectId, lista, valorActual = null) {
  const sel = $(selectId);
  sel.innerHTML = lista.map(v => `<option value="${escapeHtml(v)}"${valorActual === v ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
  if (valorActual && !lista.includes(valorActual)) sel.innerHTML += `<option value="${escapeHtml(valorActual)}" selected>${escapeHtml(valorActual)}</option>`;
}

// ---------- Topbar ----------

function mostrarUsuarioEnTopbar() { $('#user-badge-nombre').textContent = state.usuario?.nombre || ''; }
async function actualizarBadgeTickets() {
  if (!state.usuario) return;
  try {
    const params = new URLSearchParams();
    if (state.usuario.nombre) params.set('tecnico', state.usuario.nombre);
    const todos = await api(`/api/tickets?${params}`);
    const activos = todos.filter(t => !['Entregado', 'Cerrado'].includes(t.estado)).length;
    const badge = $('#tickets-badge');
    if (activos > 0) { badge.textContent = activos; badge.classList.remove('hidden'); } else badge.classList.add('hidden');
  } catch (_) {}
}
$('#btn-logout').addEventListener('click', async () => { await fetch('/api/logout', { method: 'POST' }); location.href = '/login'; });
$('#btn-mi-pass').addEventListener('click', () => {
  $('#cambiar-pass-uid').value = state.usuario.id;
  $('#cambiar-pass-titulo').textContent = 'Mi perfil';
  $('#cambiar-pass-usuario').textContent = '';
  $('#input-perfil-email').value = state.usuario.email || '';
  $('#input-cambiar-pass').value = '';
  $('#modal-cambiar-pass').showModal();
});
$('#btn-cambiar-pass-cancelar').addEventListener('click', () => $('#modal-cambiar-pass').close());
$('#form-cambiar-pass').addEventListener('submit', async e => {
  e.preventDefault();
  const uid = $('#cambiar-pass-uid').value, email = $('#input-perfil-email').value.trim(), pass = $('#input-cambiar-pass').value;
  if (pass && pass.length < 4) { avisar('Mínimo 4 caracteres'); return; }
  try {
    const u = await api(`/api/usuarios/${uid}/perfil`, { method: 'PUT', body: JSON.stringify({ email, password: pass || undefined }) });
    if (String(uid) === String(state.usuario?.id)) state.usuario = { ...state.usuario, email: u.email };
    $('#modal-cambiar-pass').close();
    avisar(pass ? 'Perfil y contraseña actualizados' : 'Perfil actualizado');
  } catch (e) { avisar(e.message); }
});

function resaltarQ(texto, q) {
  if (!q || !texto) return escapeHtml(texto || '');
  const idx = texto.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return escapeHtml(texto);
  return escapeHtml(texto.slice(0, idx)) + `<mark>${escapeHtml(texto.slice(idx, idx + q.length))}</mark>` + escapeHtml(texto.slice(idx + q.length));
}
async function cerrarBusqueda() { $('#global-search-results').classList.add('hidden'); $('#global-search-results').innerHTML = ''; _resultIndex = -1; }
let _resultIndex = -1, _searchTimeout;
async function busquedaGlobal() {
  const q = $('#global-search-input').value.trim();
  const cont = $('#global-search-results');
  _resultIndex = -1;
  if (q.length < 2) { cont.classList.add('hidden'); cont.innerHTML = ''; return; }
  const { clientes, equipos, historial, componentes } = await api(`/api/buscar?q=${encodeURIComponent(q)}`);
  const total = clientes.length + equipos.length + historial.length + componentes.length;
  cont.classList.remove('hidden');
  if (total === 0) { cont.innerHTML = '<p class="result-vacio">Sin resultados para «' + escapeHtml(q) + '»</p>'; return; }
  let html = '';
  if (clientes.length > 0) { html += '<div class="result-grupo">Clientes</div>'; clientes.forEach(c => { const meta = [c.num_equipos + ' equipo(s)', c.telefono, c.email].filter(Boolean).join(' · '); html += `<div class="result-item" data-action="ir-cliente" data-cid="${c.id}"><span class="result-icon">👤</span><span><strong>${resaltarQ(c.nombre, q)}</strong><span class="result-meta">${escapeHtml(meta)}</span></span></div>`; }); }
  if (equipos.length > 0) { html += '<div class="result-grupo">Equipos</div>'; equipos.forEach(e => { const ns = e.numero_serie ? ' · N/S: ' + e.numero_serie : ''; const quien = e.cliente_nombre ? e.cliente_nombre : 'Sin asignar'; html += `<div class="result-item" data-action="ir-equipo" data-eid="${e.id}" data-cid="${e.cliente_id || ''}"><span class="result-icon">🖥️</span><span><strong>${resaltarQ(e.nombre, q)}</strong> <span class="result-tipo">${escapeHtml(e.tipo)}</span>${ns ? '<span class="result-meta">' + escapeHtml(ns) + '</span>' : ''}<span class="result-meta">→ ${escapeHtml(quien)}</span></span></div>`; }); }
  if (historial.length > 0) { html += '<div class="result-grupo">Historial</div>'; historial.forEach(h => { const desc = (h.problema_reportado || h.descripcion || '').slice(0, 60); const quien = h.cliente_nombre ? h.cliente_nombre : 'Sin asignar'; html += `<div class="result-item" data-action="ir-equipo" data-eid="${h.equipo_id}" data-cid="${h.cliente_id || ''}"><span class="result-icon">🔧</span><span><strong>${escapeHtml(h.equipo_nombre)}</strong> <span class="result-tipo">${escapeHtml(h.tipo)}</span><span class="result-meta">${resaltarQ(desc, q)} · ${escapeHtml(quien)}</span></span></div>`; }); }
  if (componentes.length > 0) { html += '<div class="result-grupo">Componentes</div>'; componentes.forEach(c => { const ns = c.numero_serie ? ' N/S: ' + c.numero_serie : ''; const quien = c.cliente_nombre ? c.cliente_nombre : 'Sin asignar'; html += `<div class="result-item" data-action="ir-equipo" data-eid="${c.equipo_id}" data-cid="${c.cliente_id || ''}"><span class="result-icon">🔩</span><span><strong>${resaltarQ(c.tipo, q)}</strong>${ns ? '<span class="result-meta">' + escapeHtml(ns) + '</span>' : ''}<span class="result-meta">en ${escapeHtml(c.equipo_nombre)} · ${escapeHtml(quien)}</span></span></div>`; }); }
  cont.innerHTML = html;
  cont.querySelectorAll('[data-action="ir-cliente"]').forEach(el => el.addEventListener('click', () => { location.href = `/clientes/${el.dataset.cid}`; }));
  cont.querySelectorAll('[data-action="ir-equipo"]').forEach(el => el.addEventListener('click', () => { location.href = (el.dataset.cid ? `/clientes/${el.dataset.cid}` : '/oficina') + `#equipo-${el.dataset.eid}`; }));
}
$('#global-search-btn').addEventListener('click', busquedaGlobal);
$('#global-search-input').addEventListener('input', () => { clearTimeout(_searchTimeout); _searchTimeout = setTimeout(busquedaGlobal, 300); });
$('#global-search-input').addEventListener('keydown', e => {
  const cont = $('#global-search-results'); const items = cont.querySelectorAll('.result-item');
  if (e.key === 'Escape') { cerrarBusqueda(); $('#global-search-input').value = ''; return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); _resultIndex = Math.min(_resultIndex + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('result-focused', i === _resultIndex)); items[_resultIndex]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _resultIndex = Math.max(_resultIndex - 1, -1); items.forEach((it, i) => it.classList.toggle('result-focused', i === _resultIndex)); if (_resultIndex >= 0) items[_resultIndex].scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { if (_resultIndex >= 0) items[_resultIndex]?.click(); else busquedaGlobal(); }
});
document.addEventListener('click', e => { if (!e.target.closest('#global-search-results') && !e.target.closest('.global-search')) cerrarBusqueda(); });

async function cargarConfig() {
  const raw = await api('/api/config');
  state.config = { programas_licencia: raw.programas_licencia ? JSON.parse(raw.programas_licencia) : [...LISTA_DEFAULTS.programas_licencia] };
}
async function cargarClientes() { state.clientes = await api('/api/clientes'); }

// ---------- Licencias ----------

function rellenarSelectClientesLicencia(clienteActualId = null) {
  const cliente = clienteActualId ? state.clientes.find(c => String(c.id) === String(clienteActualId)) : null;
  $('#input-licencia-cliente').value = clienteActualId || '';
  $('#input-licencia-cliente-busqueda').value = cliente ? cliente.nombre : '';
  $('#licencia-cliente-sugerencias').classList.add('hidden');
}
function renderSugerenciasClienteLicencia(query) {
  const q = query.trim().toLowerCase();
  const cont = $('#licencia-cliente-sugerencias');
  if (!q) { cont.classList.add('hidden'); cont.innerHTML = ''; return; }
  const coincidencias = state.clientes.filter(c => c.nombre.toLowerCase().includes(q)).slice(0, 8);
  cont.innerHTML = coincidencias.length ? coincidencias.map(c => `<div class="combo-sugerencia-item" data-id="${c.id}">${escapeHtml(c.nombre)}</div>`).join('') : '<div class="combo-sugerencia-vacia">Sin coincidencias</div>';
  cont.classList.remove('hidden');
}
$('#input-licencia-cliente-busqueda').addEventListener('input', e => { $('#input-licencia-cliente').value = ''; renderSugerenciasClienteLicencia(e.target.value); });
$('#input-licencia-cliente-busqueda').addEventListener('focus', e => { if (e.target.value.trim()) renderSugerenciasClienteLicencia(e.target.value); });
$('#licencia-cliente-sugerencias').addEventListener('click', e => {
  const item = e.target.closest('.combo-sugerencia-item'); if (!item || !item.dataset.id) return;
  const cliente = state.clientes.find(c => String(c.id) === item.dataset.id); if (!cliente) return;
  $('#input-licencia-cliente').value = cliente.id;
  $('#input-licencia-cliente-busqueda').value = cliente.nombre;
  $('#licencia-cliente-sugerencias').classList.add('hidden');
});
document.addEventListener('click', e => { if (!e.target.closest('.combo-cliente')) $('#licencia-cliente-sugerencias').classList.add('hidden'); });

function rellenarSelectProgramasLicencia(programaActual = null) { poblarSelect('#input-licencia-programa', state.config.programas_licencia || LISTA_DEFAULTS.programas_licencia, programaActual); }

function renderLicenciaItem(l) {
  return `<div class="licencia-item" data-id="${l.id}">
    <div class="licencia-item-info">
      <div class="licencia-item-top"><span class="licencia-item-cliente">${escapeHtml(l.cliente_nombre)}</span> · ${escapeHtml(l.programa)}</div>
      <div class="licencia-item-meta">${fmtFecha(l.fecha)}${l.numero_licencia ? ` · <span class="licencia-item-numero">${escapeHtml(l.numero_licencia)}</span>` : ''}</div>
    </div>
    <div class="licencia-item-acciones">
      <button type="button" class="licencia-editar" data-id="${l.id}" title="Editar">${IC.pencil}</button>
      <button type="button" class="licencia-eliminar" data-id="${l.id}" title="Eliminar">${IC.trash}</button>
    </div>
  </div>`;
}
let _licencias = [], _licenciasFiltro = '';
function renderLicenciasAgrupadas() {
  const q = _licenciasFiltro.trim().toLowerCase();
  const porCliente = new Map();
  _licencias.forEach(l => {
    if (!porCliente.has(l.cliente_id)) porCliente.set(l.cliente_id, { cliente_id: l.cliente_id, cliente_nombre: l.cliente_nombre, items: [] });
    porCliente.get(l.cliente_id).items.push(l);
  });
  let grupos = [...porCliente.values()].sort((a, b) => a.cliente_nombre.localeCompare(b.cliente_nombre, 'es'));
  if (q) grupos = grupos.filter(g => g.cliente_nombre.toLowerCase().includes(q));
  $('#licencias-count').textContent = _licencias.length;
  const cont = $('#licencias-lista-wrap');
  if (grupos.length === 0) { cont.innerHTML = `<p class="inventory-report-empty">${_licencias.length === 0 ? 'Todavía no hay licencias registradas.' : 'No hay coincidencias.'}</p>`; return; }
  cont.innerHTML = grupos.map(g => `
    <details class="licencia-grupo"${q ? ' open' : ''}>
      <summary class="licencia-grupo-head">
        <span class="licencia-grupo-chevron">${IC.chevron}</span>
        <span class="licencia-grupo-nombre">${escapeHtml(g.cliente_nombre)}</span>
        <span class="section-count">${g.items.length}</span>
      </summary>
      <div class="licencia-grupo-items">${g.items.map(renderLicenciaItem).join('')}</div>
    </details>
  `).join('');
}
async function cargarLicencias() { _licencias = await api('/api/licencias'); renderLicenciasAgrupadas(); }
$('#licencias-busqueda').addEventListener('input', e => { _licenciasFiltro = e.target.value; renderLicenciasAgrupadas(); });

function abrirModalLicencia(licencia = null) {
  $('#modal-licencia-titulo').textContent = licencia ? 'Editar licencia' : 'Nueva licencia';
  $('#licencia-id').value = licencia ? licencia.id : '';
  rellenarSelectClientesLicencia(licencia ? licencia.cliente_id : null);
  rellenarSelectProgramasLicencia(licencia ? licencia.programa : null);
  $('#input-licencia-fecha').value = licencia ? licencia.fecha : new Date().toISOString().slice(0, 10);
  $('#input-licencia-numero').value = licencia ? (licencia.numero_licencia || '') : '';
  $('#modal-licencia').showModal();
}
$('#btn-nueva-licencia').addEventListener('click', () => abrirModalLicencia());
$('#btn-licencia-cancelar').addEventListener('click', () => $('#modal-licencia').close());
$('#form-licencia').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#licencia-id').value;
  const cliente_id = $('#input-licencia-cliente').value;
  if (!cliente_id) { avisar('Selecciona un cliente.'); return; }
  const datos = { cliente_id, programa: $('#input-licencia-programa').value, fecha: $('#input-licencia-fecha').value, numero_licencia: $('#input-licencia-numero').value.trim() };
  try {
    if (id) await api(`/api/licencias/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
    else await api('/api/licencias', { method: 'POST', body: JSON.stringify(datos) });
    $('#modal-licencia').close();
    await cargarLicencias();
  } catch (err) { avisar(err.message); }
});
$('#licencias-lista-wrap').addEventListener('click', async e => {
  const btnEd = e.target.closest('.licencia-editar'), btnDel = e.target.closest('.licencia-eliminar');
  if (btnEd) { const licencia = _licencias.find(x => String(x.id) === btnEd.dataset.id); if (licencia) abrirModalLicencia(licencia); }
  else if (btnDel) {
    if (!(await confirmar('¿Seguro que quieres eliminar esta licencia? No se puede deshacer.', { titulo: 'Eliminar licencia', textoOk: 'Eliminar', peligro: true }))) return;
    try { await api(`/api/licencias/${btnDel.dataset.id}`, { method: 'DELETE' }); await cargarLicencias(); } catch (err) { avisar(err.message); }
  }
});

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();
  await cargarConfig();
  await cargarClientes();
  actualizarBadgeTickets();
  const filtroCliente = new URLSearchParams(location.search).get('cliente') || '';
  _licenciasFiltro = filtroCliente;
  $('#licencias-busqueda').value = filtroCliente;
  try { await cargarLicencias(); } catch (err) { avisar(err.message); }
}
iniciar();
