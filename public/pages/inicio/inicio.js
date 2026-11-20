/**
 * inicio.js — Página de Inicio (/). Autocontenida: incluye su propia copia
 * de los helpers y del comportamiento de la topbar (común a todas las
 * páginas de la app, duplicado a propósito en vez de un common.js
 * compartido — ver docs/01-arquitectura.md).
 */

const $ = sel => document.querySelector(sel);

const state = { clientes: [], numSinAsignar: 0, usuario: null };

// ---------- Helpers compartidos ----------

async function api(path, opts) {
  const options = opts || {};
  let res;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
  } catch (err) {
    throw new Error('No se ha podido conectar con el servidor.');
  }
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
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
    dlg.showModal();
  });
}

function avisar(mensaje, { titulo = 'Aviso' } = {}) {
  const dlg = $('#modal-alert');
  $('#alert-titulo').textContent = titulo;
  $('#alert-mensaje').textContent = mensaje;
  return new Promise(resolve => {
    dlg.addEventListener('close', () => resolve(), { once: true });
    dlg.showModal();
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function iniciales(nombre) {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  return partes.slice(0, 2).map(p => p[0].toUpperCase()).join('') || '?';
}

function fmtRelativo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const minutos = Math.round((Date.now() - d.getTime()) / 60000);
  if (minutos < 1) return 'ahora mismo';
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias === 1) return 'hace 1 día';
  if (dias < 30) return `hace ${dias} días`;
  const [y, m, dd] = iso.slice(0, 10).split('-');
  return `${dd}/${m}/${y}`;
}

document.querySelectorAll('dialog [data-close]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

// ---------- Topbar: usuario, logout, mi perfil, badge de tickets ----------

function mostrarUsuarioEnTopbar() {
  $('#user-badge-nombre').textContent = state.usuario?.nombre || '';
}

async function actualizarBadgeTickets() {
  if (!state.usuario) return;
  try {
    const params = new URLSearchParams();
    if (state.usuario.nombre) params.set('tecnico', state.usuario.nombre);
    const todos = await api(`/api/tickets?${params}`);
    const activos = todos.filter(t => !['Entregado', 'Cerrado'].includes(t.estado)).length;
    const badge = $('#tickets-badge');
    if (activos > 0) { badge.textContent = activos; badge.classList.remove('hidden'); }
    else badge.classList.add('hidden');
  } catch (_) {}
}

$('#btn-logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  location.href = '/login';
});

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
  const uid   = $('#cambiar-pass-uid').value;
  const email = $('#input-perfil-email').value.trim();
  const pass  = $('#input-cambiar-pass').value;
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

async function cerrarBusqueda() {
  $('#global-search-results').classList.add('hidden');
  $('#global-search-results').innerHTML = '';
  _resultIndex = -1;
}

// Navega a la ficha del cliente/equipo encontrado; la página de destino usa
// el hash #equipo-N para centrar y resaltar la tarjeta al cargar.
function navegarAEquipo(equipoId, clienteId) {
  location.href = (clienteId ? `/clientes/${clienteId}` : '/oficina') + `#equipo-${equipoId}`;
}

let _resultIndex = -1;
let _searchTimeout;

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
  if (clientes.length > 0) {
    html += '<div class="result-grupo">Clientes</div>';
    clientes.forEach(c => {
      const meta = [c.num_equipos + ' equipo(s)', c.telefono, c.email].filter(Boolean).join(' · ');
      html += `<div class="result-item" data-action="ir-cliente" data-cid="${c.id}">
        <span class="result-icon">👤</span>
        <span><strong>${resaltarQ(c.nombre, q)}</strong><span class="result-meta">${escapeHtml(meta)}</span></span>
      </div>`;
    });
  }
  if (equipos.length > 0) {
    html += '<div class="result-grupo">Equipos</div>';
    equipos.forEach(e => {
      const ns = e.numero_serie ? ' · N/S: ' + e.numero_serie : '';
      const quien = e.cliente_nombre ? e.cliente_nombre : 'Sin asignar';
      html += `<div class="result-item" data-action="ir-equipo" data-eid="${e.id}" data-cid="${e.cliente_id || ''}">
        <span class="result-icon">🖥️</span>
        <span><strong>${resaltarQ(e.nombre, q)}</strong> <span class="result-tipo">${escapeHtml(e.tipo)}</span>${ns ? '<span class="result-meta">' + escapeHtml(ns) + '</span>' : ''}<span class="result-meta">→ ${escapeHtml(quien)}</span></span>
      </div>`;
    });
  }
  if (historial.length > 0) {
    html += '<div class="result-grupo">Historial</div>';
    historial.forEach(h => {
      const desc = (h.problema_reportado || h.descripcion || '').slice(0, 60);
      const quien = h.cliente_nombre ? h.cliente_nombre : 'Sin asignar';
      html += `<div class="result-item" data-action="ir-equipo" data-eid="${h.equipo_id}" data-cid="${h.cliente_id || ''}">
        <span class="result-icon">🔧</span>
        <span><strong>${escapeHtml(h.equipo_nombre)}</strong> <span class="result-tipo">${escapeHtml(h.tipo)}</span><span class="result-meta">${resaltarQ(desc, q)} · ${escapeHtml(quien)}</span></span>
      </div>`;
    });
  }
  if (componentes.length > 0) {
    html += '<div class="result-grupo">Componentes</div>';
    componentes.forEach(c => {
      const ns = c.numero_serie ? ' N/S: ' + c.numero_serie : '';
      const quien = c.cliente_nombre ? c.cliente_nombre : 'Sin asignar';
      html += `<div class="result-item" data-action="ir-equipo" data-eid="${c.equipo_id}" data-cid="${c.cliente_id || ''}">
        <span class="result-icon">🔩</span>
        <span><strong>${resaltarQ(c.tipo, q)}</strong>${ns ? '<span class="result-meta">' + escapeHtml(ns) + '</span>' : ''}<span class="result-meta">en ${escapeHtml(c.equipo_nombre)} · ${escapeHtml(quien)}</span></span>
      </div>`;
    });
  }
  cont.innerHTML = html;

  cont.querySelectorAll('[data-action="ir-cliente"]').forEach(el =>
    el.addEventListener('click', () => { location.href = `/clientes/${el.dataset.cid}`; })
  );
  cont.querySelectorAll('[data-action="ir-equipo"]').forEach(el =>
    el.addEventListener('click', () => navegarAEquipo(el.dataset.eid, el.dataset.cid || null))
  );
}

