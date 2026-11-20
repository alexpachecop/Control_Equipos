/**
 * ficha.js — Ficha de cliente (/clientes/:id) y Oficina Megas (/oficina).
 * Autocontenida (ver docs/01-arquitectura.md): incluye su propia copia de
 * los helpers/topbar comunes a todas las páginas, más todo lo específico de
 * gestionar los equipos de un cliente (equipos, componentes, fotos,
 * archivos, historial, accesos, tickets, etiquetas QR...).
 */

const $ = sel => document.querySelector(sel);

const state = {
  clientes: [], clienteActualId: null, modoSinCliente: false, numSinAsignar: 0,
  equipos: [], filtroEquipos: '', equiposExpandidos: new Set(), etiquetasSeleccionadas: new Set(),
  config: {}, usuario: null,
};

let _equiposLoadSeq = 0;

const LISTA_DEFAULTS = {
  tecnicos: [],
  tipos_intervencion: ['Reparación', 'Mantenimiento preventivo', 'Actualización de software', 'Limpieza', 'Sustitución de componente', 'Diagnóstico', 'Configuración', 'Entrega', 'Otro'],
  categorias_archivo: ['Factura', 'Albarán', 'Presupuesto', 'Manual', 'Garantía', 'Informe', 'Contrato', 'Otro'],
  tipos_equipo: ['PC', 'TPV', 'Periférico', 'Tablet', 'Otro'],
  lista_software: [],
  tipos_credencial: ['Windows', 'BIOS', 'SAP', 'Email', 'VPN', 'Administrador', 'Otro'],
};

const IC = {
  pencil:    `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497zM15 5l4 4"/></svg>`,
  trash:     `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 11v6m4-6v6m5-11v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  cpu:       `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 20v2m0-20v2m5 16v2m0-20v2M2 12h2m-2 5h2M2 7h2m16 5h2m-2 5h2M20 7h2M7 20v2M7 2v2"/><rect width="16" height="16" x="4" y="4" rx="2"/><rect width="8" height="8" x="8" y="8" rx="1"/></g></svg>`,
  wrench:    `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/></svg>`,
  paperclip: `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m16 6l-8.414 8.586a2 2 0 0 0 2.829 2.829l8.414-8.586a4 4 0 1 0-5.657-5.657l-8.379 8.551a6 6 0 1 0 8.485 8.485l8.379-8.551"/></svg>`,
  camera:    `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/></g></svg>`,
  tag:       `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/></g></svg>`,
  download:  `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M12 15V3m9 12v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10l5 5l5-5"/></g></svg>`,
  shield:    `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>`,
  copy:      `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></g></svg>`,
  eye:       `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M2.062 12.348a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 19.876 0a1 1 0 0 1 0 .696a10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></g></svg>`,
  eyeOff:    `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575a1 1 0 0 1 0 .696a10.8 10.8 0 0 1-1.444 2.49m-6.41-.679a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151a1 1 0 0 1 0-.696a10.75 10.75 0 0 1 4.446-5.143M2 2l20 20"/></g></svg>`,
  userPlus:  `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6m3-3h-6"/></g></svg>`,
  fileText:  `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8m8 4H8m8 4H8"/></g></svg>`,
  chevron:   `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="m6 9l6 6l6-6"/></svg>`,
  battery:   `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><rect width="16" height="10" x="2" y="7" rx="2"/><line x1="22" x2="22" y1="11" y2="13"/></g></svg>`,
};

// ---------- Utilidades ----------

function fmtFecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
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
  return fmtFecha(iso.slice(0, 10));
}

function fmtTamano(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function calcularFinGarantia(fechaEntrega, mesesGarantia) {
  if (!fechaEntrega || !mesesGarantia) return null;
  const [y, m, d] = fechaEntrega.split('-').map(Number);
  return new Date(y, m - 1 + Number(mesesGarantia), d);
}

function estadoGarantia(fechaEntrega, mesesGarantia) {
  const fin = calcularFinGarantia(fechaEntrega, mesesGarantia);
  if (!fin) return { texto: 'Sin datos', clase: 'badge-neutral' };
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const finStr = fin.toLocaleDateString('es-ES');
  return fin >= hoy
    ? { texto: `En garantía (hasta ${finStr})`, clase: 'badge-ok' }
    : { texto: `Garantía caducada (${finStr})`, clase: 'badge-warn' };
}

function alertaRevision(historial) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  let minDias = Infinity;
  historial.forEach(h => {
    if (!h.proxima_revision) return;
    const dias = Math.floor((new Date(h.proxima_revision + 'T00:00:00') - hoy) / 86400000);
    if (dias <= 30 && dias < minDias) minDias = dias;
  });
  if (minDias === Infinity) return null;
  if (minDias < 0) return { texto: 'Revisión vencida', clase: 'badge-warn', urgente: true };
  if (minDias === 0) return { texto: 'Revisión HOY', clase: 'badge-warn', urgente: true };
  return { texto: `Revisión en ${minDias}d`, clase: 'badge-warn', urgente: false };
}

function renderAvisosRevisiones(equipos) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const alertas = [];
  equipos.forEach(eq => {
    eq.historial.forEach(h => {
      if (!h.proxima_revision) return;
      const dias = Math.floor((new Date(h.proxima_revision + 'T00:00:00') - hoy) / 86400000);
      if (dias <= 30) alertas.push({ eq, h, dias });
    });
  });
  const el = $('#avisos-revisiones');
  if (alertas.length === 0) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  alertas.sort((a, b) => a.dias - b.dias);
  const items = alertas.map(({ eq, h, dias }) => {
    const texto = dias < 0 ? `Vencida desde ${fmtFecha(h.proxima_revision)}`
      : dias === 0 ? 'Revisión programada para HOY'
      : `En ${dias} día${dias !== 1 ? 's' : ''} · ${fmtFecha(h.proxima_revision)}`;
    return `<div class="aviso-item">
      <span class="aviso-punto ${dias <= 0 ? 'urgente' : ''}"></span>
      <span><strong>${escapeHtml(eq.nombre)}</strong> — ${texto}</span>
      <button class="aviso-check" data-hid="${h.id}" title="Marcar como hecha"><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M20 6L9 17l-5-5"/></svg></button>
    </div>`;
  }).join('');
  el.innerHTML = `<div class="avisos-bloque"><div class="avisos-titulo">Revisiones pendientes (${alertas.length})</div>${items}</div>`;
  el.classList.remove('hidden');
  el.querySelectorAll('.aviso-check').forEach(btn =>
    btn.addEventListener('click', async () => {
      await api(`/api/historial/${btn.dataset.hid}/revision`, { method: 'PATCH' });
      if (state.modoSinCliente) await cargarEquiposSinCliente(); else await cargarEquipos(state.clienteActualId);
    })
  );
}

function iconoArchivo(mimetype) {
  if (mimetype.startsWith('image/')) return '🖼';
  if (mimetype === 'application/pdf') return '📄';
  if (mimetype.includes('word')) return '📝';
  if (mimetype.includes('excel') || mimetype.includes('spreadsheet')) return '📊';
  if (mimetype.includes('presentation') || mimetype.includes('powerpoint')) return '📑';
  if (mimetype === 'text/plain' || mimetype === 'text/csv') return '📃';
  return '📎';
}

function colorTipoHistorial(tipo) {
  const mapa = {
    'Reparación': 'badge-tipo-red', 'Sustitución de componente': 'badge-tipo-orange',
    'Mantenimiento preventivo': 'badge-tipo-green', 'Actualización de software': 'badge-tipo-blue',
    'Limpieza': 'badge-tipo-cyan', 'Diagnóstico': 'badge-tipo-purple',
    'Configuración': 'badge-tipo-indigo', 'Entrega': 'badge-tipo-emerald',
  };
  return mapa[tipo] || 'badge-neutral';
}

function borderColorTipo(tipo) {
  const mapa = {
    'Reparación': '#ef4444', 'Sustitución de componente': '#f97316', 'Mantenimiento preventivo': '#22c55e',
    'Actualización de software': '#3b82f6', 'Limpieza': '#06b6d4', 'Diagnóstico': '#a855f7',
    'Configuración': '#6366f1', 'Entrega': '#10b981',
  };
  return mapa[tipo] || '#94a3b8';
}

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

async function descargarConMarcaAgua(urlFoto, lineas, nombreArchivo) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = urlFoto; });
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const fs = Math.max(14, Math.round(canvas.width * 0.022));
  ctx.font = `600 ${fs}px Arial, sans-serif`;
  ctx.textBaseline = 'bottom';
  const pad = Math.round(fs * 0.6);
  const lineH = Math.round(fs * 1.3);
  let y = canvas.height - pad;
  for (let i = lineas.length - 1; i >= 0; i--) {
    const texto = lineas[i];
    const w = ctx.measureText(texto).width;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(pad - 6, y - fs - 4, w + 12, fs + 10);
    ctx.fillStyle = '#fff';
    ctx.fillText(texto, pad, y);
    y -= lineH;
  }
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombreArchivo;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }, 'image/jpeg', 0.92);
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

