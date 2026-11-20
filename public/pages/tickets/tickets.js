/**
 * tickets.js — Panel de Tickets (/tickets). Autocontenida (ver
 * docs/01-arquitectura.md): incluye su propia copia de los helpers/topbar
 * comunes a todas las páginas.
 */

const $ = sel => document.querySelector(sel);
const state = { clientes: [], config: {}, usuario: null };

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

// ---------- Búsqueda global ----------

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

// ---------- Configuración (técnicos + estados de ticket) ----------

const DEFAULT_TICKET_ESTADOS_OBJ = [
  { nombre: 'Pendiente', color: '#94a3b8' }, { nombre: 'Diagnóstico', color: '#3b82f6' }, { nombre: 'En reparación', color: '#f59e0b' },
  { nombre: 'Esperando piezas', color: '#a855f7' }, { nombre: 'Listo', color: '#22c55e' }, { nombre: 'Entregado', color: '#10b981' }, { nombre: 'Cerrado', color: '#64748b' },
];
let TICKET_ESTADOS = DEFAULT_TICKET_ESTADOS_OBJ.map(e => e.nombre);
let TICKET_COLORES = Object.fromEntries(DEFAULT_TICKET_ESTADOS_OBJ.map(e => [e.nombre, e.color]));
function aplicarEstadosTicket(arr) { TICKET_ESTADOS = arr.map(e => e.nombre); TICKET_COLORES = Object.fromEntries(arr.map(e => [e.nombre, e.color])); }
function pillTextColor(hex) {
  const c = hex || '#94a3b8';
  const r = parseInt(c.slice(1, 3), 16), g = parseInt(c.slice(3, 5), 16), b = parseInt(c.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  if (lum <= 0.6) return c;
  return '#' + [r, g, b].map(x => Math.round(x * 0.5).toString(16).padStart(2, '0')).join('');
}
async function cargarConfig() {
  const raw = await api('/api/config');
  state.config = { tecnicos: raw.tecnicos ? JSON.parse(raw.tecnicos) : [] };
  const estadosArr = raw.ticket_estados ? JSON.parse(raw.ticket_estados) : DEFAULT_TICKET_ESTADOS_OBJ;
  aplicarEstadosTicket(estadosArr);
}
async function cargarClientes() { state.clientes = await api('/api/clientes'); }

// ---------- Modal Ticket (alta/edición) ----------

let _ticketEstadoActual = 'Pendiente';
function renderTicketStepper(estadoActual) {
  _ticketEstadoActual = estadoActual;
  const cont = $('#ticket-stepper');
  cont.innerHTML = TICKET_ESTADOS.map(e => `<button type="button" class="ticket-estado-btn${e === estadoActual ? ' activo' : ''}" data-estado="${escapeHtml(e)}" style="${e === estadoActual ? `--tc:${TICKET_COLORES[e]}` : ''}">${escapeHtml(e)}</button>`).join('');
  cont.querySelectorAll('.ticket-estado-btn').forEach(btn => btn.addEventListener('click', () => renderTicketStepper(btn.dataset.estado)));
}
function _rellenarModalTicket(titulo, subtitulo, ticket) {
  $('#ticket-id').value = ticket ? ticket.id : '';
  $('#ticket-numero-display').textContent = ticket ? ticket.numero : '';
  $('#modal-ticket-titulo').textContent = titulo;
  const sub = $('#modal-ticket-subtitulo');
  if (subtitulo) { sub.textContent = subtitulo; sub.classList.remove('hidden'); } else sub.classList.add('hidden');
  $('#input-ticket-desc').value = ticket?.descripcion || '';
  $('#input-ticket-solucion').value = ticket?.solucion || '';
  $('#input-ticket-coste').value = ticket?.coste != null ? ticket.coste : '';
  $('#input-ticket-horas').value = ticket?.horas_trabajadas != null ? ticket.horas_trabajadas : '';
  $('#input-ticket-entrada').value = ticket?.fecha_entrada || new Date().toISOString().slice(0, 10);
  $('#input-ticket-estimada').value = ticket?.fecha_estimada || '';
  $('#input-ticket-notas').value = ticket?.notas_internas || '';
  $('#input-ticket-transportista').value = ticket?.transportista || 'MRW';
  $('#input-ticket-seguimiento').value = ticket?.numero_seguimiento || '';
  const tecnicos = state.config.tecnicos || [];
  const selTec = $('#input-ticket-tecnico');
  selTec.innerHTML = '<option value="">— Sin asignar —</option>' + tecnicos.map(t => `<option value="${escapeHtml(t)}"${ticket?.tecnico_asignado === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  if (!ticket?.tecnico_asignado && state.usuario?.nombre) selTec.value = state.usuario.nombre;
  $('#input-ticket-notificar').checked = false;
  const actualizarCheckNotif = () => { $('#campo-notificar-tecnico').classList.toggle('hidden', !$('#input-ticket-tecnico').value); };
  actualizarCheckNotif();
  selTec.onchange = actualizarCheckNotif;
  renderTicketStepper(ticket?.estado || 'Pendiente');
  $('#btn-ticket-eliminar').classList.toggle('hidden', !ticket);
  $('#modal-ticket').showModal();
}
async function abrirModalTicket(eq, ticket = null) {
  $('#ticket-equipo-id').value = eq.id; $('#ticket-cliente-id').value = '';
  _rellenarModalTicket(ticket ? `Ticket — ${escapeHtml(eq.nombre)}` : `Nuevo ticket — ${escapeHtml(eq.nombre)}`, null, ticket);
}
function abrirModalTicketCliente(cliente, ticket = null) {
  $('#ticket-equipo-id').value = ''; $('#ticket-cliente-id').value = cliente.id || cliente.cliente_id;
  const nombre = escapeHtml(cliente.nombre || cliente.cliente_nombre || 'Cliente');
  _rellenarModalTicket(ticket ? `Ticket — ${nombre}` : `Nuevo ticket — ${nombre}`, 'Incidencia general (sin equipo asignado)', ticket);
}
$('#btn-ticket-cancelar').addEventListener('click', () => $('#modal-ticket').close());
$('#btn-ticket-guardar').addEventListener('click', async () => {
  const id = $('#ticket-id').value, equipoId = $('#ticket-equipo-id').value, clienteId = $('#ticket-cliente-id').value;
  const payload = {
    estado: _ticketEstadoActual, descripcion: $('#input-ticket-desc').value.trim() || null, solucion: $('#input-ticket-solucion').value.trim() || null,
    tecnico_asignado: $('#input-ticket-tecnico').value || null, asignado_por: state.usuario?.nombre || null,
    fecha_entrada: $('#input-ticket-entrada').value || null, fecha_estimada: $('#input-ticket-estimada').value || null,
    coste: $('#input-ticket-coste').value !== '' ? Number($('#input-ticket-coste').value) : null,
    horas_trabajadas: $('#input-ticket-horas').value !== '' ? Number($('#input-ticket-horas').value) : null,
    notas_internas: $('#input-ticket-notas').value.trim() || null, transportista: $('#input-ticket-transportista').value.trim() || null,
    numero_seguimiento: $('#input-ticket-seguimiento').value.trim() || null,
  };
  const notificar = $('#input-ticket-notificar').checked && !!payload.tecnico_asignado;
  try {
    let savedTicket;
    if (id) savedTicket = await api(`/api/tickets/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else if (equipoId) savedTicket = await api(`/api/equipos/${equipoId}/tickets`, { method: 'POST', body: JSON.stringify(payload) });
    else if (clienteId) savedTicket = await api(`/api/clientes/${clienteId}/tickets`, { method: 'POST', body: JSON.stringify(payload) });
    $('#modal-ticket').close();
    await cargarPanelTickets();
    actualizarBadgeTickets();
    if (notificar && savedTicket?.id) {
      try { await api(`/api/tickets/${savedTicket.id}/notificar`, { method: 'POST', body: JSON.stringify({ asignado_por: state.usuario?.nombre }) }); }
      catch (e) { avisar('Ticket guardado, pero no se pudo enviar la notificación: ' + e.message); }
    }
  } catch (e) { avisar(e.message); }
});
$('#btn-ticket-eliminar').addEventListener('click', async () => {
  if (!(await confirmar('¿Eliminar este ticket?', { peligro: true, textoOk: 'Eliminar' }))) return;
  try { await api(`/api/tickets/${$('#ticket-id').value}`, { method: 'DELETE' }); $('#modal-ticket').close(); await cargarPanelTickets(); }
  catch (e) { avisar(e.message); }
});

