/**
 * configuracion.js — Panel de Configuración (/configuracion). Autocontenida
 * (ver docs/01-arquitectura.md): incluye su propia copia de los
 * helpers/topbar comunes a todas las páginas.
 */

const $ = sel => document.querySelector(sel);
const state = { config: {}, usuario: null };

const LISTA_DEFAULTS = {
  tecnicos: [],
  tipos_intervencion: ['Reparación', 'Mantenimiento preventivo', 'Actualización de software', 'Limpieza', 'Sustitución de componente', 'Diagnóstico', 'Configuración', 'Entrega', 'Otro'],
  categorias_archivo: ['Factura', 'Albarán', 'Presupuesto', 'Manual', 'Garantía', 'Informe', 'Contrato', 'Otro'],
  tipos_equipo: ['PC', 'TPV', 'Periférico', 'Tablet', 'Otro'],
  lista_software: [],
  tipos_credencial: ['Windows', 'BIOS', 'SAP', 'Email', 'VPN', 'Administrador', 'Otro'],
  transportistas: ['MRW', 'Celeritas', 'SEUR', 'Otro'],
  programas_licencia: ['Microsoft Office', 'Kaspersky', 'Otro'],
  categorias_inventario: ['Cables', 'Redes', 'Almacenamiento', 'Componentes PC', 'Adaptadores y conectores', 'Alimentación', 'Periféricos', 'Monitores', 'TPV', 'Tablets', 'Equipos completos', 'Consumibles impresión', 'Pilas y baterías', 'Consumibles', 'Otro'],
};

function escapeHtml(str) { const div = document.createElement('div'); div.textContent = str; return div.innerHTML; }

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

// ---------- Estados de ticket (compartido con Tickets) ----------

const DEFAULT_TICKET_ESTADOS_OBJ = [
  { nombre: 'Pendiente', color: '#94a3b8' }, { nombre: 'Diagnóstico', color: '#3b82f6' }, { nombre: 'En reparación', color: '#f59e0b' },
  { nombre: 'Esperando piezas', color: '#a855f7' }, { nombre: 'Listo', color: '#22c55e' }, { nombre: 'Entregado', color: '#10b981' }, { nombre: 'Cerrado', color: '#64748b' },
];
function aplicarEstadosTicket() {}

// ---------- Configuración: carga y listas genéricas ----------

async function cargarConfig() {
  const raw = await api('/api/config');
  state.config = {
    fra_orig: raw.fra_orig || '', cli: raw.cli || '',
    tecnicos: raw.tecnicos ? JSON.parse(raw.tecnicos) : [...LISTA_DEFAULTS.tecnicos],
    tipos_intervencion: raw.tipos_intervencion ? JSON.parse(raw.tipos_intervencion) : [...LISTA_DEFAULTS.tipos_intervencion],
    categorias_archivo: raw.categorias_archivo ? JSON.parse(raw.categorias_archivo) : [...LISTA_DEFAULTS.categorias_archivo],
    tipos_equipo: raw.tipos_equipo ? JSON.parse(raw.tipos_equipo) : [...LISTA_DEFAULTS.tipos_equipo],
    lista_software: raw.lista_software ? JSON.parse(raw.lista_software) : [...LISTA_DEFAULTS.lista_software],
    tipos_credencial: raw.tipos_credencial ? JSON.parse(raw.tipos_credencial) : [...LISTA_DEFAULTS.tipos_credencial],
    transportistas: raw.transportistas ? JSON.parse(raw.transportistas) : [...LISTA_DEFAULTS.transportistas],
    programas_licencia: raw.programas_licencia ? JSON.parse(raw.programas_licencia) : [...LISTA_DEFAULTS.programas_licencia],
    categorias_inventario: raw.categorias_inventario ? JSON.parse(raw.categorias_inventario) : [...LISTA_DEFAULTS.categorias_inventario],
    impresora_envio: raw.impresora_envio || '', impresora_etiqueta: raw.impresora_etiqueta || '', impresora_informe: raw.impresora_informe || '',
    nombre_taller: raw.nombre_taller || '', smtp_host: raw.smtp_host || '', smtp_port: raw.smtp_port || '587',
    smtp_user: raw.smtp_user || '', smtp_pass: raw.smtp_pass || '', smtp_from: raw.smtp_from || '',
    smtp_secure: raw.smtp_secure || '0', correo_recuperacion: raw.correo_recuperacion || '',
  };
  state.config.ticket_estados = raw.ticket_estados ? JSON.parse(raw.ticket_estados) : DEFAULT_TICKET_ESTADOS_OBJ;
}
async function guardarListaConfig(key) { await api('/api/config', { method: 'PUT', body: JSON.stringify({ [key]: JSON.stringify(state.config[key]) }) }); }