function poblarSelect(selectId, lista, valorActual = null, conVacio = false, textoVacio = '— Sin categoría —') {
  const sel = $(selectId);
  sel.innerHTML = (conVacio ? `<option value="">${escapeHtml(textoVacio)}</option>` : '')
    + lista.map(v => `<option value="${escapeHtml(v)}"${valorActual === v ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
  if (valorActual && !lista.includes(valorActual)) {
    sel.innerHTML += `<option value="${escapeHtml(valorActual)}" selected>${escapeHtml(valorActual)}</option>`;
  }
}

document.querySelectorAll('dialog [data-close]').forEach(btn => {
  btn.addEventListener('click', () => btn.closest('dialog').close());
});

// ---------- Topbar: usuario, logout, mi perfil, badge de tickets ----------

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

function irAEquipo(equipoId, clienteId) {
  const destino = clienteId ? `/clientes/${clienteId}` : '/oficina';
  if (destino === location.pathname) { resaltarEquipoEnPagina(equipoId); return; }
  location.href = destino + `#equipo-${equipoId}`;
}

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
  if (clientes.length > 0) {
    html += '<div class="result-grupo">Clientes</div>';
    clientes.forEach(c => {
      const meta = [c.num_equipos + ' equipo(s)', c.telefono, c.email].filter(Boolean).join(' · ');
      html += `<div class="result-item" data-action="ir-cliente" data-cid="${c.id}"><span class="result-icon">👤</span><span><strong>${resaltarQ(c.nombre, q)}</strong><span class="result-meta">${escapeHtml(meta)}</span></span></div>`;
    });
  }
  if (equipos.length > 0) {
    html += '<div class="result-grupo">Equipos</div>';
    equipos.forEach(e => {
      const ns = e.numero_serie ? ' · N/S: ' + e.numero_serie : '';
      const quien = e.cliente_nombre ? e.cliente_nombre : 'Sin asignar';
      html += `<div class="result-item" data-action="ir-equipo" data-eid="${e.id}" data-cid="${e.cliente_id || ''}"><span class="result-icon">🖥️</span><span><strong>${resaltarQ(e.nombre, q)}</strong> <span class="result-tipo">${escapeHtml(e.tipo)}</span>${ns ? '<span class="result-meta">' + escapeHtml(ns) + '</span>' : ''}<span class="result-meta">→ ${escapeHtml(quien)}</span></span></div>`;
    });
  }
  if (historial.length > 0) {
    html += '<div class="result-grupo">Historial</div>';
    historial.forEach(h => {
      const desc = (h.problema_reportado || h.descripcion || '').slice(0, 60);
      const quien = h.cliente_nombre ? h.cliente_nombre : 'Sin asignar';
      html += `<div class="result-item" data-action="ir-equipo" data-eid="${h.equipo_id}" data-cid="${h.cliente_id || ''}"><span class="result-icon">🔧</span><span><strong>${escapeHtml(h.equipo_nombre)}</strong> <span class="result-tipo">${escapeHtml(h.tipo)}</span><span class="result-meta">${resaltarQ(desc, q)} · ${escapeHtml(quien)}</span></span></div>`;
    });
  }
  if (componentes.length > 0) {
    html += '<div class="result-grupo">Componentes</div>';
    componentes.forEach(c => {
      const ns = c.numero_serie ? ' N/S: ' + c.numero_serie : '';
      const quien = c.cliente_nombre ? c.cliente_nombre : 'Sin asignar';
      html += `<div class="result-item" data-action="ir-equipo" data-eid="${c.equipo_id}" data-cid="${c.cliente_id || ''}"><span class="result-icon">🔩</span><span><strong>${resaltarQ(c.tipo, q)}</strong>${ns ? '<span class="result-meta">' + escapeHtml(ns) + '</span>' : ''}<span class="result-meta">en ${escapeHtml(c.equipo_nombre)} · ${escapeHtml(quien)}</span></span></div>`;
    });
  }
  cont.innerHTML = html;
  cont.querySelectorAll('[data-action="ir-cliente"]').forEach(el => el.addEventListener('click', () => {
    if (`/clientes/${el.dataset.cid}` === location.pathname) { cerrarBusqueda(); return; }
    location.href = `/clientes/${el.dataset.cid}`;
  }));
  cont.querySelectorAll('[data-action="ir-equipo"]').forEach(el => el.addEventListener('click', () => irAEquipo(el.dataset.eid, el.dataset.cid || null)));
}
$('#global-search-btn').addEventListener('click', busquedaGlobal);
$('#global-search-input').addEventListener('input', () => { clearTimeout(_searchTimeout); _searchTimeout = setTimeout(busquedaGlobal, 300); });
$('#global-search-input').addEventListener('keydown', e => {
  const cont = $('#global-search-results');
  const items = cont.querySelectorAll('.result-item');
  if (e.key === 'Escape') { cerrarBusqueda(); $('#global-search-input').value = ''; return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); _resultIndex = Math.min(_resultIndex + 1, items.length - 1); items.forEach((it, i) => it.classList.toggle('result-focused', i === _resultIndex)); items[_resultIndex]?.scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); _resultIndex = Math.max(_resultIndex - 1, -1); items.forEach((it, i) => it.classList.toggle('result-focused', i === _resultIndex)); if (_resultIndex >= 0) items[_resultIndex].scrollIntoView({ block: 'nearest' }); }
  else if (e.key === 'Enter') { if (_resultIndex >= 0) items[_resultIndex]?.click(); else busquedaGlobal(); }
});
document.addEventListener('click', e => { if (!e.target.closest('#global-search-results') && !e.target.closest('.global-search')) cerrarBusqueda(); });

// ---------- Clientes (sidebar) ----------

async function cargarClientes(q = '') {
  const [clientes, { count }] = await Promise.all([
    api(`/api/clientes${q ? '?q=' + encodeURIComponent(q) : ''}`),
    api('/api/equipos/sin-asignar/count'),
  ]);
  state.clientes = clientes; state.numSinAsignar = count;
  renderClientes();
}

function renderClientes() {
  const ul = $('#clientes-list');
  ul.innerHTML = '';
  $('#clientes-total').textContent = `${state.clientes.length} cliente${state.clientes.length === 1 ? '' : 's'}`;
  const oficinaBadge = $('#oficina-badge');
  oficinaBadge.textContent = String(state.numSinAsignar);
  oficinaBadge.classList.toggle('hidden', !state.numSinAsignar);
  $('#btn-oficina-view').classList.toggle('nav-active', state.modoSinCliente);

  state.clientes.forEach(c => {
    const li = document.createElement('li');
    li.className = c.id === state.clienteActualId ? 'activo' : '';
    const tkBadge = c.num_tickets_activos > 0
      ? `<span style="display:inline-block;background:#f59e0b;color:#fff;font-size:0.68rem;font-weight:700;padding:1px 6px;border-radius:999px;margin-left:5px">${c.num_tickets_activos}</span>` : '';
    li.innerHTML = `
      <div class="cliente-avatar">${iniciales(c.nombre)}</div>
      <div class="cliente-row-main">
        <div class="cliente-nombre">${escapeHtml(c.nombre)}${tkBadge}</div>
        <div class="cliente-meta">${c.num_equipos} equipo(s)${c.num_tickets > 0 ? ' · ' + c.num_tickets + ' ticket(s)' : ''}${c.telefono ? ' · ' + escapeHtml(c.telefono) : ''}</div>
      </div>
      <span class="cliente-row-arrow" aria-hidden="true">›</span>`;
    li.style.cursor = 'pointer';
    li.addEventListener('click', () => { if (c.id !== state.clienteActualId) location.href = `/clientes/${c.id}`; });
    ul.appendChild(li);
  });
}
$('#cliente-search').addEventListener('input', e => cargarClientes(e.target.value.trim()));