// ---------- Modal Ver Ticket ----------

let _verTicketActual = null;
function _vtFmtDt(iso) {
  if (!iso) return '—';
  const d = new Date(iso); const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function _vtInitials(nombre) { if (!nombre) return '?'; return nombre.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase(); }
function _vtRenderTimeline(ticket, logs) {
  const events = [{ tipo: 'creacion', cuando: ticket.creado_en, quien: ticket.asignado_por || '—', texto: `Ticket creado en estado <strong>${escapeHtml(ticket.estado)}</strong>` }];
  logs.forEach(l => {
    if (l.campo === 'nota') events.push({ tipo: 'nota', cuando: l.creado_en, quien: l.usuario, texto: escapeHtml(l.valor_nuevo) });
    else if (l.campo === 'estado') events.push({ tipo: 'estado', cuando: l.creado_en, quien: l.usuario, color: TICKET_COLORES[l.valor_nuevo] || '#94a3b8', texto: escapeHtml(l.valor_nuevo) });
    else {
      const LABELS = { tecnico_asignado: 'Técnico', fecha_estimada: 'F. estimada', descripcion: 'Descripción', solucion: 'Solución', coste: 'Coste' };
      const label = LABELS[l.campo] || l.campo;
      events.push({ tipo: 'cambio', cuando: l.creado_en, quien: l.usuario, texto: `${label}: ${l.valor_anterior ? escapeHtml(l.valor_anterior) : '<em>vacío</em>'} → ${l.valor_nuevo ? escapeHtml(l.valor_nuevo) : '<em>vacío</em>'}` });
    }
  });
  return events.map(ev => {
    let dotHtml, bodyHtml;
    if (ev.tipo === 'creacion') { dotHtml = `<div class="vt-event-dot" style="background:#6366f1;color:#fff">${_vtInitials(ev.quien)}</div>`; bodyHtml = `<div class="vt-event-title">${ev.texto}</div>`; }
    else if (ev.tipo === 'estado') { dotHtml = `<div class="vt-event-dot" style="background:${ev.color};color:#fff">${_vtInitials(ev.quien)}</div>`; bodyHtml = `<div class="vt-event-title">→ <strong style="color:${ev.color}">${ev.texto}</strong></div>`; }
    else if (ev.tipo === 'nota') { dotHtml = `<div class="vt-event-dot" style="background:#f59e0b;color:#fff">✎</div>`; bodyHtml = `<div class="vt-event-note">${ev.texto}</div>`; }
    else { dotHtml = `<div class="vt-event-dot" style="background:var(--muted);color:#fff;font-size:0.65rem">✎</div>`; bodyHtml = `<div class="vt-event-title">${ev.texto}</div>`; }
    return `<div class="vt-event">${dotHtml}<div class="vt-event-body">${bodyHtml}<div class="vt-event-who">${escapeHtml(ev.quien || '—')} · ${_vtFmtDt(ev.cuando)}</div></div></div>`;
  }).join('');
}
function _vtCargarTimeline(ticket) {
  const tl = $('#vt-timeline');
  tl.innerHTML = '<div class="vt-loading">Cargando actividad…</div>';
  api(`/api/tickets/${ticket.id}/log`).then(logs => { tl.innerHTML = _vtRenderTimeline(ticket, logs || []); tl.scrollTop = tl.scrollHeight; })
    .catch(() => { tl.innerHTML = '<div class="vt-loading">Error al cargar.</div>'; });
}
function abrirVerTicket(ticket) {
  _verTicketActual = ticket;
  const color = TICKET_COLORES[ticket.estado] || '#94a3b8';
  $('#vt-numero').textContent = ticket.numero;
  const pill = $('#vt-pill');
  pill.textContent = ticket.estado;
  pill.style.cssText = `background:${color}22;color:${pillTextColor(color)};border:1px solid ${color}55`;
  const eq = ticket.equipo;
  const eqDesc = [eq?.nombre ? escapeHtml(eq.nombre) : '<em>Incidencia general</em>', eq?.tipo ? `<span style="color:var(--muted)">(${escapeHtml(eq.tipo)})</span>` : '', eq?.cliente_nombre ? `· ${escapeHtml(eq.cliente_nombre)}` : ''].filter(Boolean).join(' ');
  $('#vt-equipo').innerHTML = eqDesc || '<em style="color:var(--muted)">Sin equipo</em>';
  const meta = [ticket.tecnico_asignado ? escapeHtml(ticket.tecnico_asignado) : '<span style="color:#f59e0b;font-weight:600">Sin asignar</span>', ticket.fecha_entrada ? `Entrada: ${fmtFecha(ticket.fecha_entrada)}` : null, ticket.fecha_estimada ? `Est. ${fmtFecha(ticket.fecha_estimada)}` : null, ticket.coste != null ? `${Number(ticket.coste).toFixed(2)} €` : null].filter(Boolean).join(' · ');
  $('#vt-meta').innerHTML = meta;
  const envio = $('#vt-envio');
  if (ticket.numero_seguimiento) { envio.innerHTML = `Envío: ${ticket.transportista ? escapeHtml(ticket.transportista) + ' · ' : ''}<strong>${escapeHtml(ticket.numero_seguimiento)}</strong>`; envio.classList.remove('hidden'); }
  else { envio.classList.add('hidden'); envio.innerHTML = ''; }
  $('#vt-nuevo-estado').innerHTML = TICKET_ESTADOS.map(e => `<option value="${escapeHtml(e)}"${e === ticket.estado ? ' selected' : ''}>${escapeHtml(e)}</option>`).join('');
  $('#vt-nota-input').value = ''; $('#vt-estado-comentario').value = '';
  $('#modal-ver-ticket').showModal();
  _vtCargarTimeline(ticket);
}
$('#btn-vt-cerrar').addEventListener('click', () => $('#modal-ver-ticket').close());
$('#btn-vt-nota').addEventListener('click', async () => {
  const ticket = _verTicketActual; if (!ticket) return;
  const input = $('#vt-nota-input'); const nota = input.value.trim(); if (!nota) return;
  const btn = $('#btn-vt-nota'); btn.disabled = true;
  try { await api(`/api/tickets/${ticket.id}/nota`, { method: 'POST', body: JSON.stringify({ nota }) }); input.value = ''; _vtCargarTimeline(ticket); }
  catch (e) { avisar(e.message); }
  btn.disabled = false;
});
$('#btn-vt-cambiar-estado').addEventListener('click', async () => {
  const ticket = _verTicketActual; if (!ticket) return;
  const nuevoEstado = $('#vt-nuevo-estado').value, comentario = $('#vt-estado-comentario').value.trim();
  if (nuevoEstado === ticket.estado && !comentario) return;
  const btn = $('#btn-vt-cambiar-estado'); btn.disabled = true;
  try {
    if (nuevoEstado !== ticket.estado) {
      await api(`/api/tickets/${ticket.id}`, { method: 'PUT', body: JSON.stringify({ ...ticket, estado: nuevoEstado }) });
      _verTicketActual = { ...ticket, estado: nuevoEstado };
      const color = TICKET_COLORES[nuevoEstado] || '#94a3b8';
      const pill = $('#vt-pill'); pill.textContent = nuevoEstado; pill.style.cssText = `background:${color}22;color:${pillTextColor(color)};border:1px solid ${color}55`;
    }
    if (comentario) { await api(`/api/tickets/${ticket.id}/nota`, { method: 'POST', body: JSON.stringify({ nota: comentario }) }); $('#vt-estado-comentario').value = ''; }
    _vtCargarTimeline(_verTicketActual);
    await cargarPanelTickets();
    actualizarBadgeTickets();
  } catch (e) { avisar(e.message); }
  btn.disabled = false;
});
$('#btn-vt-notificar').addEventListener('click', async () => {
  const ticket = _verTicketActual; if (!ticket) return;
  const btn = $('#btn-vt-notificar'); btn.disabled = true; btn.textContent = 'Enviando…';
  try { await api(`/api/tickets/${ticket.id}/notificar`, { method: 'POST', body: JSON.stringify({ asignado_por: state.usuario?.nombre }) }); btn.textContent = '✓ Enviado'; setTimeout(() => { btn.textContent = 'Notificar'; btn.disabled = false; }, 2500); }
  catch (e) { avisar(e.message); btn.textContent = 'Notificar'; btn.disabled = false; }
});
$('#btn-vt-editar').addEventListener('click', async () => {
  $('#modal-ver-ticket').close();
  const ticket = _verTicketActual; if (!ticket) return;
  if (!ticket.equipo_id && ticket.cliente_id) abrirModalTicketCliente(ticket.equipo || { id: ticket.cliente_id, nombre: ticket.equipo?.cliente_nombre }, ticket);
  else { const eq = ticket?.equipo || await api(`/api/equipos/${ticket.equipo_id}`); abrirModalTicket(eq, ticket); }
});

// ---------- Listado / filtros ----------

let _panelTicketsFiltro = 'mios', _panelTicketsEstado = '', _panelTicketsBusqueda = '', _panelTicketsFechaDesde = '', _panelTicketsFechaHasta = '';

async function cargarPanelTickets() {
  const params = new URLSearchParams();
  if (_panelTicketsEstado) params.set('estado', _panelTicketsEstado);
  if (_panelTicketsFiltro === 'mios' && state.usuario?.nombre) params.set('tecnico', state.usuario.nombre);
  if (_panelTicketsFiltro === 'sin-asignar') params.set('tecnico', '');
  if (_panelTicketsBusqueda) params.set('q', _panelTicketsBusqueda);
  if (_panelTicketsFechaDesde) params.set('fecha_desde', _panelTicketsFechaDesde);
  if (_panelTicketsFechaHasta) params.set('fecha_hasta', _panelTicketsFechaHasta);
  let tickets = await api(`/api/tickets?${params}`);
  if (_panelTicketsFiltro === 'sin-asignar') tickets = tickets.filter(t => !t.tecnico_asignado);
  renderPanelTickets(tickets);
}

function renderPanelTickets(tickets) {
  const cont = $('#tickets-lista');
  if (tickets.length === 0) { cont.innerHTML = '<p class="muted" style="padding:24px">No hay tickets con estos filtros.</p>'; return; }
  const cards = tickets.map(t => {
    const color = TICKET_COLORES[t.estado] || '#94a3b8';
    const sinAsignar = !t.tecnico_asignado;
    const eqNombre = t.equipo?.nombre ? escapeHtml(t.equipo.nombre) : '<em style="color:var(--muted);font-size:0.82rem">Incidencia general</em>';
    const cliente = t.equipo?.cliente_nombre ? escapeHtml(t.equipo.cliente_nombre) : '';
    const miniTl = (t.estado_log && t.estado_log.length > 0)
      ? t.estado_log.map(s => `<span class="tk-mts-dot" style="background:${TICKET_COLORES[s.estado] || '#94a3b8'}" title="${escapeHtml(s.estado)}"></span>`).join('<span class="tk-mts-line"></span>')
      : `<span class="tk-mts-dot" style="background:${color}" title="${escapeHtml(t.estado)}"></span>`;
    return `<div class="tk-card" data-tid="${t.id}">
      <div class="tk-card-head">
        <span class="tk-card-num">${escapeHtml(t.numero)}</span>
        <span class="tk-estado-pill" style="--tc:${color};--tct:${pillTextColor(color)}">${escapeHtml(t.estado)}</span>
        <div class="tk-card-actions">
          ${sinAsignar ? `<button class="btn btn-small btn-ok" data-tk-asignarme="${t.id}">Asignarme</button>` : ''}
          <button class="btn btn-small" data-tk-editar="${t.id}" data-eid="${t.equipo_id}">Editar</button>
        </div>
      </div>
      <div class="tk-card-equipo">${eqNombre}${t.equipo?.tipo ? `<span class="tk-card-tipo">${escapeHtml(t.equipo.tipo)}</span>` : ''}</div>
      ${cliente ? `<div class="tk-card-meta">${cliente}</div>` : ''}
      <div class="tk-card-meta">
        ${t.tecnico_asignado ? escapeHtml(t.tecnico_asignado) : '<span style="color:#f59e0b;font-weight:600">Sin asignar</span>'}
        ${t.fecha_estimada ? ` · Est. ${fmtFecha(t.fecha_estimada)}` : ''}
        ${t.coste != null ? ` · ${Number(t.coste).toFixed(2)} €` : ''}
      </div>
      <div class="tk-mini-tl">${miniTl}</div>
    </div>`;
  }).join('');
  cont.innerHTML = `<div class="tk-cards">${cards}</div>`;
  cont.querySelectorAll('.tk-card').forEach(card => card.addEventListener('click', e => {
    if (e.target.closest('button')) return;
    const ticket = tickets.find(t => String(t.id) === card.dataset.tid);
    if (ticket) abrirVerTicket(ticket);
  }));
  cont.querySelectorAll('[data-tk-editar]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    const ticket = tickets.find(t => String(t.id) === btn.dataset.tkEditar);
    if (ticket && !ticket.equipo_id && ticket.cliente_id) abrirModalTicketCliente(ticket.equipo || { id: ticket.cliente_id, nombre: ticket.equipo?.cliente_nombre }, ticket);
    else { const eq = ticket?.equipo || await api(`/api/equipos/${btn.dataset.eid}`); abrirModalTicket(eq, ticket); }
  }));
  cont.querySelectorAll('[data-tk-asignarme]').forEach(btn => btn.addEventListener('click', async e => {
    e.stopPropagation();
    try {
      const t = tickets.find(x => String(x.id) === btn.dataset.tkAsignarme);
      await api(`/api/tickets/${btn.dataset.tkAsignarme}`, { method: 'PUT', body: JSON.stringify({ ...t, tecnico_asignado: state.usuario.nombre }) });
      await cargarPanelTickets();
      actualizarBadgeTickets();
    } catch (e) { avisar(e.message); }
  }));
}