function renderConfigLista(containerId, key) {
  const lista = state.config[key] || [];
  document.getElementById(containerId).innerHTML = lista.map((item, i) => `<div class="config-lista-item"><span>${escapeHtml(item)}</span><button type="button" class="config-lista-del" data-key="${key}" data-idx="${i}" title="Eliminar">×</button></div>`).join('') || '<p class="config-lista-vacia">Sin elementos</p>';
}
function renderTodasListas() {
  renderConfigLista('config-lista-tecnicos', 'tecnicos');
  renderConfigLista('config-lista-intervencion', 'tipos_intervencion');
  renderConfigLista('config-lista-archivo', 'categorias_archivo');
  renderConfigLista('config-lista-equipo', 'tipos_equipo');
  renderConfigLista('config-lista-software', 'lista_software');
  renderConfigLista('config-lista-credencial', 'tipos_credencial');
  renderConfigLista('config-lista-inventario', 'categorias_inventario');
  renderConfigLista('config-lista-transportistas', 'transportistas');
  renderConfigLista('config-lista-programas-licencia', 'programas_licencia');
}
function containerIdParaLista(key) {
  return key === 'tecnicos' ? 'config-lista-tecnicos' :
    key === 'tipos_intervencion' ? 'config-lista-intervencion' :
    key === 'categorias_archivo' ? 'config-lista-archivo' :
    key === 'lista_software' ? 'config-lista-software' :
    key === 'tipos_credencial' ? 'config-lista-credencial' :
    key === 'categorias_inventario' ? 'config-lista-inventario' :
    key === 'transportistas' ? 'config-lista-transportistas' :
    key === 'programas_licencia' ? 'config-lista-programas-licencia' : 'config-lista-equipo';
}

document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const pane = tab.dataset.pane;
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.settings-pane').forEach(p => p.classList.toggle('hidden', p.id !== `settings-pane-${pane}`));
    tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    if (pane === 'estados-ticket') { _editEstados = (state.config.ticket_estados || DEFAULT_TICKET_ESTADOS_OBJ).map(e => ({ ...e })); renderEstadosTicketPane(); }
    if (pane === 'correo') {
      const cfg = state.config;
      $('#input-smtp-nombre-taller').value = cfg.nombre_taller || '';
      $('#input-smtp-host').value = cfg.smtp_host || '';
      $('#input-smtp-port').value = cfg.smtp_port || '587';
      $('#input-smtp-user').value = cfg.smtp_user || '';
      $('#input-smtp-pass').value = cfg.smtp_pass || '';
      $('#input-smtp-from').value = cfg.smtp_from || '';
      $('#input-smtp-secure').checked = cfg.smtp_secure === '1';
      $('#input-correo-recuperacion').value = cfg.correo_recuperacion || '';
    }
    if (pane === 'usuarios') cargarUsuarios();
    if (pane === 'plantillas') renderPlantillasSettings();
  });
});

$('#btn-guardar-config-general').addEventListener('click', async () => {
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({ fra_orig: $('#input-config-fra-orig').value.trim(), cli: $('#input-config-cli').value.trim() }) });
    state.config.fra_orig = $('#input-config-fra-orig').value.trim();
    state.config.cli = $('#input-config-cli').value.trim();
    const btn = $('#btn-guardar-config-general'); const orig = btn.textContent;
    btn.textContent = '✓ Guardado'; setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (e) { avisar(e.message); }
});