function abrirModalCliente(cliente = null) {
  $('#modal-cliente-titulo').textContent = cliente ? 'Editar cliente' : 'Nuevo cliente';
  $('#cliente-id').value = cliente ? cliente.id : '';
  $('#input-cliente-nombre').value = cliente ? cliente.nombre : '';
  $('#input-cliente-telefono').value = cliente ? (cliente.telefono || '') : '';
  $('#input-cliente-email').value = cliente ? (cliente.email || '') : '';
  $('#input-cliente-direccion').value = cliente ? (cliente.direccion || '') : '';
  $('#input-cliente-cp').value = cliente ? (cliente.cp || '') : '';
  $('#input-cliente-ciudad').value = cliente ? (cliente.ciudad || '') : '';
  $('#input-cliente-provincia').value = cliente ? (cliente.provincia || '') : '';
  $('#input-cliente-notas').value = cliente ? (cliente.notas || '') : '';
  $('#modal-cliente').showModal();
}
$('#btn-nuevo-cliente').addEventListener('click', () => abrirModalCliente());
$('#btn-editar-cliente').addEventListener('click', async () => {
  const cliente = await api(`/api/clientes/${state.clienteActualId}`);
  abrirModalCliente(cliente);
});
$('#btn-borrar-cliente').addEventListener('click', async () => {
  if (!(await confirmar('¿Eliminar este cliente y todos sus equipos y componentes? Esta acción no se puede deshacer.', { peligro: true, textoOk: 'Eliminar' }))) return;
  await api(`/api/clientes/${state.clienteActualId}`, { method: 'DELETE' });
  location.href = '/';
});
$('#form-cliente').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#cliente-id').value;
  const payload = {
    nombre: $('#input-cliente-nombre').value, telefono: $('#input-cliente-telefono').value, email: $('#input-cliente-email').value,
    direccion: $('#input-cliente-direccion').value, cp: $('#input-cliente-cp').value, ciudad: $('#input-cliente-ciudad').value,
    provincia: $('#input-cliente-provincia').value, notas: $('#input-cliente-notas').value,
  };
  try {
    if (id) {
      await api(`/api/clientes/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      await cargarClientes($('#cliente-search').value.trim());
      await seleccionarCliente(Number(id));
    } else {
      const nuevo = await api('/api/clientes', { method: 'POST', body: JSON.stringify(payload) });
      $('#modal-cliente').close();
      location.href = `/clientes/${nuevo.id}`;
      return;
    }
    $('#modal-cliente').close();
  } catch (err) { avisar(err.message); }
});

// ---------- Selección de cliente / Oficina Megas ----------

async function seleccionarCliente(id) {
  state.clienteActualId = id; state.modoSinCliente = false;
  const cliente = await api(`/api/clientes/${id}`);
  $('#cliente-nombre').textContent = cliente.nombre;
  $('#cliente-contacto').textContent = [cliente.telefono, cliente.email, cliente.direccion].filter(Boolean).join(' · ');
  const notasEl = $('#cliente-notas');
  if (cliente.notas) { notasEl.textContent = cliente.notas; notasEl.classList.remove('hidden'); } else notasEl.classList.add('hidden');
  ['#btn-editar-cliente', '#btn-etiqueta-envio', '#btn-borrar-cliente', '#btn-nuevo-ticket-cliente', '#btn-equipo-stock', '#btn-cliente-articulo', '#btn-cliente-ver-salidas'].forEach(s => $(s).classList.remove('hidden'));
  $('#btn-cliente-licencias').classList.toggle('hidden', !cliente.num_licencias);
  $('.export-menu').classList.remove('hidden');
  renderClientes();
  $('#export-pdf-link').href = `/api/clientes/${id}/exportar/pdf`;
  $('#export-excel-link').href = `/api/clientes/${id}/exportar/excel`;
  $('#export-csv-link').href = `/api/clientes/${id}/exportar/csv`;
  await cargarEquipos(id);
  if (window.innerWidth <= 780) document.body.classList.add('mobile-detalle');
}

async function seleccionarSinCliente() {
  state.clienteActualId = null; state.modoSinCliente = true;
  renderClientes();
  $('#cliente-nombre').textContent = 'Oficina Megas';
  $('#cliente-contacto').textContent = 'Equipos y material disponible en la oficina';
  $('#cliente-notas').classList.add('hidden');
  ['#btn-editar-cliente', '#btn-etiqueta-envio', '#btn-borrar-cliente', '#btn-nuevo-ticket-cliente', '#btn-equipo-stock', '#btn-cliente-articulo', '#btn-cliente-ver-salidas', '#btn-cliente-licencias'].forEach(s => $(s).classList.add('hidden'));
  $('.export-menu').classList.add('hidden');
  await cargarEquiposSinCliente();
  if (window.innerWidth <= 780) document.body.classList.add('mobile-detalle');
}

// ---------- Equipos ----------

async function cargarEquipos(clienteId) {
  const seq = ++_equiposLoadSeq;
  const data = await api(`/api/clientes/${clienteId}/equipos`);
  if (seq !== _equiposLoadSeq) return;
  state.equipos = data; state.etiquetasSeleccionadas.clear(); state.filtroEquipos = '';
  $('#equipo-busqueda').value = '';
  renderEquipos();
}
async function cargarEquiposSinCliente() {
  const seq = ++_equiposLoadSeq;
  const data = await api('/api/equipos/sin-asignar');
  if (seq !== _equiposLoadSeq) return;
  state.equipos = data; state.etiquetasSeleccionadas.clear(); state.numSinAsignar = state.equipos.length; state.filtroEquipos = '';
  $('#equipo-busqueda').value = '';
  renderEquipos(); renderClientes();
}
function recargarEquiposActual() { return state.modoSinCliente ? cargarEquiposSinCliente() : cargarEquipos(state.clienteActualId); }

$('#equipo-busqueda').addEventListener('input', e => { state.filtroEquipos = e.target.value.trim(); renderEquipos(); });

function renderEquipos() {
  renderAvisosRevisiones(state.equipos);
  const cont = $('#equipos-list');
  cont.innerHTML = '';
  const lista = state.filtroEquipos
    ? state.equipos.filter(eq => {
        const q = state.filtroEquipos.toLowerCase();
        return (eq.nombre || '').toLowerCase().includes(q) || (eq.tipo || '').toLowerCase().includes(q) || (eq.numero_serie && eq.numero_serie.toLowerCase().includes(q));
      })
    : state.equipos;
  const equiposCount = $('#equipos-count');
  equiposCount.textContent = state.filtroEquipos ? `${lista.length}/${state.equipos.length}` : String(state.equipos.length);

  if (lista.length === 0) {
    if (state.filtroEquipos) {
      cont.innerHTML = `<div class="equipment-empty"><div class="equipment-empty-icon">⌕</div><strong>No hay coincidencias</strong><p>Prueba con otro nombre, tipo o número de serie.</p></div>`;
    } else {
      const mensaje = state.modoSinCliente ? 'No hay dispositivos sin asignar.' : 'Este cliente todavía no tiene equipos registrados.';
      cont.innerHTML = `<div class="equipment-empty"><div class="equipment-empty-icon">▱</div><strong>${mensaje}</strong><p>${state.modoSinCliente ? 'Cuando haya equipos pendientes aparecerán aquí.' : 'Añade el primer equipo para empezar a gestionar su historial.'}</p>${state.modoSinCliente ? '' : '<button type="button" class="btn btn-primary btn-empty-equipo">Añadir equipo</button>'}</div>`;
      cont.querySelector('.btn-empty-equipo')?.addEventListener('click', () => $('#btn-nuevo-equipo').click());
    }
    return;
  }

  lista.forEach(eq => {
    const garantia = estadoGarantia(eq.fecha_entrega, eq.meses_garantia);
    const revision = alertaRevision(eq.historial);
    const expandida = state.filtroEquipos ? true : state.equiposExpandidos.has(String(eq.id));
    const card = document.createElement('div');
    card.className = 'equipo-card' + (expandida ? ' expandida' : '');
    card.dataset.equipoId = eq.id;
    card.innerHTML = `
      <div class="equipo-card-head" data-action="toggle-equipo" data-id="${eq.id}">
        <label class="equipo-etiqueta-check" title="Seleccionar para imprimir QR"><input type="checkbox" class="eq-etq-check" data-id="${eq.id}" ${state.etiquetasSeleccionadas.has(String(eq.id)) ? 'checked' : ''}><span>QR</span></label>
        <div class="equipo-main-info">
          <div class="equipo-name-row"><span class="equipo-titulo">${escapeHtml(eq.nombre)}</span><span class="equipo-tipo">${escapeHtml(eq.tipo || 'Equipo')}</span></div>
          <div class="equipo-meta"><span><b>N/S</b> ${eq.numero_serie ? escapeHtml(eq.numero_serie) : 'Sin número de serie'}</span><span><b>Recepción</b> ${fmtFecha(eq.fecha_entrega)}</span></div>
          <div class="badges">
            <span class="badge ${garantia.clase}">${garantia.texto}</span>
            <span class="badge ${eq.mantenimiento ? 'badge-ok' : 'badge-neutral'}">${eq.mantenimiento ? 'Con mantenimiento' : 'Sin mantenimiento'}</span>
            ${eq.tipo === 'Tablet' ? `<span class="badge ${eq.tiene_cargador ? 'badge-ok' : 'badge-neutral'}">${eq.tiene_cargador ? 'Con cargador' : 'Sin cargador'}</span>` : ''}
            ${eq.tipo === 'Tablet' ? `<span class="badge ${eq.tiene_teclado ? 'badge-ok' : 'badge-neutral'}">${eq.tiene_teclado ? 'Con teclado' : 'Sin teclado'}</span>` : ''}
            ${revision ? `<span class="badge ${revision.clase}">${revision.texto}</span>` : ''}
            ${eq.ticket_activo ? `<span class="badge btn-ticket-activo">Ticket: ${escapeHtml(eq.ticket_activo.estado)}</span>` : ''}
          </div>
        </div>
        <div class="equipo-head-side"><span class="equipo-open-label">${expandida ? 'Ocultar' : 'Ver detalle'}</span><span class="equipo-chevron">${IC.chevron}</span></div>
      </div>
      <div class="equipo-card-body">
        ${eq.notas ? `<p class="notas">${escapeHtml(eq.notas)}</p>` : ''}
        <div class="equipo-acciones-label"><span>Acciones rápidas</span><span>Gestiona este equipo</span></div>
        <div class="equipo-acciones">
          <button class="btn btn-small" data-action="editar-equipo" data-id="${eq.id}">${IC.pencil} Editar</button>
          <button class="btn btn-small btn-danger" data-action="borrar-equipo" data-id="${eq.id}">${IC.trash} Eliminar</button>
          <button class="btn btn-small" data-action="nuevo-componente" data-id="${eq.id}">${IC.cpu} Componente</button>
          <button class="btn btn-small" data-action="nueva-intervencion" data-id="${eq.id}">${IC.wrench} Intervención</button>
          <button class="btn btn-small" data-action="nuevo-archivo" data-id="${eq.id}">${IC.paperclip} Archivo</button>
          <button class="btn btn-small" data-action="nueva-foto" data-id="${eq.id}">${IC.camera} Foto</button>
          ${eq.numero_serie ? `<button class="btn btn-small" data-action="imprimir-etiqueta" data-id="${eq.id}">${IC.tag} Etiqueta</button>` : ''}
          <button class="btn btn-small" data-action="informe-dispositivo" data-id="${eq.id}">${IC.fileText} Informe</button>
          <button class="btn btn-small" data-action="accesos" data-id="${eq.id}">${IC.shield} Accesos</button>
          <button class="btn btn-small" data-action="reasignar-cliente" data-id="${eq.id}">${IC.userPlus} ${eq.cliente_id ? 'Reasignar' : 'Asignar'}</button>
          <button class="btn btn-small ${eq.ticket_activo ? 'btn-ticket-activo' : ''}" data-action="ticket" data-id="${eq.id}">${IC.wrench} ${eq.ticket_activo ? 'Ticket: ' + escapeHtml(eq.ticket_activo.estado) : 'Nuevo ticket'}</button>
        </div>
        ${renderSoftwareBadges(eq)}
        ${renderBateriaBadge(eq)}
        <div class="componentes-section">${renderComponentesTabla(eq)}</div>
        <div class="historial-section">${renderHistorialLista(eq)}</div>
        <div class="archivos-section">${renderArchivosLista(eq)}</div>
        <div class="fotos-section">${renderFotosGaleria(eq, eq.fotos)}</div>
      </div>`;
    cont.appendChild(card);
  });

  cont.querySelectorAll('[data-action="toggle-equipo"]').forEach(head => head.addEventListener('click', () => {
    const id = head.dataset.id;
    if (state.equiposExpandidos.has(id)) state.equiposExpandidos.delete(id); else state.equiposExpandidos.add(id);
    const card = head.closest('.equipo-card');
    const abierta = state.equiposExpandidos.has(id);
    card.classList.toggle('expandida', abierta);
    const label = card.querySelector('.equipo-open-label');
    if (label) label.textContent = abierta ? 'Ocultar' : 'Ver detalle';
  }));
  cont.querySelectorAll('.eq-etq-check').forEach(check => {
    check.addEventListener('click', e => e.stopPropagation());
    check.addEventListener('change', e => {
      const id = String(e.target.dataset.id);
      if (e.target.checked) state.etiquetasSeleccionadas.add(id); else state.etiquetasSeleccionadas.delete(id);
      actualizarBotonEtiquetas();
    });
  });
  actualizarBotonEtiquetas();
  cont.querySelectorAll('[data-action="editar-equipo"]').forEach(btn => btn.addEventListener('click', () => abrirModalEquipo(buscarEquipo(btn.dataset.id))));
  cont.querySelectorAll('[data-action="borrar-equipo"]').forEach(btn => btn.addEventListener('click', () => borrarEquipo(btn.dataset.id)));
  cont.querySelectorAll('[data-action="nuevo-componente"]').forEach(btn => btn.addEventListener('click', () => abrirModalComponente(btn.dataset.id)));
  cont.querySelectorAll('[data-action="editar-componente"]').forEach(btn => btn.addEventListener('click', () => abrirModalComponente(btn.dataset.equipoId, buscarComponente(btn.dataset.equipoId, btn.dataset.id))));
  cont.querySelectorAll('[data-action="borrar-componente"]').forEach(btn => btn.addEventListener('click', () => borrarComponente(btn.dataset.id)));
  cont.querySelectorAll('[data-action="nueva-intervencion"]').forEach(btn => btn.addEventListener('click', () => abrirModalHistorial(btn.dataset.id)));
  cont.querySelectorAll('[data-action="editar-intervencion"]').forEach(btn => btn.addEventListener('click', () => abrirModalHistorial(btn.dataset.equipoId, buscarIntervencion(btn.dataset.equipoId, btn.dataset.id))));
  cont.querySelectorAll('[data-action="borrar-intervencion"]').forEach(btn => btn.addEventListener('click', () => borrarIntervencion(btn.dataset.id)));
  cont.querySelectorAll('[data-action="nueva-foto-intervencion"]').forEach(btn => btn.addEventListener('click', () => abrirModalFotos(btn.dataset.equipoId, btn.dataset.id)));
  cont.querySelectorAll('[data-action="nuevo-archivo"]').forEach(btn => btn.addEventListener('click', () => abrirModalArchivo(btn.dataset.id)));
  cont.querySelectorAll('[data-action="borrar-archivo"]').forEach(btn => btn.addEventListener('click', () => borrarArchivo(btn.dataset.id)));
  cont.querySelectorAll('[data-action="ver-archivo"]').forEach(btn => btn.addEventListener('click', () => abrirVisorArchivo(btn.dataset.id, decodeURIComponent(btn.dataset.nombre), btn.dataset.mime)));
  cont.querySelectorAll('[data-action="nueva-foto"]').forEach(btn => btn.addEventListener('click', () => abrirModalFotos(btn.dataset.id)));
  cont.querySelectorAll('[data-action="borrar-foto"]').forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); borrarFoto(btn.dataset.id); }));
  cont.querySelectorAll('[data-action="marca-agua"]').forEach(btn => btn.addEventListener('click', () => {
    const lineas = JSON.parse(decodeURIComponent(btn.dataset.lineas));
    descargarConMarcaAgua(btn.dataset.src, lineas, decodeURIComponent(btn.dataset.nombre));
  }));
  cont.querySelectorAll('.foto-miniatura img').forEach(img => img.addEventListener('click', () => abrirVisorFoto(img.src)));
  cont.querySelectorAll('[data-action="imprimir-etiqueta"]').forEach(btn => btn.addEventListener('click', () => abrirModalEtiqueta(btn.dataset.id)));
  cont.querySelectorAll('[data-action="informe-dispositivo"]').forEach(btn => btn.addEventListener('click', () => {
    const w = window.open(`/api/equipos/${btn.dataset.id}/informe-dispositivo`, '_blank', 'width=720,height=900');
    if (!w) avisar('El navegador bloqueó la ventana emergente. Permite ventanas emergentes para esta página.');
  }));
  cont.querySelectorAll('[data-action="accesos"]').forEach(btn => btn.addEventListener('click', () => abrirModalAccesos(buscarEquipo(btn.dataset.id))));
  cont.querySelectorAll('[data-action="reasignar-cliente"]').forEach(btn => btn.addEventListener('click', () => abrirModalAsignar(buscarEquipo(btn.dataset.id))));
  cont.querySelectorAll('[data-action="ticket"]').forEach(btn => btn.addEventListener('click', () => { const eq = buscarEquipo(btn.dataset.id); abrirModalTicket(eq, eq.ticket_activo || null); }));
}

function resaltarEquipoEnPagina(equipoId) {
  const card = document.querySelector(`[data-equipo-id="${equipoId}"]`);
  if (!card) return;
  state.equiposExpandidos.add(String(equipoId));
  card.classList.add('expandida');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('equipo-highlight');
  setTimeout(() => card.classList.remove('equipo-highlight'), 2000);
}

function renderFotosGaleria(eq, fotos, contextoMarca = []) {
  if (!fotos || fotos.length === 0) return '';
  const lineasBase = [eq.nombre, eq.numero_serie ? 'N/S: ' + eq.numero_serie : '', ...contextoMarca].filter(Boolean);
  const miniaturas = fotos.map(f => {
    const lineas = [...lineasBase, fmtFecha(f.creado_en)];
    const src = `/uploads/${encodeURIComponent(f.archivo)}`;
    return `<div class="foto-miniatura">
      <img src="${src}" alt="Foto" loading="lazy">
      <div class="foto-controles">
        <button class="foto-borrar" data-action="borrar-foto" data-id="${f.id}" title="Eliminar">×</button>
        <button class="foto-mwa" data-action="marca-agua" data-src="${src}" data-nombre="${encodeURIComponent(eq.nombre + '_' + f.id + '.jpg')}" data-lineas="${encodeURIComponent(JSON.stringify(lineas))}" title="Descargar con marca de agua">↓</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="fotos-galeria">${miniaturas}</div>`;
}

function renderComponentesTabla(eq) {
  if (!eq.componentes || eq.componentes.length === 0) return '<p class="muted">Sin componentes registrados.</p>';
  const filas = eq.componentes.map(c => `
    <tr>
      <td>${escapeHtml(c.tipo)}</td><td>${c.descripcion ? escapeHtml(c.descripcion) : '—'}</td><td>${c.numero_serie ? escapeHtml(c.numero_serie) : '—'}</td>
      <td><button class="btn btn-small" data-action="editar-componente" data-id="${c.id}" data-equipo-id="${eq.id}">${IC.pencil}</button>
      <button class="btn btn-small btn-danger" data-action="borrar-componente" data-id="${c.id}">${IC.trash}</button></td>
    </tr>`).join('');
  return `<table class="componentes-table"><thead><tr><th>Componente</th><th>Descripción / modelo</th><th>Nº serie</th><th></th></tr></thead><tbody>${filas}</tbody></table>`;
}

function renderHistorialLista(eq) {
  const titulo = '<div class="equipo-subseccion-titulo">Historial de intervenciones</div>';
  if (!eq.historial || eq.historial.length === 0) return titulo + '<p class="muted">Sin intervenciones registradas.</p>';
  const items = eq.historial.map(h => {
    const extras = [];
    if (h.tecnico) extras.push(`Técnico: ${escapeHtml(h.tecnico)}`);
    if (h.coste != null) extras.push(`Coste: ${Number(h.coste).toFixed(2)} €`);
    if (h.proxima_revision) {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const dias = Math.floor((new Date(h.proxima_revision + 'T00:00:00') - hoy) / 86400000);
      extras.push(`Próx. revisión: ${fmtFecha(h.proxima_revision)}${dias < 0 ? ' — VENCIDA' : dias <= 30 ? ` — en ${dias}d` : ''}`);
    }
    const fotosInterv = renderFotosGaleria(eq, h.fotos, [`Intervención: ${fmtFecha(h.fecha)}`]);
    return `<div class="historial-item" style="border-left-color:${borderColorTipo(h.tipo)}">
      <div class="historial-item-head">
        <div class="historial-fecha-tipo"><span class="historial-fecha">${fmtFecha(h.fecha)}</span><span class="badge ${colorTipoHistorial(h.tipo)}">${escapeHtml(h.tipo)}</span></div>
        <div class="historial-acciones">
          <button class="btn btn-small" data-action="nueva-foto-intervencion" data-equipo-id="${eq.id}" data-id="${h.id}">${IC.camera} Foto</button>
          <button class="btn btn-small" data-action="editar-intervencion" data-id="${h.id}" data-equipo-id="${eq.id}">${IC.pencil} Editar</button>
          <button class="btn btn-small btn-danger" data-action="borrar-intervencion" data-id="${h.id}">${IC.trash} Eliminar</button>
        </div>
      </div>
      ${h.problema_reportado ? `<p class="historial-problema"><span class="historial-campo-label">Problema:</span> ${escapeHtml(h.problema_reportado)}</p>` : ''}
      <p class="historial-descripcion"><span class="historial-campo-label">Realizado:</span> ${escapeHtml(h.descripcion)}</p>
      ${extras.length ? `<p class="historial-extras">${extras.join(' · ')}</p>` : ''}
      ${fotosInterv ? `<div class="historial-fotos">${fotosInterv}</div>` : ''}
    </div>`;
  }).join('');
  return titulo + `<div class="historial-lista">${items}</div>`;
}

const MIMETYPES_PREVISUALIZABLES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp', 'application/pdf', 'text/plain', 'text/csv']);

function renderArchivosLista(eq) {
  if (!eq.archivos || eq.archivos.length === 0) return '';
  const titulo = '<div class="equipo-subseccion-titulo">Archivos adjuntos</div>';
  const items = eq.archivos.map(a => `
    <div class="archivo-item">
      <span class="archivo-icono">${iconoArchivo(a.mimetype)}</span>
      <div class="archivo-info">
        <span class="archivo-nombre">${escapeHtml(a.nombre_original)}</span>
        <div class="archivo-meta"><span class="badge badge-neutral">${escapeHtml(a.categoria)}</span>${a.descripcion ? `<span class="muted">${escapeHtml(a.descripcion)}</span>` : ''}<span class="muted">${fmtTamano(a.tamano)}</span></div>
      </div>
      <div class="archivo-acciones">
        ${MIMETYPES_PREVISUALIZABLES.has(a.mimetype) ? `<button type="button" class="btn btn-small" data-action="ver-archivo" data-id="${a.id}" data-nombre="${encodeURIComponent(a.nombre_original)}" data-mime="${a.mimetype}">${IC.eye} Ver</button>` : ''}
        <a href="/api/archivos/${a.id}/descargar" class="btn btn-small">${IC.download} Descargar</a>
        <button class="btn btn-small btn-danger" data-action="borrar-archivo" data-id="${a.id}">${IC.trash} Eliminar</button>
      </div>
    </div>`).join('');
  return titulo + `<div class="archivos-lista">${items}</div>`;
}

async function abrirVisorArchivo(id, nombre, mimetype) {
  $('#visor-archivo-nombre').textContent = nombre;
  const body = $('#visor-archivo-body');
  const url = `/api/archivos/${id}/ver`;
  if (mimetype.startsWith('image/')) body.innerHTML = `<img src="${url}" alt="${escapeHtml(nombre)}">`;
  else if (mimetype === 'application/pdf') body.innerHTML = `<iframe src="${url}"></iframe>`;
  else {
    body.innerHTML = '<p class="muted">Cargando…</p>';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('No se pudo cargar el archivo');
      body.innerHTML = `<pre>${escapeHtml(await res.text())}</pre>`;
    } catch (e) { body.innerHTML = `<p class="muted">${escapeHtml(e.message)}</p>`; }
  }
  $('#modal-visor-archivo').showModal();
}

// ---------- Iconos de software ----------

const SW_ICON = {
  'adobeacrobatreader': ['adobe acrobat reader','adobe acrobat','adobe reader','acrobat reader','acrobat'],
  'adobeaftereffects': ['adobe after effects','after effects'], 'adobeillustrator': ['adobe illustrator','illustrator'],
  'adobephotoshop': ['adobe photoshop','photoshop'], 'adobepremierepro': ['adobe premiere pro','adobe premiere','premiere pro','premiere'],
  'androidstudio': ['android studio'], 'anydesk': ['anydesk'], 'autocad': ['autodesk autocad','autocad'],
  'avast': ['avast antivirus','avast'], 'avg': ['avg antivirus','avg'], 'bitwarden': ['bitwarden'], 'ccleaner': ['ccleaner'],
  'chromium': ['chromium'], 'discord': ['discord'], 'dropbox': ['dropbox'], 'figma': ['figma'],
  'filezilla': ['filezilla ftp','filezilla'], 'firefoxbrowser': ['mozilla firefox','firefox'], 'gimp': ['gimp'],
  'git': ['git for windows','git'], 'googlechrome': ['google chrome','chrome'], 'googledrive': ['google drive'],
  'googlemeet': ['google meet'], 'inkscape': ['inkscape'], 'kaspersky': ['kaspersky'], 'keepassxc': ['keepassxc'],
  'keepass': ['keepass'], 'libreoffice': ['libre office','libreoffice'], 'malwarebytes': ['malwarebytes'],
  'microsoftedge': ['microsoft edge','edge'], 'microsoftexcel': ['microsoft excel','excel'],
  'microsoftoffice': ['microsoft office 365','microsoft office 2024','microsoft office 2021','microsoft office 2019','microsoft office 2016','microsoft office','ms office 365','ms office','office 365','office'],
  'microsoftonedrive': ['microsoft onedrive','onedrive'], 'microsoftonenote': ['microsoft onenote','onenote'],
  'microsoftoutlook': ['microsoft outlook','outlook'], 'microsoftpowerpoint': ['microsoft powerpoint','powerpoint'],
  'microsoftteams': ['microsoft teams','teams'], 'microsoftword': ['microsoft word','word'], 'mysql': ['mysql workbench','mysql'],
  'nodedotjs': ['node.js','nodejs','node'], 'notepadplusplus': ['notepad++','notepad plus plus'], 'obsstudio': ['obs studio','obs'],
  'opera': ['opera'], 'oracle': ['java jre','java jdk','java','jre','jdk'], 'postgresql': ['postgresql','postgres'],
  'postman': ['postman'], 'putty': ['putty'], 'python': ['python'], 'qbittorrent': ['qbittorrent'], 'sap': ['sap'],
  'signal': ['signal'], 'skype': ['skype'], 'slack': ['slack'], 'spotify': ['spotify'], 'sublimetext': ['sublime text','sublime'],
  'teamviewer': ['teamviewer'], 'telegram': ['telegram'], 'torbrowser': ['tor browser','tor'], 'ubuntu': ['ubuntu'],
  'virtualbox': ['oracle virtualbox','virtualbox'], 'visualstudio': ['visual studio'], 'visualstudiocode': ['visual studio code','vs code','vscode'],
  'vlcmediaplayer': ['vlc media player','vlc'], 'whatsapp': ['whatsapp'], 'winrar': ['winrar'], 'winscp': ['winscp'],
  'winzip': ['winzip'], 'wireshark': ['wireshark'], 'wordpress': ['wordpress'], '7zip': ['7-zip','7zip'], 'zoom': ['zoom'],
};
const SW_COLOR = {
  '7zip':'#2B9226','adobeacrobatreader':'#FF0000','adobeaftereffects':'#9999FF','adobeillustrator':'#FF9A00','adobephotoshop':'#31A8FF',
  'adobepremierepro':'#9999FF','androidstudio':'#3DDC84','anydesk':'#EF443B','autocad':'#E51937','avast':'#FF7800','avg':'#1D6BC0',
  'bitwarden':'#175DDC','ccleaner':'#2DABE2','chromium':'#4285F4','discord':'#5865F2','dropbox':'#0061FF','figma':'#F24E1E',
  'filezilla':'#BF0000','firefoxbrowser':'#FF7139','gimp':'#5C5543','git':'#F05032','googlechrome':'#4285F4','googledrive':'#4285F4',
  'googlemeet':'#00897B','inkscape':'#000000','kaspersky':'#006D5C','keepass':'#6CAC4D','keepassxc':'#6CAC4D','libreoffice':'#18A303',
  'malwarebytes':'#004DE8','microsoftedge':'#0078D7','microsoftexcel':'#217346','microsoftoffice':'#D83B01','microsoftonedrive':'#0078D7',
  'microsoftonenote':'#7719AA','microsoftoutlook':'#0078D7','microsoftpowerpoint':'#B7472A','microsoftteams':'#6264A7','microsoftword':'#2B579A',
  'mysql':'#4479A1','nodedotjs':'#5FA04E','notepadplusplus':'#90E59A','obsstudio':'#302E31','opera':'#FF1B2D','oracle':'#F80000',
  'postgresql':'#4169E1','postman':'#FF6C37','putty':'#007ACC','python':'#3776AB','qbittorrent':'#2F67BA','sap':'#0FAAFF','signal':'#3A76F0',
  'skype':'#00AFF0','slack':'#4A154B','spotify':'#1DB954','sublimetext':'#FF9800','teamviewer':'#0E8EE9','telegram':'#26A5E4',
  'torbrowser':'#7D4698','ubuntu':'#E95420','virtualbox':'#183A61','visualstudio':'#5C2D91','visualstudiocode':'#007ACC',
  'vlcmediaplayer':'#FF8800','whatsapp':'#25D366','winrar':'#8B0000','winscp':'#1BA1E2','winzip':'#E64035','wireshark':'#1679A7',
  'wordpress':'#21759B','zoom':'#2D8CFF',
};
const _SW_ENTRIES = Object.entries(SW_ICON).flatMap(([slug, keys]) => keys.map(k => [k, slug])).sort((a, b) => b[0].length - a[0].length);

function swFindSlug(name) {
  const norm = name.toLowerCase().trim();
  for (const [key, slug] of _SW_ENTRIES) if (norm.includes(key)) return slug;
  if (norm.length > 3) for (const [key, slug] of _SW_ENTRIES) if (key.includes(norm)) return slug;
  return null;
}
let _swLocalFiles = [];
async function cargarSwIcons() { try { _swLocalFiles = await api('/api/sw-icons'); } catch { _swLocalFiles = []; } }
function _swNorm(s) { return s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
function swFindLocalFile(name) {
  if (!_swLocalFiles.length) return null;
  const n = _swNorm(name);
  let best = null, bestLen = 0;
  for (const f of _swLocalFiles) {
    const fn = _swNorm(f);
    if (fn === n) return `/sw-icons/${encodeURIComponent(f)}`;
    if (fn.includes(n) || n.includes(fn)) { if (fn.length > bestLen) { bestLen = fn.length; best = f; } }
  }
  return best ? `/sw-icons/${encodeURIComponent(best)}` : null;
}
window._swFb = function (img) {
  const list = (img.dataset.fb || '').split('|').filter(Boolean);
  if (!list.length) { img.style.display = 'none'; return; }
  img.dataset.fb = list.slice(1).join('|');
  img.src = list[0];
};
function swIconImg(name) {
  const slug = swFindSlug(name), local = swFindLocalFile(name), cdn = slug ? `https://cdn.simpleicons.org/${slug}` : null;
  const first = local || (cdn ? cdn : null);
  if (!first) return '';
  const extras = [...(local && cdn ? [cdn] : [])].join('|');
  return `<img src="${first}" width="13" height="13" class="sw-icon" data-fb="${extras}" onerror="_swFb(this)" alt="">`;
}
function swChipStyle(name) { const slug = swFindSlug(name); const c = slug && SW_COLOR[slug]; return c ? ` style="--swc:${c}"` : ''; }
function renderSoftwareBadges(eq) {
  const lista = eq.software_instalado ? JSON.parse(eq.software_instalado) : [];
  if (lista.length === 0) return '';
  const chips = lista.map(s => {
    const slug = swFindSlug(s); const c = slug && SW_COLOR[slug];
    return `<span class="badge badge-neutral"${c ? ` style="border-color:${c};background:${c}18"` : ''}>${swIconImg(s)} ${escapeHtml(s)}</span>`;
  }).join('');
  return `<div class="software-instalado-section"><span class="equipo-subseccion-titulo-inline">Software:</span> ${chips}</div>`;
}
function renderBateriaBadge(eq) {
  if (eq.bateria_vida_pct === null || eq.bateria_vida_pct === undefined || eq.bateria_vida_pct === '') return '';
  const pct = Number(eq.bateria_vida_pct);
  const clase = pct >= 80 ? 'badge-ok' : pct >= 50 ? 'badge-amber' : 'badge-warn';
  return `<div class="software-instalado-section"><span class="equipo-subseccion-titulo-inline">Batería:</span> <span class="badge ${clase}">${IC.battery} ${pct}%</span></div>`;
}

// ---------- Modal Accesos ----------

function renderLicenciaRow(l = {}) {
  return `<div class="licencia-row">
    <input class="lic-nombre" type="text" placeholder="Nombre (Windows 11 Pro, Office...)" value="${escapeHtml(l.nombre || '')}">
    <div class="lic-clave-field"><input class="lic-clave" type="text" placeholder="XXXXX-XXXXX-XXXXX-XXXXX" value="${escapeHtml(l.clave || '')}" spellcheck="false"><button type="button" class="btn-copy-lic" title="Copiar clave">${IC.copy}</button></div>
    <input class="lic-nota" type="text" placeholder="Nota (opcional)" value="${escapeHtml(l.nota || '')}">
    <button type="button" class="btn btn-small btn-danger btn-del-lic" title="Eliminar">×</button>
  </div>`;
}
function renderCredencialRow(c = {}) {
  const tipos = state.config.tipos_credencial || LISTA_DEFAULTS.tipos_credencial;
  const tipoActual = c.tipo || '';
  const opts = tipos.map(t => `<option value="${escapeHtml(t)}"${t === tipoActual ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  const extraOpt = tipoActual && !tipos.includes(tipoActual) ? `<option value="${escapeHtml(tipoActual)}" selected>${escapeHtml(tipoActual)}</option>` : '';
  return `<div class="credencial-row">
    <select class="cred-tipo">${opts}${extraOpt}</select>
    <input class="cred-usuario" type="text" placeholder="Usuario" value="${escapeHtml(c.usuario || '')}">
    <div class="pass-field"><input class="cred-pass" type="password" placeholder="Contraseña" value="${escapeHtml(c.password || '')}"><button type="button" class="btn-eye" title="Mostrar/ocultar">${IC.eye}</button></div>
    <input class="cred-nota" type="text" placeholder="Nota (opcional)" value="${escapeHtml(c.nota || '')}">
    <button type="button" class="btn btn-small btn-danger btn-del-cred" title="Eliminar">×</button>
  </div>`;
}
function abrirModalAccesos(eq) {
  if (!eq) return;
  $('#modal-accesos-titulo').textContent = `Accesos — ${eq.nombre}`;
  $('#accesos-equipo-id').value = eq.id;
  $('#input-anydesk-id').value = eq.anydesk_id || ''; $('#input-anydesk-pass').value = eq.anydesk_pass || ''; $('#input-anydesk-pass').type = 'password';
  $('#input-megas-id').value = eq.megas_id || ''; $('#input-megas-pass').value = eq.megas_pass || ''; $('#input-megas-pass').type = 'password';
  document.querySelectorAll('.btn-eye[data-target]').forEach(btn => btn.innerHTML = IC.eye);
  document.getElementById('credenciales-lista').innerHTML = (eq.credenciales || []).map(c => renderCredencialRow(c)).join('');
  document.getElementById('licencias-lista').innerHTML = (eq.licencias || []).map(l => renderLicenciaRow(l)).join('');
  const listaSwf = state.config.lista_software || [];
  const instalado = eq.software_instalado ? JSON.parse(eq.software_instalado) : [];
  const enLista = new Set(listaSwf);
  const custom = instalado.filter(s => !enLista.has(s));
  $('#accesos-software-checks').innerHTML = [
    ...listaSwf.map(sw => `<label class="sw-chip"${swChipStyle(sw)}><input type="checkbox" value="${escapeHtml(sw)}"${instalado.includes(sw) ? ' checked' : ''}>${swIconImg(sw)}${escapeHtml(sw)}</label>`),
    ...custom.map(sw => `<div class="sw-chip sw-custom"${swChipStyle(sw)} data-sw="${escapeHtml(sw)}">${swIconImg(sw)}${escapeHtml(sw)}<button type="button" class="sw-remove">×</button></div>`),
  ].join('');
  document.getElementById('input-new-sw').value = '';
  $('#modal-accesos').showModal();
}
$('#form-accesos').addEventListener('submit', async e => {
  e.preventDefault();
  const equipoId = $('#accesos-equipo-id').value;
  const softwareChecks = [
    ...[...document.querySelectorAll('#accesos-software-checks input[type="checkbox"]:checked')].map(cb => cb.value),
    ...[...document.querySelectorAll('#accesos-software-checks .sw-custom')].map(el => el.dataset.sw),
  ];
  const accesos = {
    anydesk_id: $('#input-anydesk-id').value.trim() || null, anydesk_pass: $('#input-anydesk-pass').value || null,
    megas_id: $('#input-megas-id').value.trim() || null, megas_pass: $('#input-megas-pass').value || null,
    software_instalado: softwareChecks.length > 0 ? JSON.stringify(softwareChecks) : null,
  };
  const credenciales = [...document.querySelectorAll('#credenciales-lista .credencial-row')]
    .map(row => ({ tipo: row.querySelector('.cred-tipo').value.trim() || 'Usuario', usuario: row.querySelector('.cred-usuario').value.trim() || null, password: row.querySelector('.cred-pass').value || null, nota: row.querySelector('.cred-nota').value.trim() || null }))
    .filter(c => c.usuario || c.password);
  const licencias = [...document.querySelectorAll('#licencias-lista .licencia-row')]
    .map(row => ({ nombre: row.querySelector('.lic-nombre').value.trim() || null, clave: row.querySelector('.lic-clave').value.trim() || null, nota: row.querySelector('.lic-nota').value.trim() || null }))
    .filter(l => l.nombre);
  try {
    await api(`/api/equipos/${equipoId}/accesos`, { method: 'PUT', body: JSON.stringify(accesos) });
    await api(`/api/equipos/${equipoId}/credenciales-bulk`, { method: 'PUT', body: JSON.stringify({ credenciales }) });
    await api(`/api/equipos/${equipoId}/licencias-bulk`, { method: 'PUT', body: JSON.stringify({ licencias }) });
    await recargarEquiposActual();
    $('#modal-accesos').close();
  } catch (err) { avisar(err.message); }
});
$('#btn-add-licencia').addEventListener('click', () => document.getElementById('licencias-lista').insertAdjacentHTML('beforeend', renderLicenciaRow()));
document.getElementById('licencias-lista').addEventListener('click', e => {
  if (e.target.closest('.btn-del-lic')) { e.target.closest('.licencia-row').remove(); return; }
  const copyBtn = e.target.closest('.btn-copy-lic');
  if (copyBtn) {
    const val = copyBtn.closest('.lic-clave-field').querySelector('.lic-clave').value;
    if (val) navigator.clipboard.writeText(val).then(() => { copyBtn.innerHTML = '✓'; setTimeout(() => copyBtn.innerHTML = IC.copy, 1500); });
  }
});
$('#btn-add-credencial').addEventListener('click', () => document.getElementById('credenciales-lista').insertAdjacentHTML('beforeend', renderCredencialRow()));
document.getElementById('credenciales-lista').addEventListener('click', e => {
  const eyeBtn = e.target.closest('.btn-eye');
  if (eyeBtn) {
    const row = eyeBtn.closest('.credencial-row'); if (!row) return;
    const input = row.querySelector('.cred-pass'); const hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password'; eyeBtn.innerHTML = hidden ? IC.eyeOff : IC.eye;
    return;
  }
  const delBtn = e.target.closest('.btn-del-cred');
  if (delBtn) delBtn.closest('.credencial-row').remove();
});
document.getElementById('btn-add-sw').addEventListener('click', () => {
  const inputEl = document.getElementById('input-new-sw'); const val = inputEl.value.trim();
  if (!val) return;
  const area = document.getElementById('accesos-software-checks');
  const existCb = [...area.querySelectorAll('input[type="checkbox"]')].find(cb => cb.value === val);
  if (existCb) { existCb.checked = true; inputEl.value = ''; return; }
  if ([...area.querySelectorAll('.sw-custom')].some(el => el.dataset.sw === val)) { inputEl.value = ''; return; }
  area.insertAdjacentHTML('beforeend', `<div class="sw-chip sw-custom"${swChipStyle(val)} data-sw="${escapeHtml(val)}">${swIconImg(val)}${escapeHtml(val)}<button type="button" class="sw-remove">×</button></div>`);
  inputEl.value = '';
});
document.getElementById('input-new-sw').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-add-sw').click(); } });
document.getElementById('accesos-software-checks').addEventListener('click', e => { const rm = e.target.closest('.sw-remove'); if (rm) rm.closest('.sw-custom').remove(); });
document.querySelectorAll('.btn-eye[data-target]').forEach(btn => btn.addEventListener('click', () => {
  const input = document.getElementById(btn.dataset.target); const hidden = input.type === 'password';
  input.type = hidden ? 'text' : 'password'; btn.innerHTML = hidden ? IC.eyeOff : IC.eye;
}));

function buscarEquipo(id) { return state.equipos.find(e => String(e.id) === String(id)); }
function buscarComponente(equipoId, compId) { const eq = buscarEquipo(equipoId); return eq ? eq.componentes.find(c => String(c.id) === String(compId)) : null; }
function buscarIntervencion(equipoId, intervencionId) { const eq = buscarEquipo(equipoId); return eq ? eq.historial.find(h => String(h.id) === String(intervencionId)) : null; }

// ---------- Equipo (alta/edición) ----------

const TIPOS_CON_BATERIA = new Set(['Tablet', 'Portátil']);
function actualizarVisibilidadCargador() {
  const tipo = $('#input-equipo-tipo').value;
  $('#campo-cargador').classList.toggle('hidden', tipo !== 'Tablet');
  $('#campo-teclado').classList.toggle('hidden', tipo !== 'Tablet');
  const conBat = TIPOS_CON_BATERIA.has(tipo);
  const div = $('#campo-bateria');
  div.classList.toggle('hidden', !conBat); div.style.display = conBat ? 'flex' : 'none';
}
function abrirModalEquipo(equipo = null) {
  poblarSelect('#input-equipo-tipo', state.config.tipos_equipo || LISTA_DEFAULTS.tipos_equipo, equipo?.tipo || null);
  $('#modal-equipo-titulo').textContent = equipo ? 'Editar equipo' : 'Nuevo equipo';
  $('#equipo-id').value = equipo ? equipo.id : '';
  $('#input-equipo-tipo').value = equipo ? equipo.tipo : (state.config.tipos_equipo?.[0] || 'PC');
  $('#input-equipo-nombre').value = equipo ? equipo.nombre : '';
  $('#input-equipo-serie').value = equipo ? (equipo.numero_serie || '') : '';
  $('#input-equipo-fecha').value = equipo ? (equipo.fecha_entrega || '') : '';
  $('#input-equipo-garantia').value = equipo ? equipo.meses_garantia : 24;
  $('#input-equipo-mantenimiento').checked = equipo ? !!equipo.mantenimiento : false;
  $('#input-equipo-cargador').checked = equipo ? !!equipo.tiene_cargador : false;
  $('#input-equipo-teclado').checked = equipo ? !!equipo.tiene_teclado : false;
  $('#input-bat-tipo').value = equipo?.bateria_tipo ?? '';
  $('#input-bat-cap-origen').value = equipo?.bateria_cap_origen ?? '';
  $('#input-bat-cap-actual').value = equipo?.bateria_cap_actual ?? '';
  $('#input-bat-vida').value = equipo?.bateria_vida_pct ?? '';
  $('#input-bat-descarga').value = equipo?.bateria_descarga_mw ?? '';
  $('#input-bat-ciclos').value = equipo?.bateria_ciclos ?? '';
  $('#input-equipo-notas').value = equipo ? (equipo.notas || '') : '';
  actualizarVisibilidadCargador();
  $('#modal-equipo').showModal();
}
$('#btn-nuevo-equipo').addEventListener('click', () => abrirModalEquipo());
$('#btn-nuevo-ticket-cliente').addEventListener('click', () => {
  const cl = state.clientes.find(c => c.id === state.clienteActualId);
  if (!cl) return;
  abrirModalTicketCliente(cl);
});
$('#input-equipo-tipo').addEventListener('change', actualizarVisibilidadCargador);
function recalcularVidaBateria() {
  const origen = Number($('#input-bat-cap-origen').value), actual = Number($('#input-bat-cap-actual').value);
  if (!origen || !actual) return;
  $('#input-bat-vida').value = Math.round((actual / origen) * 1000) / 10;
}
$('#input-bat-cap-origen').addEventListener('input', recalcularVidaBateria);
$('#input-bat-cap-actual').addEventListener('input', recalcularVidaBateria);
$('#btn-generar-serie').addEventListener('click', async () => {
  const btn = $('#btn-generar-serie'); btn.disabled = true;
  try { const { serie } = await api(`/api/generar-serie?tipo=${encodeURIComponent($('#input-equipo-tipo').value)}`); $('#input-equipo-serie').value = serie; }
  finally { btn.disabled = false; }
});
$('#form-equipo').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#equipo-id').value;
  const payload = {
    tipo: $('#input-equipo-tipo').value, nombre: $('#input-equipo-nombre').value, numero_serie: $('#input-equipo-serie').value,
    fecha_entrega: $('#input-equipo-fecha').value, meses_garantia: $('#input-equipo-garantia').value, mantenimiento: $('#input-equipo-mantenimiento').checked,
    tiene_cargador: $('#input-equipo-cargador').checked, tiene_teclado: $('#input-equipo-teclado').checked, notas: $('#input-equipo-notas').value,
    bateria_tipo: $('#input-bat-tipo').value || null,
    bateria_cap_origen: $('#input-bat-cap-origen').value !== '' ? Number($('#input-bat-cap-origen').value) : null,
    bateria_cap_actual: $('#input-bat-cap-actual').value !== '' ? Number($('#input-bat-cap-actual').value) : null,
    bateria_vida_pct: $('#input-bat-vida').value !== '' ? Number($('#input-bat-vida').value) : null,
    bateria_descarga_mw: $('#input-bat-descarga').value !== '' ? Number($('#input-bat-descarga').value) : null,
    bateria_ciclos: $('#input-bat-ciclos').value !== '' ? Number($('#input-bat-ciclos').value) : null,
  };
  try {
    if (id) {
      const saved = await api(`/api/equipos/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      _equiposLoadSeq++;
      const idx = state.equipos.findIndex(eq => String(eq.id) === String(saved.id));
      if (idx !== -1) state.equipos[idx] = saved;
    } else {
      const saved = state.modoSinCliente
        ? await api('/api/equipos/sin-asignar', { method: 'POST', body: JSON.stringify(payload) })
        : await api(`/api/clientes/${state.clienteActualId}/equipos`, { method: 'POST', body: JSON.stringify(payload) });
      _equiposLoadSeq++;
      state.equipos.unshift(saved); state.filtroEquipos = ''; $('#equipo-busqueda').value = '';
    }
    renderEquipos();
    await cargarClientes($('#cliente-search').value.trim());
    $('#modal-equipo').close();
  } catch (err) { avisar(err.message); }
});
async function borrarEquipo(id) {
  if (!(await confirmar('¿Eliminar este equipo y sus componentes?', { peligro: true, textoOk: 'Eliminar' }))) return;
  await api(`/api/equipos/${id}`, { method: 'DELETE' });
  await recargarEquiposActual();
  await cargarClientes($('#cliente-search').value.trim());
}

