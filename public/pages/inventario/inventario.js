/**
 * inventario.js — Panel de Inventario (/inventario). Autocontenida (ver
 * docs/01-arquitectura.md): incluye su propia copia de los helpers/topbar
 * comunes a todas las páginas.
 */

const $ = sel => document.querySelector(sel);
const state = { config: {}, usuario: null };
const LISTA_DEFAULTS = { categorias_inventario: ['Cables', 'Redes', 'Almacenamiento', 'Componentes PC', 'Adaptadores y conectores', 'Alimentación', 'Periféricos', 'Monitores', 'TPV', 'Tablets', 'Equipos completos', 'Consumibles impresión', 'Pilas y baterías', 'Consumibles', 'Otro'] };

const IC = {
  chevron: `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/></svg>`,
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
function poblarSelect(selectId, lista, valorActual = null, conVacio = false, textoVacio = '— Sin categoría —') {
  const sel = $(selectId);
  sel.innerHTML = (conVacio ? `<option value="">${escapeHtml(textoVacio)}</option>` : '') + lista.map(v => `<option value="${escapeHtml(v)}"${valorActual === v ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
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
  state.config = { categorias_inventario: raw.categorias_inventario ? JSON.parse(raw.categorias_inventario) : [...LISTA_DEFAULTS.categorias_inventario] };
}

// ---------- Inventario ----------

let _invArticulos = [], _invClientes = [], _invSearchTimer, _invSeleccionados = new Set(), _invFiltroStock = 'todos', _invDashboard = null, _invArticulosConMovimiento = new Set(), _invArticulosTodos = [];

function cambiarVistaInventario(vista) {
  document.querySelectorAll('.inventory-subnav-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.invView === vista));
  document.querySelectorAll('.inventory-page').forEach(page => page.classList.toggle('hidden', page.dataset.invPage !== vista && !(vista === 'dashboard' && page.id === 'inventory-page-dashboard')));
  if (vista === 'dashboard') cargarInventarioDashboard().catch(err => avisar(err.message));
  if (vista === 'entradas') cargarInventarioMovimientos('entradas', $('#inv-entradas-busqueda').value.trim(), '#inventario-entradas-lista');
  if (vista === 'facturacion') cargarFacturacion().catch(err => avisar(err.message));
}
document.querySelectorAll('.inventory-subnav-btn').forEach(btn => btn.addEventListener('click', () => cambiarVistaInventario(btn.dataset.invView)));
document.querySelectorAll('[data-inv-go="articulos"]').forEach(btn => btn.addEventListener('click', () => cambiarVistaInventario('articulos')));
document.querySelectorAll('[data-inv-action="entrada"]').forEach(btn => btn.addEventListener('click', () => $('#btn-inv-entrada').click()));

function invFmtCantidad(value) { return Number(value || 0).toLocaleString('es-ES', { maximumFractionDigits: 3 }); }
function invOpcionesArticulosDatos() {
  return _invArticulosTodos.filter(a => a.activo).map(a => ({
    value: String(a.id), label: a.nombre,
    meta: [a.codigo ? `Código: ${a.codigo}` : '', a.ean ? `EAN: ${a.ean}` : '', `Stock: ${invFmtCantidad(a.stock)} ${a.unidad}`].filter(Boolean).join(' · '),
    search: [a.nombre, a.codigo, a.ean, a.categoria, a.ubicacion].filter(Boolean).join(' '),
  }));
}
function invOpcionesClientesDatos(incluirVacio = false) {
  const opciones = _invClientes.map(c => ({ value: String(c.id), label: c.nombre, meta: [c.telefono, c.email].filter(Boolean).join(' · '), search: [c.nombre, c.telefono, c.email, c.direccion].filter(Boolean).join(' ') }));
  return incluirVacio ? [{ value: '', label: '— Sin cliente —', meta: 'La salida quedará sin asignar', search: 'sin cliente' }, ...opciones] : opciones;
}
function invCrearBuscador(root, obtenerOpciones) {
  const input = root.querySelector('input[type="search"]'), hidden = root.querySelector('input[type="hidden"]'), menu = root.querySelector('.inventory-combobox-menu');
  const apiBuscador = {
    render() {
      const query = input.value.trim().toLocaleLowerCase();
      const opciones = obtenerOpciones().filter(o => !query || `${o.label} ${o.meta} ${o.search || ''}`.toLocaleLowerCase().includes(query));
      menu.innerHTML = opciones.length ? opciones.slice(0, 40).map(o => `<button type="button" class="inventory-combobox-option" data-value="${escapeHtml(o.value)}"><strong>${escapeHtml(o.label)}</strong><small>${escapeHtml(o.meta || '')}</small></button>`).join('') : '<div class="inventory-combobox-empty">No hay coincidencias</div>';
      menu.classList.remove('hidden');
    },
    seleccionar(opcion) { input.value = opcion?.label || ''; hidden.value = opcion?.value || ''; menu.classList.add('hidden'); },
    seleccionarPorId(id) { const opcion = obtenerOpciones().find(o => String(o.value) === String(id)); if (opcion) this.seleccionar(opcion); },
    limpiar() { this.seleccionar(null); },
  };
  input.addEventListener('focus', () => apiBuscador.render());
  input.addEventListener('input', () => { hidden.value = ''; apiBuscador.render(); });
  menu.addEventListener('mousedown', e => {
    const opcion = e.target.closest('.inventory-combobox-option'); if (!opcion) return;
    e.preventDefault();
    const seleccion = obtenerOpciones().find(o => String(o.value) === String(opcion.dataset.value));
    if (seleccion) apiBuscador.seleccionar(seleccion);
  });
  document.addEventListener('click', e => { if (!root.contains(e.target)) menu.classList.add('hidden'); });
  return apiBuscador;
}
function invCrearBuscadorArticulo(root) { return invCrearBuscador(root, invOpcionesArticulosDatos); }
const _invMovArticuloCombo = invCrearBuscadorArticulo($('#inv-mov-articulo-combo'));
const _invSalidaClienteCombo = invCrearBuscador($('#inv-salida-cliente-combo'), () => invOpcionesClientesDatos(true));

function renderInventarioArticulos() {
  const cont = $('#inventario-articulos-lista');
  const visibles = _invArticulos.filter(a => {
    if (_invFiltroStock === 'bajo') return !!a.stock_bajo;
    if (_invFiltroStock === 'disponible') return Number(a.stock) > 0;
    if (_invFiltroStock === 'agotado') return Number(a.stock) <= 0;
    return true;
  });
  if (!visibles.length) {
    cont.innerHTML = `<div class="inventory-empty"><div class="inventory-empty-icon">▦</div><strong>${_invArticulos.length ? 'No hay artículos con este filtro' : 'Todavía no hay artículos'}</strong><p>${_invArticulos.length ? 'Cambia el filtro o prueba otra búsqueda.' : 'Crea un artículo o importa tu catálogo CSV para empezar.'}</p>${_invArticulos.length ? '' : '<button type="button" class="btn btn-primary btn-empty-inv">+ Crear artículo</button>'}</div>`;
    cont.querySelector('.btn-empty-inv')?.addEventListener('click', () => $('#btn-inv-nuevo').click());
    actualizarSeleccionInventario([]);
    return;
  }
  cont.innerHTML = `<table class="inventory-table"><thead><tr>
      <th class="inventory-select-cell"><input id="inv-select-all" type="checkbox" title="Seleccionar todos los visibles"></th>
      <th>Artículo</th><th>Identificación</th><th>Stock</th><th>Stock mínimo</th><th></th>
    </tr></thead><tbody>${visibles.map(a => `
    <tr class="${a.stock_bajo ? 'inventory-low' : ''}">
      <td class="inventory-select-cell"><input type="checkbox" data-inv-select="${a.id}" ${_invSeleccionados.has(String(a.id)) ? 'checked' : ''} aria-label="Seleccionar ${escapeHtml(a.nombre)}"></td>
      <td><strong>${escapeHtml(a.nombre)}</strong>${a.categoria ? `<span class="inventory-category">${escapeHtml(a.categoria)}</span>` : ''}</td>
      <td><span class="inventory-identification">${a.ean ? `EAN ${escapeHtml(a.ean)}` : ''}${a.ean && a.codigo ? ' · ' : ''}${a.codigo ? `Código ${escapeHtml(a.codigo)}` : (!a.ean ? 'Sin código' : '')}</span></td>
      <td class="${a.stock_bajo ? 'inventory-stock-low' : 'inventory-stock-ok'}"><strong>${invFmtCantidad(a.stock)}</strong> ${escapeHtml(a.unidad)}${a.stock_bajo ? '<span class="inventory-stock-warning">Bajo mínimo</span>' : ''}</td>
      <td>${invFmtCantidad(a.stock_minimo)} ${escapeHtml(a.unidad)}</td>
      <td><button type="button" class="btn btn-small" data-inv-edit="${a.id}">Editar</button></td>
    </tr>`).join('')}</tbody></table>`;
  const selectAll = $('#inv-select-all');
  selectAll.addEventListener('change', () => { visibles.forEach(a => selectAll.checked ? _invSeleccionados.add(String(a.id)) : _invSeleccionados.delete(String(a.id))); renderInventarioArticulos(); });
  cont.querySelectorAll('[data-inv-select]').forEach(check => check.addEventListener('change', e => { const id = String(e.target.dataset.invSelect); if (e.target.checked) _invSeleccionados.add(id); else _invSeleccionados.delete(id); actualizarSeleccionInventario(visibles); }));
  cont.querySelectorAll('[data-inv-edit]').forEach(btn => btn.addEventListener('click', () => abrirInvArticulo(btn.dataset.invEdit)));
  actualizarSeleccionInventario(visibles);
}
function actualizarSeleccionInventario(visibles = []) {
  const boton = $('#btn-inv-eliminar-seleccionados');
  const total = _invSeleccionados.size;
  if (boton) { boton.disabled = total === 0; boton.textContent = `Eliminar seleccionados (${total})`; }
  const selectAll = $('#inv-select-all'); if (!selectAll) return;
  const idsVisibles = visibles.map(a => String(a.id));
  const seleccionadosVisibles = idsVisibles.filter(id => _invSeleccionados.has(id)).length;
  selectAll.checked = idsVisibles.length > 0 && seleccionadosVisibles === idsVisibles.length;
  selectAll.indeterminate = seleccionadosVisibles > 0 && seleccionadosVisibles < idsVisibles.length;
}
function renderInventarioResumen(informe = null) {
  const bajos = _invArticulosTodos.filter(a => a.stock_bajo).length;
  const unidadesStock = _invArticulosTodos.reduce((total, a) => total + Number(a.stock || 0), 0);
  const entradasHoy = _invDashboard?.entradas ?? '—', salidasHoy = _invDashboard?.salidas ?? '—';
  $('#inventario-resumen').innerHTML = `
    <div class="inventory-stat"><strong>${_invArticulosTodos.length}</strong><span>Artículos activos</span></div>
    <div class="inventory-stat inventory-stat-stock"><strong>${invFmtCantidad(unidadesStock)}</strong><span>Unidades en almacén</span></div>
    <div class="inventory-stat ${bajos ? 'inventory-stat-warning' : ''}"><strong>${bajos}</strong><span>Stock bajo</span></div>
    <div class="inventory-stat"><strong>${entradasHoy}</strong><span>Entradas hoy</span></div>
    <div class="inventory-stat"><strong>${salidasHoy}</strong><span>Salidas hoy</span></div>
    ${informe ? `<div class="inventory-stat"><strong>${informe.salidas}</strong><span>Salidas filtradas</span></div><div class="inventory-stat"><strong>${invFmtCantidad(informe.unidades)}</strong><span>Unidades entregadas</span></div>` : ''}`;
}
function invMovimientoTipo(tipo) {
  if (tipo === 'entrada') return '<span class="inventory-movement-badge is-entry">↓ Entrada</span>';
  if (tipo === 'salida') return '<span class="inventory-movement-badge is-exit">↑ Salida</span>';
  return '<span class="inventory-movement-badge is-adjust">↔ Ajuste</span>';
}
function renderInventarioMovimientos(lista, selector, vacio = 'No hay movimientos para mostrar.') {
  const cont = $(selector); if (!cont) return;
  cont.innerHTML = lista.length ? `<table class="inventory-table inventory-movements-table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Artículo</th><th>Contacto</th><th>Cantidad</th><th>Referencia</th></tr></thead><tbody>${lista.map(m => `<tr><td>${escapeHtml(String(m.creado_en || '').replace('T', ' ').slice(0, 16))}</td><td>${invMovimientoTipo(m.tipo)}</td><td><strong>${escapeHtml(m.articulo_nombre || '—')}</strong><small class="inventory-category">${escapeHtml(m.articulo_codigo || '')}</small></td><td>${escapeHtml(m.cliente_nombre || '—')}</td><td class="${m.tipo === 'salida' ? 'inventory-stock-low' : 'inventory-stock-ok'}"><strong>${invFmtCantidad(Math.abs(Number(m.cantidad || 0)))}</strong> ${escapeHtml(m.unidad || '')}</td><td>${escapeHtml(m.referencia || '—')}</td></tr>`).join('')}</tbody></table>` : `<div class="inventory-empty"><div class="inventory-empty-icon">◌</div><strong>${vacio}</strong></div>`;
}
async function cargarInventarioDashboard() {
  const data = await api('/api/inventario/dashboard', { cache: 'no-store' });
  _invDashboard = data.resumen || null;
  renderInventarioResumen();
  renderInventarioMovimientos(data.recientes || [], '#inv-dashboard-recent', 'Todavía no hay movimientos registrados.');
}
async function refrescarInventarioMovimientos() {
  await cargarInventarioDashboard().catch(() => {});
  const vista = document.querySelector('.inventory-subnav-btn.active')?.dataset.invView;
  if (vista === 'entradas') await cargarInventarioMovimientos('entradas', $('#inv-entradas-busqueda').value.trim(), '#inventario-entradas-lista').catch(() => {});
  else if (vista === 'trazabilidad' && $('#inv-traza-busqueda').value.trim()) await cargarInventarioMovimientos('', $('#inv-traza-busqueda').value.trim(), '#inventario-traza-lista').catch(() => {});
}
async function cargarInventarioMovimientos(tipo, q, selector) {
  const params = new URLSearchParams();
  if (tipo) params.set('tipo', tipo); if (q) params.set('q', q);
  renderInventarioMovimientos(await api(`/api/inventario/movimientos?${params}`, { cache: 'no-store' }), selector);
}
async function cargarInventario(q = '') {
  const articulos = await api(`/api/inventario/articulos${q ? '?q=' + encodeURIComponent(q) : ''}`);
  _invArticulos = articulos;
  _invArticulosTodos = q ? await api('/api/inventario/articulos') : articulos;
  const idsActivos = new Set(_invArticulos.map(a => String(a.id)));
  _invSeleccionados = new Set([..._invSeleccionados].filter(id => idsActivos.has(id)));
  renderInventarioArticulos();
  renderInventarioResumen();
}
function rellenarSelectInvClientes(select, clientes, conVacio = true, textoVacio = '— Sin cliente —') {
  select.innerHTML = (conVacio ? `<option value="">${escapeHtml(textoVacio)}</option>` : '') + clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nombre)}</option>`).join('');
}
function abrirInvArticulo(id = null) {
  const articulo = id ? _invArticulos.find(a => String(a.id) === String(id)) : null;
  $('#modal-inv-articulo-titulo').textContent = articulo ? 'Editar artículo' : 'Nuevo artículo';
  $('#inv-articulo-id').value = articulo?.id || '';
  $('#inv-articulo-ean').value = articulo?.ean || ''; $('#inv-ean-status').textContent = '';
  $('#inv-articulo-nombre').value = articulo?.nombre || '';
  $('#inv-articulo-codigo').value = articulo?.codigo || '';
  $('#inv-articulo-unidad').value = articulo?.unidad || 'ud.';
  poblarSelect('#inv-articulo-categoria', state.config.categorias_inventario || LISTA_DEFAULTS.categorias_inventario, articulo?.categoria || null, true);
  $('#inv-articulo-minimo').value = articulo?.stock_minimo ?? 0;
  $('#inv-articulo-ubicacion').value = articulo?.ubicacion || '';
  $('#inv-articulo-notas').value = articulo?.notas || '';
  $('#inv-articulo-stock-inicial').value = 0;
  $('#inv-articulo-stock-inicial-label').classList.toggle('hidden', !!articulo);
  $('#modal-inv-articulo').showModal();
}
$('#btn-inv-nuevo').addEventListener('click', () => abrirInvArticulo());
$('#form-inv-articulo').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#inv-articulo-id').value;
  const payload = {
    nombre: $('#inv-articulo-nombre').value.trim(), ean: $('#inv-articulo-ean').value.trim() || null, codigo: $('#inv-articulo-codigo').value.trim() || null,
    unidad: $('#inv-articulo-unidad').value.trim() || 'ud.', categoria: $('#inv-articulo-categoria').value.trim() || null,
    stock_minimo: $('#inv-articulo-minimo').value, ubicacion: $('#inv-articulo-ubicacion').value.trim() || null, notas: $('#inv-articulo-notas').value.trim() || null,
  };
  if (!id) payload.stock = $('#inv-articulo-stock-inicial').value;
  try {
    await api(id ? `/api/inventario/articulos/${id}` : '/api/inventario/articulos', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('#modal-inv-articulo').close(); await cargarInventario($('#inv-busqueda').value.trim()); await refrescarInventarioMovimientos();
  } catch (err) { avisar(err.message); }
});
$('#btn-inv-buscar-ean').addEventListener('click', async () => {
  const input = $('#inv-articulo-ean'); const ean = input.value.trim();
  if (!ean) { $('#inv-ean-status').textContent = 'Introduce un EAN primero.'; return; }
  const btn = $('#btn-inv-buscar-ean'); btn.disabled = true; btn.textContent = 'Buscando…'; $('#inv-ean-status').textContent = '';
  try {
    const data = await api(`/api/inventario/buscar-ean/${encodeURIComponent(ean)}`);
    const a = data.articulo || {};
    if (!$('#inv-articulo-nombre').value.trim() && a.nombre) $('#inv-articulo-nombre').value = a.nombre;
    if (!$('#inv-articulo-categoria').value.trim() && a.categoria) $('#inv-articulo-categoria').value = a.categoria;
    $('#inv-ean-status').textContent = data.origen === 'local' ? 'Artículo ya registrado localmente.' : 'Nombre encontrado automáticamente. Revísalo antes de guardar.';
  } catch (err) { $('#inv-ean-status').textContent = err.message; }
  finally { btn.disabled = false; btn.textContent = 'Buscar nombre'; }
});
$('#inv-articulo-ean').addEventListener('change', () => { if ($('#inv-articulo-ean').value.trim() && !$('#inv-articulo-nombre').value.trim()) $('#btn-inv-buscar-ean').click(); });
$('#btn-inv-importar').addEventListener('click', () => $('#inv-importar-file').click());
$('#inv-importar-file').addEventListener('change', async e => {
  const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
  try {
    const contenido = await file.text();
    const resultado = await api('/api/inventario/importar', { method: 'POST', body: JSON.stringify({ contenido }) });
    await cargarInventario($('#inv-busqueda').value.trim());
    await cargarInventarioInforme();
    await refrescarInventarioMovimientos();
    const detalle = resultado.errores?.length ? `\n\nErrores:\n${resultado.errores.slice(0, 8).join('\n')}` : '';
    avisar(`Importación terminada.\nCreados: ${resultado.creados}\nActualizados: ${resultado.actualizados}\nStock inicial aplicado: ${resultado.stock_inicial_aplicado}${detalle}`);
  } catch (err) { avisar(err.message); }
});
$('#btn-inv-eliminar-seleccionados').addEventListener('click', async () => {
  const ids = [..._invSeleccionados]; if (!ids.length) return;
  if (!(await confirmar(`Vas a retirar ${ids.length} artículo${ids.length === 1 ? '' : 's'} del catálogo activo.\n\nSe conservarán sus movimientos y salidas históricas, pero dejarán de aparecer en el inventario. ¿Continuar?`, { peligro: true, textoOk: 'Retirar' }))) return;
  try {
    const resultado = await api('/api/inventario/articulos/eliminar', { method: 'POST', body: JSON.stringify({ ids }) });
    _invSeleccionados.clear();
    await cargarInventario($('#inv-busqueda').value.trim());
    await cargarInventarioInforme();
    avisar(`${resultado.eliminados} artículo${resultado.eliminados === 1 ? '' : 's'} retirado${resultado.eliminados === 1 ? '' : 's'} del inventario.`);
  } catch (err) { avisar(err.message); }
});
$('#inv-filtro-stock').addEventListener('change', e => { _invFiltroStock = e.target.value; renderInventarioArticulos(); });

function actualizarTipoMovimiento() {
  const ajuste = $('#inv-mov-tipo').value === 'ajuste';
  $('#inv-mov-cantidad-label').classList.toggle('hidden', ajuste);
  $('#inv-mov-stock-label').classList.toggle('hidden', !ajuste);
}
$('#btn-inv-entrada').addEventListener('click', () => {
  if (!_invArticulosTodos.length) { avisar('Crea primero un artículo.'); return; }
  _invMovArticuloCombo.limpiar();
  $('#inv-mov-tipo').value = 'entrada'; $('#inv-mov-cantidad').value = ''; $('#inv-mov-stock').value = '';
  $('#inv-mov-referencia').value = ''; $('#inv-mov-notas').value = ''; actualizarTipoMovimiento();
  $('#modal-inv-movimiento').showModal();
});
$('#inv-mov-tipo').addEventListener('change', actualizarTipoMovimiento);
$('#form-inv-movimiento').addEventListener('submit', async e => {
  e.preventDefault();
  if (!$('#inv-mov-articulo').value) { avisar('Busca y selecciona un artículo antes de guardar el movimiento.'); $('#inv-mov-articulo-busqueda').focus(); return; }
  const payload = { articulo_id: $('#inv-mov-articulo').value, tipo: $('#inv-mov-tipo').value, cantidad: $('#inv-mov-cantidad').value, stock_nuevo: $('#inv-mov-stock').value, referencia: $('#inv-mov-referencia').value.trim(), notas: $('#inv-mov-notas').value.trim() };
  try {
    await api('/api/inventario/movimientos', { method: 'POST', body: JSON.stringify(payload) });
    $('#modal-inv-movimiento').close();
    await cargarInventario($('#inv-busqueda').value.trim());
    await refrescarInventarioMovimientos();
  } catch (err) { avisar(err.message); }
});

function añadirLineaInv(articuloId = '', cantidad = '') {
  const row = document.createElement('div'); row.className = 'inventory-line';
  row.innerHTML = `<div class="inventory-combobox inv-line-articulo-combo"><input class="inv-line-articulo-busqueda" type="search" placeholder="Buscar artículo…" autocomplete="off" required><input class="inv-line-articulo" type="hidden"><div class="inventory-combobox-menu hidden"></div></div><input class="inv-line-cantidad" type="number" min="0.000001" step="any" placeholder="Cantidad" required><button type="button" class="inventory-line-remove" title="Quitar">×</button>`;
  const combo = invCrearBuscadorArticulo(row.querySelector('.inv-line-articulo-combo'));
  if (articuloId) combo.seleccionarPorId(articuloId);
  if (cantidad !== '') row.querySelector('.inv-line-cantidad').value = cantidad;
  row.querySelector('.inventory-line-remove').addEventListener('click', () => row.remove());
  $('#inv-salida-lineas').appendChild(row);
}
async function abrirModalSalida(salida = null) {
  if (!salida && !_invArticulosTodos.some(a => a.activo && a.stock > 0)) { avisar('No hay stock disponible para sacar.'); return; }
  _invClientes = await api('/api/clientes');
  $('#inv-salida-id').value = salida ? salida.id : '';
  $('#modal-inv-salida-titulo').textContent = salida ? 'Editar salida' : 'Nueva salida a cliente';
  $('#btn-inv-salida-guardar').textContent = salida ? 'Guardar cambios' : 'Registrar salida';
  $('#btn-inv-salida-eliminar').classList.toggle('hidden', !salida);
  $('#inv-salida-lineas').innerHTML = '';
  if (salida) {
    _invSalidaClienteCombo.seleccionarPorId(salida.cliente_id || '');
    $('#inv-salida-fecha').value = salida.fecha; $('#inv-salida-referencia').value = salida.referencia || ''; $('#inv-salida-notas').value = salida.notas || '';
    $('#inv-salida-facturado').checked = !!salida.facturado;
    salida.lineas.forEach(l => añadirLineaInv(l.articulo_id, l.cantidad));
  } else {
    _invSalidaClienteCombo.limpiar();
    $('#inv-salida-fecha').value = new Date().toISOString().slice(0, 10);
    $('#inv-salida-referencia').value = ''; $('#inv-salida-notas').value = ''; $('#inv-salida-facturado').checked = false;
    añadirLineaInv();
  }
  $('#modal-inv-salida').showModal();
}
async function editarSalida(id) { try { await abrirModalSalida(await api(`/api/inventario/salidas/${id}`)); } catch (err) { avisar(err.message); } }
$('#btn-inv-salida').addEventListener('click', () => abrirModalSalida().catch(err => avisar(err.message)));
$('#btn-inv-add-linea').addEventListener('click', () => añadirLineaInv());
$('#form-inv-salida').addEventListener('submit', async e => {
  e.preventDefault();
  const lineas = [...document.querySelectorAll('#inv-salida-lineas .inventory-line')].map(row => ({ articulo_id: row.querySelector('.inv-line-articulo').value, cantidad: row.querySelector('.inv-line-cantidad').value }));
  if (!lineas.length || lineas.some(linea => !linea.articulo_id)) {
    avisar('Busca y selecciona un artículo en cada línea de la salida.');
    [...document.querySelectorAll('#inv-salida-lineas .inventory-line')].find(row => !row.querySelector('.inv-line-articulo').value)?.querySelector('.inv-line-articulo-busqueda')?.focus();
    return;
  }
  const id = $('#inv-salida-id').value;
  const payload = { cliente_id: $('#inv-salida-cliente').value || null, fecha: $('#inv-salida-fecha').value, referencia: $('#inv-salida-referencia').value.trim(), notas: $('#inv-salida-notas').value.trim(), facturado: $('#inv-salida-facturado').checked, lineas };
  try {
    if (id) await api(`/api/inventario/salidas/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/api/inventario/salidas', { method: 'POST', body: JSON.stringify(payload) });
    $('#modal-inv-salida').close();
    await refrescarTrasCambioSalida();
  } catch (err) { avisar(err.message); }
});
$('#btn-inv-salida-eliminar').addEventListener('click', async () => {
  const id = $('#inv-salida-id').value; if (!id) return;
  if (!(await confirmar('¿Eliminar esta salida? El stock de sus artículos se repondrá.', { peligro: true, textoOk: 'Eliminar' }))) return;
  try { await api(`/api/inventario/salidas/${id}`, { method: 'DELETE' }); $('#modal-inv-salida').close(); await refrescarTrasCambioSalida(); }
  catch (err) { avisar(err.message); }
});
async function refrescarTrasCambioSalida() {
  await cargarInventario($('#inv-busqueda').value.trim());
  await cargarInventarioInforme();
  await cargarFacturacion();
  await refrescarInventarioMovimientos();
}
function toggleDetalleSalida(btn) {
  const detalle = btn.closest('tr')?.nextElementSibling;
  if (!detalle || !detalle.classList.contains('salida-detalle-row')) return;
  const abierta = !detalle.classList.contains('hidden');
  detalle.classList.toggle('hidden', abierta);
  btn.classList.toggle('abierto', !abierta);
}
function renderSalidasAgrupadas(salidas, { conUsuario, sinClienteTexto = '—' } = {}) {
  const pendientes = salidas.filter(s => !s.facturado), facturadas = salidas.filter(s => s.facturado);
  const colSpan = conUsuario ? 9 : 8;
  const cols = conUsuario ? ['', 'Fecha', 'Cliente', 'Referencia', 'Líneas', 'Unidades', 'Usuario', 'Facturado', ''] : ['', 'Fecha', 'Cliente', 'Referencia', 'Líneas', 'Unidades', 'Facturado', ''];
  const fila = s => `<tr class="salida-fila">
      <td><button type="button" class="salida-toggle-detalle" data-id="${s.id}" title="Ver artículos de esta salida">${IC.chevron}</button></td>
      <td>${escapeHtml(s.fecha)}</td><td>${escapeHtml(s.cliente_nombre || sinClienteTexto)}</td><td>${escapeHtml(s.referencia || '—')}</td>
      <td>${s.lineas}</td><td>${invFmtCantidad(s.unidades)}</td>
      ${conUsuario ? `<td>${escapeHtml(s.usuario || '—')}</td>` : ''}
      <td><label class="checkbox-label"><input type="checkbox" class="salida-facturado-toggle" data-id="${s.id}" ${s.facturado ? 'checked' : ''}></label></td>
      <td><button type="button" class="btn btn-small salida-editar-btn" data-id="${s.id}">Editar</button></td>
    </tr>
    <tr class="salida-detalle-row hidden" data-detalle-id="${s.id}">
      <td colspan="${colSpan}"><table class="inventory-subtable"><thead><tr><th>Artículo</th><th>Cantidad salida</th><th>Stock actual</th></tr></thead><tbody>${(s.lineas_detalle || []).map(l => `<tr><td>${escapeHtml(l.nombre)}</td><td>${invFmtCantidad(l.cantidad)} ${escapeHtml(l.unidad)}</td><td>${invFmtCantidad(l.stock)} ${escapeHtml(l.unidad)}</td></tr>`).join('')}</tbody></table></td>
    </tr>`;
  const tabla = rows => rows.length ? `<table class="inventory-table"><thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map(fila).join('')}</tbody></table>` : '<p class="inventory-report-empty">No hay salidas aquí.</p>';
  return `
    <div class="inventory-salidas-grupo"><h4 class="inventory-salidas-grupo-title">Pendientes de facturar <span class="badge badge-warn">${pendientes.length}</span></h4>${tabla(pendientes)}</div>
    <div class="inventory-salidas-grupo"><h4 class="inventory-salidas-grupo-title">Facturados <span class="badge badge-ok">${facturadas.length}</span></h4>${tabla(facturadas)}</div>`;
}
function informeSalidasParams() {
  const params = new URLSearchParams();
  const desde = $('#inv-informe-desde').value, hasta = $('#inv-informe-hasta').value, cliente = $('#inv-informe-cliente').value, facturado = $('#inv-informe-facturado').value;
  if (desde) params.set('desde', desde); if (hasta) params.set('hasta', hasta); if (cliente) params.set('cliente_id', cliente); if (facturado) params.set('facturado', facturado);
  return params;
}
async function cargarInventarioInforme() {
  const params = informeSalidasParams();
  const data = await api(`/api/inventario/informe?${params}`);
  _invArticulosConMovimiento = new Set(data.salidas.flatMap(s => (s.lineas_detalle || []).map(l => l.articulo_id)));
  renderInventarioResumen(data.resumen);
  $('#inventario-informe-resumen').innerHTML = `<div class="inventory-stat"><strong>${data.resumen.salidas}</strong><span>Salidas</span></div><div class="inventory-stat"><strong>${invFmtCantidad(data.resumen.unidades)}</strong><span>Unidades entregadas</span></div><div class="inventory-stat inventory-stat-warning"><strong>${data.resumen.sin_facturar}</strong><span>Sin facturar</span></div><div class="inventory-stat"><strong>${data.resumen.facturadas}</strong><span>Facturadas</span></div><div class="inventory-stat"><strong>${data.resumen.stock_bajo}</strong><span>Artículos bajo mínimo</span></div>`;
  $('#inventario-salidas-lista').innerHTML = data.salidas.length ? renderSalidasAgrupadas(data.salidas, { conUsuario: true }) : '<p class="inventory-report-empty">No hay salidas en el periodo indicado.</p>';
  $('#btn-inv-csv').href = `/api/inventario/informe/csv${params.toString() ? '?' + params : ''}`;
}
$('#inventario-salidas-lista').addEventListener('change', async e => {
  const chk = e.target.closest('.salida-facturado-toggle'); if (!chk) return;
  try { await api(`/api/inventario/salidas/${chk.dataset.id}/facturado`, { method: 'PUT', body: JSON.stringify({ facturado: chk.checked }) }); await cargarInventarioInforme(); }
  catch (err) { avisar(err.message); chk.checked = !chk.checked; }
});
$('#inventario-salidas-lista').addEventListener('click', e => {
  const editarBtn = e.target.closest('.salida-editar-btn'); if (editarBtn) { editarSalida(editarBtn.dataset.id); return; }
  const toggleBtn = e.target.closest('.salida-toggle-detalle'); if (toggleBtn) toggleDetalleSalida(toggleBtn);
});
function facturacionParams() {
  const params = new URLSearchParams();
  const desde = $('#fact-desde').value, hasta = $('#fact-hasta').value, cliente = $('#fact-cliente').value, estado = $('#fact-estado').value;
  if (desde) params.set('desde', desde); if (hasta) params.set('hasta', hasta); if (cliente) params.set('cliente_id', cliente); if (estado) params.set('facturado', estado);
  return params;
}
async function cargarFacturacion() {
  const params = facturacionParams();
  const data = await api(`/api/inventario/informe?${params}`);
  $('#fact-resumen').innerHTML = `<div class="inventory-stat"><strong>${data.resumen.salidas}</strong><span>Salidas</span></div><div class="inventory-stat"><strong>${invFmtCantidad(data.resumen.unidades)}</strong><span>Unidades entregadas</span></div><div class="inventory-stat"><strong>${data.resumen.facturadas}</strong><span>Facturadas</span></div><div class="inventory-stat inventory-stat-warning"><strong>${data.resumen.sin_facturar}</strong><span>Sin facturar</span></div>`;
  $('#fact-lista').innerHTML = data.salidas.length ? renderSalidasAgrupadas(data.salidas, { conUsuario: false, sinClienteTexto: 'Oficina Megas' }) : '<p class="inventory-report-empty">No hay salidas con estos filtros.</p>';
}
$('#fact-lista').addEventListener('change', async e => {
  const chk = e.target.closest('.salida-facturado-toggle'); if (!chk) return;
  try { await api(`/api/inventario/salidas/${chk.dataset.id}/facturado`, { method: 'PUT', body: JSON.stringify({ facturado: chk.checked }) }); await cargarFacturacion(); }
  catch (err) { avisar(err.message); chk.checked = !chk.checked; }
});
$('#fact-lista').addEventListener('click', e => {
  const editarBtn = e.target.closest('.salida-editar-btn'); if (editarBtn) { editarSalida(editarBtn.dataset.id); return; }
  const toggleBtn = e.target.closest('.salida-toggle-detalle'); if (toggleBtn) toggleDetalleSalida(toggleBtn);
});
$('#btn-fact-filtrar').addEventListener('click', () => cargarFacturacion().catch(err => avisar(err.message)));
$('#btn-fact-pdf').addEventListener('click', () => { window.open(`/api/inventario/facturacion/pdf?${facturacionParams()}`, '_blank', 'width=860,height=920'); });
$('#btn-inv-informe').addEventListener('click', () => cargarInventarioInforme().catch(err => avisar(err.message)));