$('#btn-guardar-impresoras').addEventListener('click', async () => {
  try {
    const vals = { impresora_envio: $('#input-imp-envio').value.trim(), impresora_etiqueta: $('#input-imp-etiqueta').value.trim(), impresora_informe: $('#input-imp-informe').value.trim() };
    await api('/api/config', { method: 'PUT', body: JSON.stringify(vals) });
    Object.assign(state.config, vals);
    const btn = $('#btn-guardar-impresoras'); const orig = btn.textContent;
    btn.textContent = '✓ Guardado'; setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (e) { avisar(e.message); }
});
$('#btn-listar-imp').addEventListener('click', async () => {
  const cont = document.getElementById('imp-lista-disponibles');
  cont.innerHTML = 'Detectando...'; cont.classList.remove('hidden');
  try {
    const lista = await api('/api/impresoras');
    if (!lista.length) { cont.innerHTML = '<em>No se detectaron impresoras</em>'; return; }
    cont.innerHTML = lista.map(n => `<button type="button" class="btn btn-small imp-pick" data-nombre="${escapeHtml(n)}">${escapeHtml(n)}</button>`).join('');
  } catch { cont.innerHTML = '<em>Error al detectar impresoras</em>'; }
});
document.getElementById('imp-lista-disponibles').addEventListener('click', e => {
  const btn = e.target.closest('.imp-pick'); if (!btn) return;
  const nombre = btn.dataset.nombre;
  const focused = ['input-imp-envio', 'input-imp-etiqueta', 'input-imp-informe'].map(id => document.getElementById(id)).find(el => document.activeElement === el);
  if (focused) { focused.value = nombre; return; }
  const primeroVacio = ['input-imp-envio', 'input-imp-etiqueta', 'input-imp-informe'].map(id => document.getElementById(id)).find(el => !el.value);
  if (primeroVacio) primeroVacio.value = nombre; else $('#input-imp-envio').value = nombre;
});

// ---------- Correo SMTP ----------

async function guardarConfigSmtp() {
  const payload = {
    nombre_taller: $('#input-smtp-nombre-taller').value.trim(), smtp_host: $('#input-smtp-host').value.trim(),
    smtp_port: $('#input-smtp-port').value.trim() || '587', smtp_user: $('#input-smtp-user').value.trim(),
    smtp_pass: $('#input-smtp-pass').value, smtp_from: $('#input-smtp-from').value.trim(),
    smtp_secure: $('#input-smtp-secure').checked ? '1' : '0', correo_recuperacion: $('#input-correo-recuperacion').value.trim(),
  };
  await api('/api/config', { method: 'PUT', body: JSON.stringify(payload) });
  Object.assign(state.config, payload);
}
$('#btn-guardar-smtp').addEventListener('click', async () => {
  try {
    await guardarConfigSmtp();
    const st = $('#smtp-status');
    st.textContent = '✓ Configuración guardada'; st.style.color = '#16a34a'; st.classList.remove('hidden');
    setTimeout(() => st.classList.add('hidden'), 3000);
  } catch (e) { avisar(e.message); }
});
$('#btn-smtp-test').addEventListener('click', async () => {
  const to = $('#input-smtp-test-to').value.trim();
  if (!to) { avisar('Introduce un email de prueba'); return; }
  const st = $('#smtp-status');
  st.textContent = 'Guardando y enviando…'; st.style.color = '#64748b'; st.classList.remove('hidden');
  try {
    await guardarConfigSmtp();
    await api('/api/email/test', { method: 'POST', body: JSON.stringify({ to }) });
    st.textContent = '✓ Email de prueba enviado a ' + to; st.style.color = '#16a34a';
  } catch (e) { st.textContent = '✗ Error: ' + e.message; st.style.color = '#ef4444'; }
});

// ---------- Estados de ticket (editor) ----------

let _editEstados = [];
function renderEstadosTicketPane() {
  const cont = document.getElementById('estados-ticket-lista'); if (!cont) return;
  cont.innerHTML = '';
  _editEstados.forEach((est, i) => {
    const row = document.createElement('div'); row.className = 'estado-tk-row';
    row.innerHTML = `<span class="estado-tk-dot" style="background:${est.color}"></span><span class="estado-tk-nombre">${escapeHtml(est.nombre)}</span><input type="color" value="${est.color}" class="color-picker-inline estado-color-pick" data-idx="${i}" title="Cambiar color"><button type="button" class="estado-tk-del" data-idx="${i}" title="Eliminar">×</button>`;
    cont.appendChild(row);
  });
  cont.querySelectorAll('.estado-color-pick').forEach(inp => inp.addEventListener('input', e => {
    _editEstados[Number(e.target.dataset.idx)].color = e.target.value;
    cont.querySelectorAll('.estado-tk-dot')[Number(e.target.dataset.idx)].style.background = e.target.value;
  }));
  cont.querySelectorAll('.estado-tk-del').forEach(btn => btn.addEventListener('click', e => { _editEstados.splice(Number(e.currentTarget.dataset.idx), 1); renderEstadosTicketPane(); }));
}
$('#btn-add-estado-ticket').addEventListener('click', () => {
  const nombre = $('#input-new-estado-nombre').value.trim(), color = $('#input-new-estado-color').value;
  if (!nombre) return;
  if (_editEstados.some(e => e.nombre === nombre)) { avisar('Ya existe ese estado.'); return; }
  _editEstados.push({ nombre, color });
  $('#input-new-estado-nombre').value = '';
  renderEstadosTicketPane();
});
$('#btn-guardar-estados-ticket').addEventListener('click', async () => {
  if (!_editEstados.length) { avisar('Debe haber al menos un estado.'); return; }
  try {
    await api('/api/config', { method: 'PUT', body: JSON.stringify({ ticket_estados: JSON.stringify(_editEstados) }) });
    state.config.ticket_estados = [..._editEstados];
    const btn = $('#btn-guardar-estados-ticket'); const orig = btn.textContent;
    btn.textContent = '✓ Guardado'; setTimeout(() => { btn.textContent = orig; }, 1500);
  } catch (e) { avisar(e.message); }
});

// ---------- Listas genéricas: añadir / eliminar ----------

document.querySelectorAll('[data-add-lista]').forEach(btn => {
  btn.addEventListener('click', async () => {
    const key = btn.dataset.addLista;
    const input = document.getElementById(btn.dataset.input);
    const val = input.value.trim();
    if (!val || state.config[key].includes(val)) return;
    state.config[key].push(val);
    await guardarListaConfig(key);
    renderConfigLista(containerIdParaLista(key), key);
    input.value = '';
  });
});
document.getElementById('settings-panel').addEventListener('click', async e => {
  const btn = e.target.closest('.config-lista-del'); if (!btn) return;
  const key = btn.dataset.key, idx = Number(btn.dataset.idx);
  state.config[key].splice(idx, 1);
  await guardarListaConfig(key);
  renderConfigLista(containerIdParaLista(key), key);
});

// ---------- Usuarios (admin) ----------

async function cargarUsuarios() {
  const lista = await api('/api/usuarios');
  const cont = $('#usuarios-lista');
  if (lista.length === 0) { cont.innerHTML = '<p class="muted">Sin usuarios.</p>'; return; }
  cont.innerHTML = `<table class="componentes-table"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>
    ${lista.map(u => `<tr>
      <td>${escapeHtml(u.nombre)}</td><td>${escapeHtml(u.username)}</td>
      <td><span class="badge ${u.rol === 'admin' ? 'badge-ok' : 'badge-neutral'}">${u.rol}</span></td>
      <td><span class="badge ${u.activo ? 'badge-ok' : 'badge-warn'}">${u.activo ? 'Activo' : 'Inactivo'}</span></td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn btn-small" data-pass-usr="${u.id}" data-pass-nombre="${escapeHtml(u.nombre)}" data-pass-email="${escapeHtml(u.email || '')}">Perfil</button>
        ${u.id !== state.usuario?.id ? `<button class="btn btn-small btn-danger" data-del-usr="${u.id}">Desactivar</button>` : '<span class="muted" style="line-height:28px">yo</span>'}
      </td>
    </tr>`).join('')}
  </tbody></table>`;
  cont.querySelectorAll('[data-del-usr]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await confirmar('¿Desactivar este usuario?', { peligro: true, textoOk: 'Desactivar' }))) return;
    try { await api(`/api/usuarios/${btn.dataset.delUsr}`, { method: 'DELETE' }); await cargarUsuarios(); } catch (e) { avisar(e.message); }
  }));
  cont.querySelectorAll('[data-pass-usr]').forEach(btn => btn.addEventListener('click', () => {
    const esPropio = String(btn.dataset.passUsr) === String(state.usuario?.id);
    $('#cambiar-pass-uid').value = btn.dataset.passUsr;
    $('#cambiar-pass-titulo').textContent = esPropio ? 'Mi perfil' : `Perfil — ${btn.dataset.passNombre}`;
    $('#cambiar-pass-usuario').textContent = esPropio ? '' : `Usuario: ${btn.dataset.passNombre}`;
    $('#input-perfil-email').value = btn.dataset.passEmail || '';
    $('#input-cambiar-pass').value = '';
    $('#modal-cambiar-pass').showModal();
  }));
}
$('#btn-nuevo-usuario').addEventListener('click', () => {
  $('#input-usr-nombre').value = ''; $('#input-usr-username').value = ''; $('#input-usr-password').value = ''; $('#input-usr-rol').value = 'tecnico';
  $('#modal-nuevo-usuario').showModal();
});
$('#btn-usr-cancelar').addEventListener('click', () => $('#modal-nuevo-usuario').close());
$('#btn-usr-guardar').addEventListener('click', async () => {
  try {
    await api('/api/usuarios', { method: 'POST', body: JSON.stringify({ nombre: $('#input-usr-nombre').value.trim(), username: $('#input-usr-username').value.trim(), password: $('#input-usr-password').value, rol: $('#input-usr-rol').value }) });
    $('#modal-nuevo-usuario').close();
    await cargarUsuarios();
  } catch (e) { avisar(e.message); }
});
$('#btn-cambiar-mi-password').addEventListener('click', async () => {
  const pass = $('#input-mi-password').value;
  if (!pass || pass.length < 4) { avisar('Mínimo 4 caracteres'); return; }
  try {
    await api(`/api/usuarios/${state.usuario.id}/password`, { method: 'PUT', body: JSON.stringify({ password: pass }) });
    $('#input-mi-password').value = '';
    avisar('Contraseña actualizada');
  } catch (e) { avisar(e.message); }
});