// ---------- Tickets (modal compartido con /tickets) ----------

const DEFAULT_TICKET_ESTADOS_OBJ = [
  { nombre: 'Pendiente', color: '#94a3b8' }, { nombre: 'Diagnóstico', color: '#3b82f6' }, { nombre: 'En reparación', color: '#f59e0b' },
  { nombre: 'Esperando piezas', color: '#a855f7' }, { nombre: 'Listo', color: '#22c55e' }, { nombre: 'Entregado', color: '#10b981' }, { nombre: 'Cerrado', color: '#64748b' },
];
let TICKET_ESTADOS = DEFAULT_TICKET_ESTADOS_OBJ.map(e => e.nombre);
let TICKET_COLORES = Object.fromEntries(DEFAULT_TICKET_ESTADOS_OBJ.map(e => [e.nombre, e.color]));
function aplicarEstadosTicket(arr) { TICKET_ESTADOS = arr.map(e => e.nombre); TICKET_COLORES = Object.fromEntries(arr.map(e => [e.nombre, e.color])); }
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
    await recargarEquiposActual();
    actualizarBadgeTickets();
    if (notificar && savedTicket?.id) {
      try { await api(`/api/tickets/${savedTicket.id}/notificar`, { method: 'POST', body: JSON.stringify({ asignado_por: state.usuario?.nombre }) }); }
      catch (e) { avisar('Ticket guardado, pero no se pudo enviar la notificación: ' + e.message); }
    }
  } catch (e) { avisar(e.message); }
});
$('#btn-ticket-eliminar').addEventListener('click', async () => {
  if (!(await confirmar('¿Eliminar este ticket?', { peligro: true, textoOk: 'Eliminar' }))) return;
  try { await api(`/api/tickets/${$('#ticket-id').value}`, { method: 'DELETE' }); $('#modal-ticket').close(); await recargarEquiposActual(); }
  catch (e) { avisar(e.message); }
});