document.querySelectorAll('.tk-filtro').forEach(btn => btn.addEventListener('click', () => {
  document.querySelectorAll('.tk-filtro').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _panelTicketsFiltro = btn.dataset.filtro;
  cargarPanelTickets();
}));
$('#tk-filtro-estado').addEventListener('change', e => { _panelTicketsEstado = e.target.value; cargarPanelTickets(); });
let _tkBusqTimer;
$('#tk-busqueda').addEventListener('input', e => { clearTimeout(_tkBusqTimer); _tkBusqTimer = setTimeout(() => { _panelTicketsBusqueda = e.target.value.trim(); cargarPanelTickets(); }, 300); });
$('#tk-fecha-desde').addEventListener('change', e => { _panelTicketsFechaDesde = e.target.value; cargarPanelTickets(); });
$('#tk-fecha-hasta').addEventListener('change', e => { _panelTicketsFechaHasta = e.target.value; cargarPanelTickets(); });

// ---------- Informe de tickets por email ----------

$('#btn-informe-tickets').addEventListener('click', () => {
  $('#informe-cliente-id').innerHTML = '<option value="">— Selecciona —</option>' + state.clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
  $('#informe-filtro').value = 'activos';
  $('#informe-cliente-row').classList.add('hidden');
  $('#informe-email-to').value = ''; $('#informe-asunto').value = '';
  $('#informe-status').classList.add('hidden');
  $('#modal-informe-tickets').showModal();
});
$('#informe-filtro').addEventListener('change', e => { $('#informe-cliente-row').classList.toggle('hidden', e.target.value !== 'cliente'); });
$('#btn-informe-cancelar').addEventListener('click', () => $('#modal-informe-tickets').close());
$('#form-informe-tickets').addEventListener('submit', async e => {
  e.preventDefault();
  const st = $('#informe-status');
  const filtro = $('#informe-filtro').value, cliente_id = $('#informe-cliente-id').value, to = $('#informe-email-to').value.trim(), asunto = $('#informe-asunto').value.trim();
  if (filtro === 'cliente' && !cliente_id) { avisar('Selecciona un cliente.'); return; }
  const submitBtn = e.target.querySelector('[type="submit"]');
  submitBtn.disabled = true; st.textContent = 'Enviando…'; st.style.color = '#64748b'; st.classList.remove('hidden');
  try {
    const r = await api('/api/tickets/enviar-informe', { method: 'POST', body: JSON.stringify({ to, filtro, cliente_id: cliente_id || undefined, asunto: asunto || undefined }) });
    st.textContent = `✓ Informe enviado (${r.total} ticket${r.total !== 1 ? 's' : ''})`; st.style.color = '#15803d';
    setTimeout(() => $('#modal-informe-tickets').close(), 1800);
  } catch (err) { st.textContent = '✗ Error: ' + err.message; st.style.color = '#dc2626'; }
  finally { submitBtn.disabled = false; }
});

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();
  await cargarConfig();
  await cargarClientes();
  actualizarBadgeTickets();
  await cargarPanelTickets();
}
iniciar();