$('#global-search-btn').addEventListener('click', busquedaGlobal);
$('#global-search-input').addEventListener('input', () => { clearTimeout(_searchTimeout); _searchTimeout = setTimeout(busquedaGlobal, 300); });
$('#global-search-input').addEventListener('keydown', e => {
  const cont = $('#global-search-results');
  const items = cont.querySelectorAll('.result-item');
  if (e.key === 'Escape') { cerrarBusqueda(); $('#global-search-input').value = ''; return; }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _resultIndex = Math.min(_resultIndex + 1, items.length - 1);
    items.forEach((it, i) => it.classList.toggle('result-focused', i === _resultIndex));
    items[_resultIndex]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _resultIndex = Math.max(_resultIndex - 1, -1);
    items.forEach((it, i) => it.classList.toggle('result-focused', i === _resultIndex));
    if (_resultIndex >= 0) items[_resultIndex].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    if (_resultIndex >= 0) items[_resultIndex]?.click(); else busquedaGlobal();
  }
});
document.addEventListener('click', e => {
  if (!e.target.closest('#global-search-results') && !e.target.closest('.global-search')) cerrarBusqueda();
});

// ---------- Clientes (sidebar) ----------

async function cargarClientes(q = '') {
  const [clientes, { count }] = await Promise.all([
    api(`/api/clientes${q ? '?q=' + encodeURIComponent(q) : ''}`),
    api('/api/equipos/sin-asignar/count'),
  ]);
  state.clientes = clientes;
  state.numSinAsignar = count;
  renderClientes();
}