// ---------- Asignar / reasignar cliente ----------

async function abrirModalAsignar(eq) {
  $('#asignar-equipo-id').value = eq.id;
  $('#modal-asignar-titulo').textContent = eq.cliente_id ? 'Reasignar cliente' : 'Asignar cliente';
  const sel = $('#select-asignar-cliente');
  sel.innerHTML = '<option value="">— Sin asignar —</option>';
  state.clientes.forEach(c => { const opt = document.createElement('option'); opt.value = c.id; opt.textContent = c.nombre; if (c.id === eq.cliente_id) opt.selected = true; sel.appendChild(opt); });
  if (!eq.cliente_id) sel.value = '';
  $('#modal-asignar-cliente').showModal();
}
$('#btn-asignar-cancelar').addEventListener('click', () => $('#modal-asignar-cliente').close());
$('#btn-asignar-guardar').addEventListener('click', async () => {
  const equipoId = $('#asignar-equipo-id').value, val = $('#select-asignar-cliente').value;
  try {
    await api(`/api/equipos/${equipoId}/asignar-cliente`, { method: 'PUT', body: JSON.stringify({ cliente_id: val ? Number(val) : null }) });
    $('#modal-asignar-cliente').close();
    await recargarEquiposActual();
    await cargarClientes($('#cliente-search').value.trim());
  } catch (e) { avisar(e.message); }
});

