/**
 * envios.js — Panel de Envíos (/envios). Autocontenida (ver
 * docs/01-arquitectura.md): incluye su propia copia de los helpers/topbar
 * comunes a todas las páginas.
 */

const $ = sel => document.querySelector(sel);
const state = { config: {}, usuario: null };
const LISTA_DEFAULTS = { transportistas: ['MRW', 'Celeritas', 'SEUR', 'Otro'] };

const IC = {
  pencil: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
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
  state.config = { transportistas: raw.transportistas ? JSON.parse(raw.transportistas) : [...LISTA_DEFAULTS.transportistas] };
}

// ---------- Envíos ----------

function rellenarSelectTransportistas() {
  const lista = state.config.transportistas || LISTA_DEFAULTS.transportistas;
  const sel = $('#input-envio-transportista');
  const actual = sel.value;
  sel.innerHTML = lista.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
  if (actual && lista.includes(actual)) sel.value = actual;
}
function renderEnvioItem(e) {
  return `<div class="envio-item" data-id="${e.id}">
    <div class="envio-item-info">
      <div class="envio-item-top"><span class="envio-item-fecha">${fmtFecha(e.fecha)}</span> · ${escapeHtml(e.transportista)}${e.numero_seguimiento ? ` · <span class="envio-item-seguimiento">${escapeHtml(e.numero_seguimiento)}</span>` : ''}</div>
      ${e.notas ? `<div class="envio-item-notas">${escapeHtml(e.notas)}</div>` : ''}
    </div>
    <div class="envio-item-acciones">
      <button type="button" class="envio-editar" data-id="${e.id}" title="Editar">${IC.pencil}</button>
      <button type="button" class="envio-eliminar" data-id="${e.id}" title="Eliminar">${IC.trash}</button>
    </div>
  </div>`;
}
let _envios = [];
async function cargarEnvios() {
  _envios = await api('/api/envios');
  const envios = _envios.filter(e => e.tipo === 'Envio');
  const devoluciones = _envios.filter(e => e.tipo === 'Devolucion');
  $('#envios-count-envio').textContent = envios.length;
  $('#envios-count-devolucion').textContent = devoluciones.length;
  $('#envios-lista-envio').innerHTML = envios.length ? envios.map(renderEnvioItem).join('') : '<p class="inventory-report-empty">Todavía no hay envíos registrados.</p>';
  $('#envios-lista-devolucion').innerHTML = devoluciones.length ? devoluciones.map(renderEnvioItem).join('') : '<p class="inventory-report-empty">Todavía no hay devoluciones registradas.</p>';
}
function abrirModalEnvio(envio = null) {
  $('#modal-envio-titulo').textContent = envio ? 'Editar envío' : 'Nuevo envío';
  $('#envio-id').value = envio ? envio.id : '';
  rellenarSelectTransportistas();
  $('#input-envio-fecha').value = envio ? envio.fecha : new Date().toISOString().slice(0, 10);
  $('#input-envio-tipo').value = envio ? envio.tipo : 'Envio';
  $('#input-envio-transportista').value = envio ? envio.transportista : $('#input-envio-transportista').value;
  $('#input-envio-seguimiento').value = envio ? (envio.numero_seguimiento || '') : '';
  $('#input-envio-notas').value = envio ? (envio.notas || '') : '';
  $('#modal-envio').showModal();
}
$('#btn-nuevo-envio').addEventListener('click', () => abrirModalEnvio());
$('#btn-envio-cancelar').addEventListener('click', () => $('#modal-envio').close());
$('#form-envio').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#envio-id').value;
  const datos = { fecha: $('#input-envio-fecha').value, tipo: $('#input-envio-tipo').value, transportista: $('#input-envio-transportista').value, numero_seguimiento: $('#input-envio-seguimiento').value.trim(), notas: $('#input-envio-notas').value.trim() };
  try {
    if (id) await api(`/api/envios/${id}`, { method: 'PUT', body: JSON.stringify(datos) });
    else await api('/api/envios', { method: 'POST', body: JSON.stringify(datos) });
    $('#modal-envio').close();
    await cargarEnvios();
  } catch (err) { avisar(err.message); }
});
document.querySelectorAll('#envios-lista-envio, #envios-lista-devolucion').forEach(cont => {
  cont.addEventListener('click', async e => {
    const btnEd = e.target.closest('.envio-editar'), btnDel = e.target.closest('.envio-eliminar');
    if (btnEd) { const envio = _envios.find(x => String(x.id) === btnEd.dataset.id); if (envio) abrirModalEnvio(envio); }
    else if (btnDel) {
      if (!(await confirmar('¿Seguro que quieres eliminar este registro? No se puede deshacer.', { titulo: 'Eliminar envío', textoOk: 'Eliminar', peligro: true }))) return;
      try { await api(`/api/envios/${btnDel.dataset.id}`, { method: 'DELETE' }); await cargarEnvios(); } catch (err) { avisar(err.message); }
    }
  });
});
$('#btn-envios-informe').addEventListener('click', () => {
  $('#informe-envios-tipo').value = ''; $('#informe-envios-desde').value = ''; $('#informe-envios-hasta').value = '';
  $('#modal-informe-envios').showModal();
});
$('#btn-informe-envios-cancelar').addEventListener('click', () => $('#modal-informe-envios').close());
$('#form-informe-envios').addEventListener('submit', e => {
  e.preventDefault();
  const params = new URLSearchParams();
  const tipo = $('#informe-envios-tipo').value, desde = $('#informe-envios-desde').value, hasta = $('#informe-envios-hasta').value;
  if (tipo) params.set('tipo', tipo); if (desde) params.set('desde', desde); if (hasta) params.set('hasta', hasta);
  window.open(`/api/envios/informe/pdf?${params}`, '_blank', 'width=860,height=920');
  $('#modal-informe-envios').close();
});

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();
  await cargarConfig();
  actualizarBadgeTickets();
  try { rellenarSelectTransportistas(); await cargarEnvios(); } catch (err) { avisar(err.message); }
}
iniciar();