function filaPedirArticulo(a) {
  return `<label class="checkbox-label"><input type="checkbox" data-id="${a.id}" checked> ${escapeHtml(a.nombre)} — stock actual ${invFmtCantidad(a.stock)} ${escapeHtml(a.unidad)}${a.stock_minimo > 0 ? ` (mínimo ${invFmtCantidad(a.stock_minimo)} ${escapeHtml(a.unidad)})` : ''}</label>`;
}
function renderInvPedirArticulos() {
  const candidatos = _invArticulosTodos.filter(a => a.stock_bajo && a.stock_minimo > 0 && _invArticulosConMovimiento.has(a.id));
  $('#inv-pedir-articulos').innerHTML = candidatos.length ? candidatos.map(filaPedirArticulo).join('') : '<p class="inventory-report-empty">Ningún artículo con movimientos en este periodo está bajo su mínimo.</p>';
}
function agregarArticuloPedirManual(a) {
  const cont = $('#inv-pedir-articulos');
  if (cont.querySelector(`input[data-id="${a.id}"]`)) return;
  cont.querySelector('.inventory-report-empty')?.remove();
  cont.insertAdjacentHTML('beforeend', filaPedirArticulo(a));
}
function renderInvPedirBuscadorResultados(query) {
  const cont = $('#inv-pedir-buscador-resultados');
  const q = query.trim().toLowerCase();
  if (!q) { cont.classList.add('hidden'); cont.innerHTML = ''; return; }
  const yaAgregados = new Set([...document.querySelectorAll('#inv-pedir-articulos input[type="checkbox"]')].map(c => c.dataset.id));
  const coincidencias = _invArticulosTodos.filter(a => a.activo && !yaAgregados.has(String(a.id)) && a.nombre.toLowerCase().includes(q)).slice(0, 8);
  cont.innerHTML = coincidencias.length ? coincidencias.map(a => `<div class="combo-sugerencia-item" data-id="${a.id}">${escapeHtml(a.nombre)} <small style="color:var(--muted)">— stock ${invFmtCantidad(a.stock)} ${escapeHtml(a.unidad)}</small></div>`).join('') : '<div class="combo-sugerencia-vacia">Sin coincidencias</div>';
  cont.classList.remove('hidden');
}
$('#inv-pedir-buscador').addEventListener('input', e => renderInvPedirBuscadorResultados(e.target.value));
$('#inv-pedir-buscador').addEventListener('focus', e => { if (e.target.value.trim()) renderInvPedirBuscadorResultados(e.target.value); });
$('#inv-pedir-buscador-resultados').addEventListener('click', e => {
  const item = e.target.closest('.combo-sugerencia-item'); if (!item || !item.dataset.id) return;
  const articulo = _invArticulosTodos.find(a => String(a.id) === item.dataset.id); if (!articulo) return;
  agregarArticuloPedirManual(articulo);
  $('#inv-pedir-buscador').value = ''; $('#inv-pedir-buscador-resultados').classList.add('hidden');
});
document.addEventListener('click', e => { if (!e.target.closest('#inv-pedir-buscador-combo')) $('#inv-pedir-buscador-resultados')?.classList.add('hidden'); });
$('#btn-inv-pdf').addEventListener('click', async () => {
  $('#inv-pedir-texto').value = ''; $('#inv-pedir-buscador').value = ''; $('#inv-pedir-buscador-resultados').classList.add('hidden');
  try { _invArticulosTodos = await api('/api/inventario/articulos'); await cargarInventarioInforme(); } catch (err) { avisar(err.message); }
  renderInvPedirArticulos();
  $('#modal-inv-pedir').showModal();
});
$('#btn-inv-pedir-cancelar').addEventListener('click', () => $('#modal-inv-pedir').close());
$('#form-inv-pedir').addEventListener('submit', e => {
  e.preventDefault();
  const params = informeSalidasParams();
  const pedir = $('#inv-pedir-texto').value.trim();
  if (pedir) params.set('pedir', pedir);
  params.set('pedir_articulos', [...document.querySelectorAll('#inv-pedir-articulos input[type="checkbox"]:checked')].map(c => c.dataset.id).join(','));
  $('#modal-inv-pedir').close();
  window.open(`/api/inventario/facturacion/pdf?${params}`, '_blank', 'width=860,height=920');
});
$('#inv-busqueda').addEventListener('input', () => { clearTimeout(_invSearchTimer); _invSearchTimer = setTimeout(() => cargarInventario($('#inv-busqueda').value.trim()).catch(err => avisar(err.message)), 250); });
$('#btn-inv-entradas-filtrar').addEventListener('click', () => cargarInventarioMovimientos('entradas', $('#inv-entradas-busqueda').value.trim(), '#inventario-entradas-lista').catch(err => avisar(err.message)));
$('#inv-entradas-busqueda').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-inv-entradas-filtrar').click(); });
$('#btn-inv-traza-buscar').addEventListener('click', () => cargarInventarioMovimientos('', $('#inv-traza-busqueda').value.trim(), '#inventario-traza-lista').catch(err => avisar(err.message)));
$('#inv-traza-busqueda').addEventListener('keydown', e => { if (e.key === 'Enter') $('#btn-inv-traza-buscar').click(); });

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();
  await cargarConfig();
  actualizarBadgeTickets();
  try {
    const [, clientes] = await Promise.all([cargarInventario(), api('/api/clientes')]);
    _invClientes = clientes;
    rellenarSelectInvClientes($('#inv-informe-cliente'), clientes, true, 'Todos');
    rellenarSelectInvClientes($('#fact-cliente'), clientes, true, 'Todos');
    await cargarInventarioInforme();

    const params = new URLSearchParams(location.search);
    const clienteParam = params.get('cliente');
    if (clienteParam) $('#inv-informe-cliente').value = clienteParam;
    cambiarVistaInventario(params.get('view') === 'salidas' ? 'salidas' : 'dashboard');
  } catch (err) { avisar(err.message); }
}
iniciar();