function renderClientes() {
  const ul = $('#clientes-list');
  ul.innerHTML = '';
  $('#clientes-total').textContent = `${state.clientes.length} cliente${state.clientes.length === 1 ? '' : 's'}`;

  const oficinaBadge = $('#oficina-badge');
  oficinaBadge.textContent = String(state.numSinAsignar);
  oficinaBadge.classList.toggle('hidden', !state.numSinAsignar);

  state.clientes.forEach(c => {
    const li = document.createElement('li');
    const tkBadge = c.num_tickets_activos > 0
      ? `<span style="display:inline-block;background:#f59e0b;color:#fff;font-size:0.68rem;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:5px">${c.num_tickets_activos}</span>`
      : '';
    li.innerHTML = `
      <div class="cliente-avatar">${iniciales(c.nombre)}</div>
      <div class="cliente-row-main">
        <div class="cliente-nombre">${escapeHtml(c.nombre)}${tkBadge}</div>
        <div class="cliente-meta">${c.num_equipos} equipo(s)${c.num_tickets > 0 ? ' · ' + c.num_tickets + ' ticket(s)' : ''}${c.telefono ? ' · ' + escapeHtml(c.telefono) : ''}</div>
      </div>
      <span class="cliente-row-arrow" aria-hidden="true">›</span>
    `;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => { location.href = `/clientes/${c.id}`; });
    ul.appendChild(li);
  });
}

$('#cliente-search').addEventListener('input', e => cargarClientes(e.target.value.trim()));

// ---------- Modal Cliente (nuevo) ----------

function abrirModalCliente() {
  $('#modal-cliente-titulo').textContent = 'Nuevo cliente';
  $('#cliente-id').value = '';
  $('#input-cliente-nombre').value = '';
  $('#input-cliente-telefono').value = '';
  $('#input-cliente-email').value = '';
  $('#input-cliente-direccion').value = '';
  $('#input-cliente-cp').value = '';
  $('#input-cliente-ciudad').value = '';
  $('#input-cliente-provincia').value = '';
  $('#input-cliente-notas').value = '';
  $('#modal-cliente').showModal();
}

$('#btn-nuevo-cliente').addEventListener('click', () => abrirModalCliente());

$('#form-cliente').addEventListener('submit', async e => {
  e.preventDefault();
  const payload = {
    nombre: $('#input-cliente-nombre').value, telefono: $('#input-cliente-telefono').value,
    email: $('#input-cliente-email').value,
    direccion: $('#input-cliente-direccion').value, cp: $('#input-cliente-cp').value,
    ciudad: $('#input-cliente-ciudad').value, provincia: $('#input-cliente-provincia').value,
    notas: $('#input-cliente-notas').value,
  };
  try {
    const nuevo = await api('/api/clientes', { method: 'POST', body: JSON.stringify(payload) });
    $('#modal-cliente').close();
    location.href = `/clientes/${nuevo.id}`;
  } catch (err) { avisar(err.message); }
});

// ---------- Dashboard ----------