// ---------- Equipo desde stock de Oficina Megas ----------

let _equiposStockDisponibles = [];
async function abrirModalEquipoStock() {
  $('#input-equipo-stock-busqueda').value = '';
  $('#equipo-stock-lista').innerHTML = '<p class="inventory-report-empty">Cargando…</p>';
  $('#modal-equipo-stock').showModal();
  try { _equiposStockDisponibles = await api('/api/equipos/sin-asignar'); renderEquipoStockLista(); } catch (e) { avisar(e.message); }
}
function renderEquipoStockLista() {
  const q = $('#input-equipo-stock-busqueda').value.trim().toLowerCase();
  const lista = q ? _equiposStockDisponibles.filter(eq => (eq.nombre || '').toLowerCase().includes(q) || (eq.tipo || '').toLowerCase().includes(q) || (eq.numero_serie && eq.numero_serie.toLowerCase().includes(q))) : _equiposStockDisponibles;
  const cont = $('#equipo-stock-lista');
  if (lista.length === 0) { cont.innerHTML = `<p class="inventory-report-empty">${_equiposStockDisponibles.length === 0 ? 'No hay equipos en stock en Oficina Megas.' : 'No hay coincidencias.'}</p>`; return; }
  cont.innerHTML = lista.map(eq => `
    <div class="equipo-stock-item" data-id="${eq.id}">
      <div class="equipo-stock-item-info"><div class="equipo-stock-item-top"><span class="equipo-stock-item-nombre">${escapeHtml(eq.nombre)}</span> <span class="equipo-tipo">${escapeHtml(eq.tipo || 'Equipo')}</span></div><div class="equipo-stock-item-meta">N/S ${eq.numero_serie ? escapeHtml(eq.numero_serie) : 'Sin número de serie'}</div></div>
      <button type="button" class="btn btn-small btn-primary equipo-stock-add" data-id="${eq.id}">Añadir</button>
    </div>`).join('');
}
$('#input-equipo-stock-busqueda').addEventListener('input', renderEquipoStockLista);
$('#equipo-stock-lista').addEventListener('click', async e => {
  const btn = e.target.closest('.equipo-stock-add'); if (!btn) return;
  btn.disabled = true;
  try {
    await api(`/api/equipos/${btn.dataset.id}/asignar-cliente`, { method: 'PUT', body: JSON.stringify({ cliente_id: state.clienteActualId }) });
    $('#modal-equipo-stock').close();
    await cargarEquipos(state.clienteActualId);
    await cargarClientes($('#cliente-search').value.trim());
  } catch (e) { avisar(e.message); btn.disabled = false; }
});
$('#btn-equipo-stock').addEventListener('click', abrirModalEquipoStock);
$('#btn-equipo-stock-cancelar').addEventListener('click', () => $('#modal-equipo-stock').close());