// ---------- Plantillas de intervención ----------

let _plantillas = [];
async function cargarPlantillas() { try { _plantillas = await api('/api/plantillas'); } catch { _plantillas = []; } }
async function renderPlantillasSettings() {
  await cargarPlantillas();
  const cont = $('#plantillas-lista');
  if (_plantillas.length === 0) { cont.innerHTML = '<p class="muted">Sin plantillas.</p>'; return; }
  cont.innerHTML = _plantillas.map(p => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--bg);border-radius:8px">
      <div style="flex:1;min-width:0">
        <div style="font-weight:600;font-size:0.88rem">${escapeHtml(p.nombre)}${p.tipo ? ` <span class="badge badge-neutral" style="font-size:0.72rem">${escapeHtml(p.tipo)}</span>` : ''}</div>
        <div style="font-size:0.8rem;color:var(--muted);margin-top:2px;white-space:pre-wrap">${escapeHtml(p.contenido.slice(0, 100))}${p.contenido.length > 100 ? '…' : ''}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        <button class="btn btn-small" data-plt-edit="${p.id}">Editar</button>
        <button class="btn btn-small btn-danger" data-plt-del="${p.id}">Eliminar</button>
      </div>
    </div>
  `).join('');
  cont.querySelectorAll('[data-plt-del]').forEach(btn => btn.addEventListener('click', async () => {
    if (!(await confirmar('¿Eliminar esta plantilla?', { peligro: true, textoOk: 'Eliminar' }))) return;
    try { await api(`/api/plantillas/${btn.dataset.pltDel}`, { method: 'DELETE' }); await renderPlantillasSettings(); } catch (e) { avisar(e.message); }
  }));
  cont.querySelectorAll('[data-plt-edit]').forEach(btn => btn.addEventListener('click', () => {
    const p = _plantillas.find(x => String(x.id) === btn.dataset.pltEdit); if (!p) return;
    $('#input-plantilla-nombre').value = p.nombre;
    $('#input-plantilla-tipo').value = p.tipo || '';
    $('#input-plantilla-contenido').value = p.contenido;
    $('#btn-guardar-plantilla').dataset.editId = p.id;
  }));
}
$('#btn-guardar-plantilla').addEventListener('click', async () => {
  const editId = $('#btn-guardar-plantilla').dataset.editId;
  const payload = { nombre: $('#input-plantilla-nombre').value.trim(), tipo: $('#input-plantilla-tipo').value.trim() || null, contenido: $('#input-plantilla-contenido').value.trim() };
  if (!payload.nombre || !payload.contenido) { avisar('Nombre y contenido son obligatorios'); return; }
  try {
    if (editId) { await api(`/api/plantillas/${editId}`, { method: 'PUT', body: JSON.stringify(payload) }); delete $('#btn-guardar-plantilla').dataset.editId; }
    else await api('/api/plantillas', { method: 'POST', body: JSON.stringify(payload) });
    $('#input-plantilla-nombre').value = ''; $('#input-plantilla-tipo').value = ''; $('#input-plantilla-contenido').value = '';
    await renderPlantillasSettings();
  } catch (e) { avisar(e.message); }
});

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();
  await cargarConfig();
  actualizarBadgeTickets();

  $('#input-config-fra-orig').value = state.config.fra_orig;
  $('#input-config-cli').value = state.config.cli;
  $('#input-imp-envio').value = state.config.impresora_envio;
  $('#input-imp-etiqueta').value = state.config.impresora_etiqueta;
  $('#input-imp-informe').value = state.config.impresora_informe;

  const esAdmin = state.usuario?.rol === 'admin';
  document.querySelectorAll('.settings-tab.admin-only, .settings-nav-group.admin-only').forEach(el => { el.style.display = esAdmin ? '' : 'none'; });
  if (!esAdmin) document.querySelector('.settings-tab:not(.admin-only)')?.click();

  renderTodasListas();
}
iniciar();