const ICONOS_ACTIVIDAD_INICIO = {
  ticket_cerrado: { bg: '#f0fdf4', color: '#16a34a', svg: '<path d="M20 6 9 17l-5-5"/>' },
  cliente_nuevo:  { bg: '#eff6ff', color: '#2563eb', svg: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>' },
  salida_stock:   { bg: '#fffbeb', color: '#d97706', svg: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>' },
};

function renderInicioKpis(d) {
  $('#inicio-kpi-clientes').textContent = d.clientes.total;
  const badgeC = $('#inicio-kpi-clientes-badge');
  if (d.clientes.nuevos_mes > 0) { badgeC.textContent = `+${d.clientes.nuevos_mes} este mes`; badgeC.classList.remove('hidden'); }
  else badgeC.classList.add('hidden');

  $('#inicio-kpi-oficina').textContent = d.equipos_oficina;

  $('#inicio-kpi-tickets').textContent = d.tickets.abiertos;
  const badgeT = $('#inicio-kpi-tickets-badge');
  if (d.tickets.cerrados_hoy > 0) { badgeT.textContent = `${d.tickets.cerrados_hoy} cerrado(s) hoy`; badgeT.classList.remove('hidden'); }
  else badgeT.classList.add('hidden');

  $('#inicio-kpi-minimo').textContent = d.bajo_minimo;
  const badgeM = $('#inicio-kpi-minimo-badge');
  badgeM.classList.remove('hidden');
  if (d.bajo_minimo > 0) { badgeM.textContent = 'Revisar'; badgeM.className = 'inicio-kpi-badge inicio-kpi-badge--amber'; }
  else { badgeM.textContent = 'Todo ok'; badgeM.className = 'inicio-kpi-badge inicio-kpi-badge--verde'; }
}

function renderInicioChartSvg(movs) {
  const max = Math.max(1, ...movs.flatMap(m => [m.entradas, m.salidas]));
  const groupW = 70, barW = 18, baseY = 190, topY = 40, maxH = baseY - topY;
  let bars = '', labels = '';
  movs.forEach((m, i) => {
    const gx = 22 + i * groupW;
    const hEnt = (m.entradas / max) * maxH;
    const hSal = (m.salidas / max) * maxH;
    bars += `<rect x="${gx}" y="${baseY - hEnt}" width="${barW}" height="${hEnt}" rx="4" fill="#2563eb"/>`;
    bars += `<rect x="${gx + 22}" y="${baseY - hSal}" width="${barW}" height="${hSal}" rx="4" fill="#c7d2fe"/>`;
    labels += `<text x="${gx + 20}" y="208" text-anchor="middle">${escapeHtml(m.dia)}</text>`;
  });
  return `
    <line x1="0" y1="40" x2="520" y2="40" stroke="#f1f3f8" stroke-width="1"/>
    <line x1="0" y1="90" x2="520" y2="90" stroke="#f1f3f8" stroke-width="1"/>
    <line x1="0" y1="140" x2="520" y2="140" stroke="#f1f3f8" stroke-width="1"/>
    <line x1="0" y1="190" x2="520" y2="190" stroke="#e5e8f0" stroke-width="1"/>
    <g>${bars}</g>
    <g fill="#94a0b4" font-size="11" font-family="Segoe UI, Arial, sans-serif">${labels}</g>
  `;
}

function renderInicioActividad(rows) {
  const cont = $('#inicio-actividad');
  if (!rows.length) { cont.innerHTML = '<p class="muted" style="margin:0">Sin actividad reciente.</p>'; return; }
  cont.innerHTML = rows.map(r => {
    const ic = ICONOS_ACTIVIDAD_INICIO[r.tipo] || ICONOS_ACTIVIDAD_INICIO.cliente_nuevo;
    return `
      <div class="inicio-actividad-item">
        <div class="inicio-actividad-icon" style="background:${ic.bg};color:${ic.color}">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ic.svg}</svg>
        </div>
        <div>
          <div class="inicio-actividad-titulo">${escapeHtml(r.texto)}</div>
          <div class="inicio-actividad-meta">${escapeHtml(r.meta || '')} · ${fmtRelativo(r.fecha)}</div>
        </div>
      </div>`;
  }).join('');
}

function renderInicioGarantias(rows) {
  const cont = $('#inicio-garantias');
  if (!rows.length) { cont.innerHTML = '<p class="muted" style="margin:0">No hay garantías próximas a vencer.</p>'; return; }
  cont.innerHTML = rows.map(r => {
    const urgente = r.dias <= 7;
    const texto = r.dias === 0 ? 'Hoy' : r.dias === 1 ? '1 día' : `${r.dias} días`;
    return `
      <div class="inicio-garantia-item">
        <div>
          <div class="inicio-garantia-titulo">${escapeHtml(r.equipo)}</div>
          <div class="inicio-garantia-meta">${escapeHtml(r.cliente)}</div>
        </div>
        <span class="inicio-badge ${urgente ? 'inicio-badge--rojo' : 'inicio-badge--amber'}">${texto}</span>
      </div>`;
  }).join('');
}

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();

  const nombre = (state.usuario?.nombre || '').split(' ')[0] || '';
  const hora = new Date().getHours();
  const saludo = hora < 13 ? 'Buenos días' : hora < 20 ? 'Buenas tardes' : 'Buenas noches';
  $('#inicio-saludo').textContent = nombre ? `${saludo}, ${nombre}` : saludo;
  $('#inicio-fecha').textContent = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  await cargarClientes();
  actualizarBadgeTickets();

  try {
    const d = await api('/api/dashboard');
    renderInicioKpis(d);
    $('#inicio-chart-svg').innerHTML = renderInicioChartSvg(d.movimientos_7dias);
    renderInicioActividad(d.actividad);
    renderInicioGarantias(d.garantias);
  } catch (err) { avisar(err.message); }
}

iniciar();