// ---------- Artículo de stock para cliente (combobox compartido con Inventario) ----------

let _invArticulosTodos = [];
function invFmtCantidad(value) { return Number(value || 0).toLocaleString('es-ES', { maximumFractionDigits: 3 }); }
function invOpcionesArticulosDatos() {
  return _invArticulosTodos.filter(a => a.activo).map(a => ({
    value: String(a.id), label: a.nombre,
    meta: [a.codigo ? `Código: ${a.codigo}` : '', a.ean ? `EAN: ${a.ean}` : '', `Stock: ${invFmtCantidad(a.stock)} ${a.unidad}`].filter(Boolean).join(' · '),
    search: [a.nombre, a.codigo, a.ean, a.categoria, a.ubicacion].filter(Boolean).join(' '),
  }));
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

let _clienteArticuloCombo = null;
function obtenerComboClienteArticulo() { if (!_clienteArticuloCombo) _clienteArticuloCombo = invCrearBuscadorArticulo($('#cliente-articulo-combo')); return _clienteArticuloCombo; }
async function abrirModalClienteArticulo() {
  if (!state.clienteActualId) return;
  _invArticulosTodos = await api('/api/inventario/articulos');
  if (!_invArticulosTodos.some(a => a.activo && a.stock > 0)) { avisar('No hay stock disponible para entregar.'); return; }
  obtenerComboClienteArticulo().limpiar();
  $('#cliente-articulo-cantidad').value = ''; $('#cliente-articulo-referencia').value = '';
  $('#cliente-articulo-equipo').checked = false;
  $('#cliente-articulo-equipo-campos').classList.add('hidden'); $('#cliente-articulo-equipo-aviso').classList.add('hidden');
  poblarSelect('#cliente-articulo-equipo-tipo', state.config.tipos_equipo || LISTA_DEFAULTS.tipos_equipo);
  $('#cliente-articulo-equipo-serie').value = ''; $('#cliente-articulo-equipo-garantia').value = 24;
  $('#modal-cliente-articulo').showModal();
}
function actualizarCamposClienteArticuloEquipo() {
  const activo = $('#cliente-articulo-equipo').checked;
  const cantidadValida = Number($('#cliente-articulo-cantidad').value) === 1;
  $('#cliente-articulo-equipo-campos').classList.toggle('hidden', !(activo && cantidadValida));
  $('#cliente-articulo-equipo-aviso').classList.toggle('hidden', !(activo && !cantidadValida));
}
$('#btn-cliente-articulo').addEventListener('click', () => abrirModalClienteArticulo().catch(err => avisar(err.message)));
$('#btn-cliente-articulo-cancelar').addEventListener('click', () => $('#modal-cliente-articulo').close());
$('#cliente-articulo-equipo').addEventListener('change', actualizarCamposClienteArticuloEquipo);
$('#cliente-articulo-cantidad').addEventListener('input', actualizarCamposClienteArticuloEquipo);
$('#btn-cliente-articulo-generar-serie').addEventListener('click', async () => {
  const btn = $('#btn-cliente-articulo-generar-serie'); btn.disabled = true;
  try { const { serie } = await api(`/api/generar-serie?tipo=${encodeURIComponent($('#cliente-articulo-equipo-tipo').value)}`); $('#cliente-articulo-equipo-serie').value = serie; }
  finally { btn.disabled = false; }
});
$('#form-cliente-articulo').addEventListener('submit', async e => {
  e.preventDefault();
  const articuloId = $('#cliente-articulo-id').value;
  if (!articuloId) { avisar('Busca y selecciona un artículo.'); $('#cliente-articulo-busqueda').focus(); return; }
  const comoEquipo = $('#cliente-articulo-equipo').checked;
  if (comoEquipo && Number($('#cliente-articulo-cantidad').value) !== 1) { avisar('Para registrarlo también como equipo, la cantidad debe ser 1.'); return; }
  if (comoEquipo && !$('#cliente-articulo-equipo-serie').value.trim()) { avisar('Indica el número de serie del equipo.'); $('#cliente-articulo-equipo-serie').focus(); return; }
  try {
    await api('/api/inventario/salidas', { method: 'POST', body: JSON.stringify({ cliente_id: state.clienteActualId, referencia: $('#cliente-articulo-referencia').value.trim(), lineas: [{ articulo_id: articuloId, cantidad: $('#cliente-articulo-cantidad').value }] }) });
    if (comoEquipo) {
      await api(`/api/clientes/${state.clienteActualId}/equipos`, { method: 'POST', body: JSON.stringify({ tipo: $('#cliente-articulo-equipo-tipo').value, nombre: $('#cliente-articulo-busqueda').value.trim(), numero_serie: $('#cliente-articulo-equipo-serie').value.trim(), fecha_entrega: new Date().toISOString().slice(0, 10), meses_garantia: $('#cliente-articulo-equipo-garantia').value }) });
      await cargarEquipos(state.clienteActualId);
    }
    $('#modal-cliente-articulo').close();
    await avisar(comoEquipo ? 'Artículo entregado: registrado como salida y como equipo.' : 'Artículo entregado y registrado como salida.');
  } catch (err) { avisar(err.message); }
});
$('#btn-cliente-ver-salidas').addEventListener('click', () => {
  if (!state.clienteActualId) return;
  location.href = `/inventario?cliente=${state.clienteActualId}&view=salidas`;
});
$('#btn-cliente-licencias').addEventListener('click', () => {
  if (!state.clienteActualId) return;
  location.href = `/licencias?cliente=${encodeURIComponent($('#cliente-nombre').textContent)}`;
});

// ---------- Componentes ----------

function abrirModalComponente(equipoId, componente = null) {
  $('#modal-componente-titulo').textContent = componente ? 'Editar componente' : 'Nuevo componente';
  $('#componente-id').value = componente ? componente.id : '';
  $('#componente-equipo-id').value = equipoId;
  $('#input-componente-tipo').value = componente ? componente.tipo : '';
  $('#input-componente-descripcion').value = componente ? (componente.descripcion || '') : '';
  $('#input-componente-serie').value = componente ? (componente.numero_serie || '') : '';
  $('#modal-componente').showModal();
}
$('#form-componente').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#componente-id').value, equipoId = $('#componente-equipo-id').value;
  const payload = { tipo: $('#input-componente-tipo').value, descripcion: $('#input-componente-descripcion').value, numero_serie: $('#input-componente-serie').value };
  try {
    if (id) await api(`/api/componentes/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api(`/api/equipos/${equipoId}/componentes`, { method: 'POST', body: JSON.stringify(payload) });
    await recargarEquiposActual();
    $('#modal-componente').close();
  } catch (err) { avisar(err.message); }
});
async function borrarComponente(id) {
  if (!(await confirmar('¿Eliminar este componente?', { peligro: true, textoOk: 'Eliminar' }))) return;
  await api(`/api/componentes/${id}`, { method: 'DELETE' });
  await recargarEquiposActual();
}

// ---------- Fotos ----------

function abrirModalFotos(equipoId, intervencionId = '') {
  $('#fotos-equipo-id').value = equipoId; $('#fotos-intervencion-id').value = intervencionId; $('#input-fotos').value = '';
  $('#modal-fotos').showModal();
}
$('#form-fotos').addEventListener('submit', async e => {
  e.preventDefault();
  const equipoId = $('#fotos-equipo-id').value, intervencionId = $('#fotos-intervencion-id').value, archivos = $('#input-fotos').files;
  if (!archivos || archivos.length === 0) return;
  const formData = new FormData();
  Array.from(archivos).forEach(f => formData.append('fotos', f));
  const url = intervencionId ? `/api/historial/${intervencionId}/fotos` : `/api/equipos/${equipoId}/fotos`;
  try {
    const res = await fetch(url, { method: 'POST', body: formData });
    if (!res.ok) { let msg = 'Error al subir las fotos'; try { msg = (await res.json()).error || msg; } catch (e) {} throw new Error(msg); }
    await recargarEquiposActual();
    $('#modal-fotos').close();
  } catch (err) { avisar(err.message); }
});
async function borrarFoto(id) {
  if (!(await confirmar('¿Eliminar esta foto?', { peligro: true, textoOk: 'Eliminar' }))) return;
  await api(`/api/fotos/${id}`, { method: 'DELETE' });
  await recargarEquiposActual();
}
function abrirVisorFoto(src) { $('#visor-foto-img').src = src; $('#modal-visor-foto').showModal(); }

// ---------- Archivos adjuntos ----------

function abrirModalArchivo(equipoId) {
  $('#archivo-equipo-id').value = equipoId; $('#input-archivo-file').value = '';
  poblarSelect('#input-archivo-categoria', state.config.categorias_archivo || LISTA_DEFAULTS.categorias_archivo);
  $('#input-archivo-descripcion').value = '';
  $('#modal-archivo').showModal();
}
$('#form-archivo').addEventListener('submit', async e => {
  e.preventDefault();
  const equipoId = $('#archivo-equipo-id').value, files = $('#input-archivo-file').files;
  if (!files || files.length === 0) return;
  const formData = new FormData();
  formData.append('archivo', files[0]); formData.append('categoria', $('#input-archivo-categoria').value); formData.append('descripcion', $('#input-archivo-descripcion').value);
  try {
    const res = await fetch(`/api/equipos/${equipoId}/archivos`, { method: 'POST', body: formData });
    if (!res.ok) { let msg = 'Error al subir el archivo'; try { msg = (await res.json()).error || msg; } catch (e) {} throw new Error(msg); }
    await recargarEquiposActual();
    $('#modal-archivo').close();
  } catch (err) { avisar(err.message); }
});
async function borrarArchivo(id) {
  if (!(await confirmar('¿Eliminar este archivo adjunto?', { peligro: true, textoOk: 'Eliminar' }))) return;
  await api(`/api/archivos/${id}`, { method: 'DELETE' });
  await recargarEquiposActual();
}

// ---------- Historial de intervenciones ----------

function abrirModalHistorial(equipoId, entrada = null) {
  const tecnicos = state.config.tecnicos || [];
  const selTec = $('#input-historial-tecnico');
  selTec.innerHTML = `<option value="">— Sin asignar —</option>` + tecnicos.map(t => `<option value="${escapeHtml(t)}"${entrada?.tecnico === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('');
  if (entrada?.tecnico && !tecnicos.includes(entrada.tecnico)) selTec.innerHTML += `<option value="${escapeHtml(entrada.tecnico)}" selected>${escapeHtml(entrada.tecnico)}</option>`;
  poblarSelect('#input-historial-tipo', state.config.tipos_intervencion || LISTA_DEFAULTS.tipos_intervencion, entrada?.tipo || null);
  $('#modal-historial-titulo').textContent = entrada ? 'Editar intervención' : 'Nueva intervención';
  $('#historial-id').value = entrada ? entrada.id : '';
  $('#historial-equipo-id').value = equipoId;
  $('#input-historial-fecha').value = entrada ? entrada.fecha : new Date().toISOString().slice(0, 10);
  $('#input-historial-tipo').value = entrada ? entrada.tipo : 'Reparación';
  $('#input-historial-problema').value = entrada ? (entrada.problema_reportado || '') : '';
  $('#input-historial-descripcion').value = entrada ? entrada.descripcion : '';
  $('#input-historial-tecnico').value = entrada ? (entrada.tecnico || '') : (state.usuario?.nombre || '');
  $('#input-historial-coste').value = entrada && entrada.coste != null ? entrada.coste : '';
  $('#input-historial-proxima').value = entrada ? (entrada.proxima_revision || '') : '';
  $('#modal-historial').showModal();
  api('/api/plantillas').then(ps => {
    $('#select-plantilla-hist').innerHTML = '<option value="">— Usar plantilla —</option>' + ps.map(p => `<option value="${escapeHtml(p.contenido)}">${escapeHtml(p.nombre)}${p.tipo ? ` (${escapeHtml(p.tipo)})` : ''}</option>`).join('');
  }).catch(() => {});
}
$('#select-plantilla-hist').addEventListener('change', async e => {
  const valor = e.target.value; if (!valor) return;
  const desc = $('#input-historial-descripcion');
  if (desc.value && !(await confirmar('¿Reemplazar el texto actual con la plantilla?'))) { e.target.value = ''; return; }
  desc.value = valor; e.target.value = '';
});
$('#form-historial').addEventListener('submit', async e => {
  e.preventDefault();
  const id = $('#historial-id').value, equipoId = $('#historial-equipo-id').value, costeVal = $('#input-historial-coste').value;
  const payload = {
    fecha: $('#input-historial-fecha').value, tipo: $('#input-historial-tipo').value, problema_reportado: $('#input-historial-problema').value || null,
    descripcion: $('#input-historial-descripcion').value, tecnico: $('#input-historial-tecnico').value || null,
    coste: costeVal !== '' ? Number(costeVal) : null, proxima_revision: $('#input-historial-proxima').value || null,
  };
  try {
    if (id) await api(`/api/historial/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api(`/api/equipos/${equipoId}/historial`, { method: 'POST', body: JSON.stringify(payload) });
    await recargarEquiposActual();
    $('#modal-historial').close();
  } catch (err) { avisar(err.message); }
});
async function borrarIntervencion(id) {
  if (!(await confirmar('¿Eliminar esta intervención? Las fotos adjuntas pasarán a fotos generales del equipo.', { peligro: true, textoOk: 'Eliminar' }))) return;
  await api(`/api/historial/${id}`, { method: 'DELETE' });
  await recargarEquiposActual();
}

// ---------- Etiquetas QR ----------

function actualizarBotonEtiquetas() {
  const btn = $('#btn-etiquetas-seleccionadas'); if (!btn) return;
  const total = state.etiquetasSeleccionadas.size;
  btn.textContent = `QR seleccionados (${total})`;
  btn.disabled = total === 0;
}
let _etiquetaEquipoId = null, _etiquetaEquipoIds = [], _etiquetaEnLote = false;
function abrirModalEtiqueta(equipoId) {
  _etiquetaEquipoId = equipoId; _etiquetaEquipoIds = [String(equipoId)]; _etiquetaEnLote = false;
  $('#etq-copias-opciones').classList.remove('hidden'); $('#etq-columnas-label').classList.remove('hidden');
  $('#etq-copias').value = 1; $('#etq-columnas').value = 1;
  $('#modal-etiqueta-titulo').textContent = 'Etiqueta';
  $('#modal-etiqueta-ayuda').textContent = 'Elige qué incluir y cuántas copias imprimir.';
  const prefs = JSON.parse(localStorage.getItem('etiquetaPrefs') || '{}');
  ['serie', 'nombre', 'tipo', 'cliente', 'qr'].forEach(k => { $(`#etq-${k}`).checked = prefs[k] !== undefined ? prefs[k] : true; });
  $('#modal-etiqueta').showModal();
}
function abrirModalEtiquetasSeleccionadas() {
  const ids = [...state.etiquetasSeleccionadas]; if (!ids.length) return;
  _etiquetaEquipoId = null; _etiquetaEquipoIds = ids; _etiquetaEnLote = true;
  $('#etq-copias-opciones').classList.remove('hidden'); $('#etq-columnas-label').classList.add('hidden');
  $('#etq-copias').value = 1; $('#etq-columnas').value = 1;
  const prefs = JSON.parse(localStorage.getItem('etiquetaPrefs') || '{}');
  ['serie', 'nombre', 'tipo', 'cliente', 'qr'].forEach(k => { $(`#etq-${k}`).checked = prefs[k] !== undefined ? prefs[k] : true; });
  $('#modal-etiqueta-titulo').textContent = 'Etiquetas QR';
  $('#modal-etiqueta-ayuda').textContent = `${ids.length} etiquetas · se imprimirán seguidas en rollo térmico de 80 mm.`;
  $('#modal-etiqueta').showModal();
}
$('#btn-etiquetas-seleccionadas').addEventListener('click', abrirModalEtiquetasSeleccionadas);
$('#etq-columnas').addEventListener('change', e => {
  const columnas = Number(e.target.value) || 1, copias = Number($('#etq-copias').value) || 1;
  if (copias < columnas) $('#etq-copias').value = columnas;
});
$('#btn-etiqueta-cancelar').addEventListener('click', () => {
  $('#modal-etiqueta').close(); $('#modal-etiqueta-titulo').textContent = 'Etiqueta';
  $('#modal-etiqueta-ayuda').textContent = 'Elige qué incluir en la etiqueta.'; $('#etq-copias-opciones').classList.remove('hidden');
});
$('#form-etiqueta').addEventListener('submit', e => {
  e.preventDefault();
  const prefs = { serie: $('#etq-serie').checked, nombre: $('#etq-nombre').checked, tipo: $('#etq-tipo').checked, cliente: $('#etq-cliente').checked, qr: $('#etq-qr').checked };
  localStorage.setItem('etiquetaPrefs', JSON.stringify(prefs));
  const qs = Object.entries(prefs).filter(([, v]) => v).map(([k]) => `${k}=1`).join('&');
  const copias = Math.max(1, Math.min(60, Number.parseInt($('#etq-copias').value, 10) || 1));
  const columnas = Math.max(1, Math.min(3, Number.parseInt($('#etq-columnas').value, 10) || 1));
  const copiasAjustadas = _etiquetaEquipoIds.length === 1 ? Math.max(copias, columnas) : copias;
  $('#etq-copias').value = copiasAjustadas;
  $('#modal-etiqueta').close();
  const usarFormatoMultiple = _etiquetaEnLote || copias > 1 || columnas > 1;
  const url = usarFormatoMultiple
    ? `/api/etiquetas?ids=${encodeURIComponent(_etiquetaEquipoIds.join(','))}&copias=${copiasAjustadas}&columnas=${columnas}&${qs}`
    : `/api/equipos/${_etiquetaEquipoId}/etiqueta?${qs}`;
  const w = window.open(url, '_blank', _etiquetaEnLote ? '' : 'width=400,height=300');
  if (!w) avisar('El navegador bloqueó la ventana emergente. Permite ventanas emergentes para esta página.');
  $('#modal-etiqueta-titulo').textContent = 'Etiqueta'; $('#modal-etiqueta-ayuda').textContent = 'Elige qué incluir en la etiqueta.'; $('#etq-copias-opciones').classList.remove('hidden');
});

// ---------- Etiqueta de envío ----------

$('#btn-etiqueta-envio').addEventListener('click', () => {
  if (!state.clienteActualId) return;
  const dlg = document.getElementById('modal-retorno');
  dlg.showModal();
  dlg.addEventListener('close', async () => {
    const retorno = dlg.returnValue === 'si' ? 1 : 0;
    const url = `/api/clientes/${state.clienteActualId}/etiqueta-envio?retorno=${retorno}`;
    const impresora = state.config.impresora_envio || '';
    if (impresora) {
      try {
        const r = await fetch(url); const html = await r.text();
        const res = await api('/api/imprimir-envio', { method: 'POST', body: JSON.stringify({ html, impresora }) });
        if (!res?.ok) throw new Error('Sin respuesta');
        return;
      } catch (e) { /* fallback a navegador */ }
    }
    window.open(url, '_blank', 'width=420,height=380');
  }, { once: true });
});

// ---------- Configuración (listas usadas en esta página) ----------

async function cargarConfig() {
  const raw = await api('/api/config');
  state.config = {
    tecnicos: raw.tecnicos ? JSON.parse(raw.tecnicos) : [...LISTA_DEFAULTS.tecnicos],
    tipos_intervencion: raw.tipos_intervencion ? JSON.parse(raw.tipos_intervencion) : [...LISTA_DEFAULTS.tipos_intervencion],
    categorias_archivo: raw.categorias_archivo ? JSON.parse(raw.categorias_archivo) : [...LISTA_DEFAULTS.categorias_archivo],
    tipos_equipo: raw.tipos_equipo ? JSON.parse(raw.tipos_equipo) : [...LISTA_DEFAULTS.tipos_equipo],
    lista_software: raw.lista_software ? JSON.parse(raw.lista_software) : [...LISTA_DEFAULTS.lista_software],
    tipos_credencial: raw.tipos_credencial ? JSON.parse(raw.tipos_credencial) : [...LISTA_DEFAULTS.tipos_credencial],
    impresora_envio: raw.impresora_envio || '',
  };
  const estadosArr = raw.ticket_estados ? JSON.parse(raw.ticket_estados) : DEFAULT_TICKET_ESTADOS_OBJ;
  state.config.ticket_estados = estadosArr;
  aplicarEstadosTicket(estadosArr);
}

// ---------- Arranque ----------

async function iniciar() {
  state.usuario = await api('/api/me');
  mostrarUsuarioEnTopbar();
  await cargarConfig();
  await cargarSwIcons();
  await cargarClientes();
  actualizarBadgeTickets();

  const m = location.pathname.match(/^\/clientes\/(\d+)$/);
  if (location.pathname === '/oficina') await seleccionarSinCliente();
  else if (m) await seleccionarCliente(Number(m[1]));

  const hashMatch = location.hash.match(/^#equipo-(\d+)$/);
  if (hashMatch) setTimeout(() => resaltarEquipoEnPagina(hashMatch[1]), 150);
}

iniciar();
