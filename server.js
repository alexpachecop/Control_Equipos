/**
 * server.js — Backend de Control de Equipos (megasOS)
 * ======================================================
 * API REST con Express + SQLite (better-sqlite3, ver db.js) para un único
 * proceso Node, sin microservicios ni build step. Sirve también el frontend
 * estático (public/) y los archivos subidos (uploads/).
 *
 * Organización: las rutas están agrupadas por dominio bajo comentarios
 * "---------- Sección ----------" (Clientes, Equipos, Tickets, Inventario,
 * Licencias, Envíos, Email/SMTP...). Dentro de cada sección, el patrón es
 * siempre CRUD + consultas auxiliares para esa tabla.
 *
 * Empaquetado: `npm run build:exe` compila esto a un único .exe con
 * @yao-pkg/pkg. Como el snapshot del .exe es de solo lectura, cualquier
 * ruta que necesite escribir (data.sqlite, uploads/) se redirige junto al
 * propio ejecutable — ver `baseDir` más abajo y el mismo patrón en db.js.
 *
 * Autenticación: tokens de sesión propios guardados en la tabla `sesiones`
 * (no express-session), para que sobrevivan a un reinicio del proceso.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');
const nodemailer = require('nodemailer');
const multer = require('multer');
const sharp = require('sharp');
const ExcelJS = require('exceljs');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = Number.parseInt(process.env.PORT, 10) || 4000;

const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;

function pillTextColor(hex) {
  const c = hex || '#94a3b8';
  const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  const lum = (0.299*r + 0.587*g + 0.114*b) / 255;
  if (lum <= 0.6) return c;
  return '#'+[r,g,b].map(x=>Math.round(x*0.5).toString(16).padStart(2,'0')).join('');
}
// La impresión "silenciosa" (Start-Process / abrir navegador) solo tiene sentido
// si el navegador que pide imprimir corre en la MISMA máquina que el servidor
// (el proceso se lanza en el PC del servidor, no en el del cliente). Si alguien
// accede desde otro PC de la red, hay que dejar que su propio navegador
// imprima (diálogo nativo), o el trabajo saldría siempre por el servidor.
function esSolicitudLocal(req) {
  const ip = (req.ip || req.socket.remoteAddress || '').replace('::ffff:', '');
  if (ip === '127.0.0.1' || ip === '::1') return true;
  return Object.values(os.networkInterfaces()).flat().some(i => i && i.address === ip);
}

const uploadsDir = path.join(baseDir, 'uploads');
const archivosDir = path.join(baseDir, 'archivos');
fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(archivosDir, { recursive: true });

// ---------- Multer: fotos ----------

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) return cb(new Error('Solo se admiten imágenes'));
    cb(null, true);
  },
});

async function guardarFotoComprimida(buffer) {
  const nombre = `${Date.now()}-${Math.round(Math.random() * 1e9)}.jpg`;
  await sharp(buffer)
    .rotate()
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 })
    .toFile(path.join(uploadsDir, nombre));
  return nombre;
}

function runMulterFotos(req, res) {
  return new Promise((resolve, reject) =>
    upload.array('fotos', 10)(req, res, err => err ? reject(err) : resolve())
  );
}

// ---------- Multer: archivos adjuntos ----------

const MIMETYPES_ARCHIVOS = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
]);

const storageArchivos = multer.diskStorage({
  destination: (req, file, cb) => cb(null, archivosDir),
  filename: (req, file, cb) => {
    const unico = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unico}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const uploadArchivo = multer({
  storage: storageArchivos,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!MIMETYPES_ARCHIVOS.has(file.mimetype)) return cb(new Error('Tipo de archivo no permitido'));
    cb(null, true);
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

function optionalText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function optionalNumber(value, fieldName, limits = {}) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${fieldName} debe ser un número válido`);
  if (limits.min != null && number < limits.min) throw new Error(`${fieldName} no puede ser menor que ${limits.min}`);
  if (limits.max != null && number > limits.max) throw new Error(`${fieldName} no puede ser mayor que ${limits.max}`);
  return number;
}

// ---------- Auth ----------

function parseCookies(req) {
  const result = {};
  (req.headers.cookie || '').split(';').forEach(c => {
    const [k, ...v] = c.trim().split('=');
    if (k) result[k.trim()] = decodeURIComponent(v.join('=').trim());
  });
  return result;
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function getUsuarioFromReq(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db.prepare(`
    SELECT u.id, u.username, u.nombre, u.rol, u.email
    FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira_en > datetime('now') AND u.activo = 1
  `).get(token) || null;
}

function requireAuth(req, res, next) {
  req.usuario = getUsuarioFromReq(req);
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
}

function requireAdmin(req, res, next) {
  if (req.usuario?.rol !== 'admin') return res.status(403).json({ error: 'Se requiere rol admin' });
  next();
}

// ---------- Auth routes (public) ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Usuario y contraseña requeridos' });
  const user = db.prepare(`SELECT * FROM usuarios WHERE username = ? AND activo = 1`).get(username.trim());
  if (!user || hashPassword(password, user.salt) !== user.password_hash)
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`INSERT INTO sesiones (token, usuario_id, expira_en) VALUES (?, ?, ?)`).run(token, user.id, expira);
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`);
  res.json({ id: user.id, username: user.username, nombre: user.nombre, rol: user.rol });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req).sid;
  if (token) db.prepare(`DELETE FROM sesiones WHERE token = ?`).run(token);
  res.setHeader('Set-Cookie', `sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const u = getUsuarioFromReq(req);
  if (!u) return res.status(401).json({ error: 'No autenticado' });
  res.json(u);
});

// ---------- Páginas (app multipágina: cada sección es una ruta real con su propio HTML+JS) ----------

function pageAuth(req, res, next) {
  req.usuario = getUsuarioFromReq(req);
  if (!req.usuario) return res.redirect('/login');
  next();
}

function pageGuest(req, res, next) {
  if (getUsuarioFromReq(req)) return res.redirect('/');
  next();
}

function sendPage(name) {
  return (req, res) => res.sendFile(path.join(__dirname, 'public', 'pages', name, name + '.html'));
}

app.get('/login', pageGuest, sendPage('login'));
app.get('/', pageAuth, sendPage('inicio'));
app.get('/clientes/:id', pageAuth, sendPage('ficha'));
app.get('/oficina', pageAuth, sendPage('ficha'));
app.get('/tickets', pageAuth, sendPage('tickets'));
app.get('/inventario', pageAuth, sendPage('inventario'));
app.get('/envios', pageAuth, sendPage('envios'));
app.get('/licencias', pageAuth, sendPage('licencias'));
app.get('/configuracion', pageAuth, sendPage('configuracion'));

// ---------- Reset HTML helper ----------

function resetBox(title, color, body, extra = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9}
.box{background:#fff;border-radius:12px;padding:36px;max-width:380px;width:100%;box-shadow:0 4px 24px rgba(0,0,0,.1);text-align:center}
h2{color:${color};margin:0 0 12px}p{color:#64748b}${extra}</style></head>
<body><div class="box">${body}</div></body></html>`;
}

// ---------- Recuperación de contraseña ----------

app.post('/api/solicitar-reset', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Usuario requerido' });
  const user = db.prepare(`SELECT id, nombre, email FROM usuarios WHERE username = ? AND activo = 1`).get(username.trim());
  if (!user) return res.json({ ok: true }); // no revelar si existe o no
  const cfg = getCfg();
  const destino = (user.email || '').trim() || (cfg.correo_recuperacion || '').trim();
  if (!destino) return res.status(400).json({ error: 'No tienes email configurado y no hay correo de recuperación general. Contacta con el administrador.' });
  const transporter = crearTransporter(cfg);
  if (!transporter) return res.status(400).json({ error: 'SMTP no configurado. Contacta con el administrador.' });
  const from = getFromAddress(cfg);
  if (!from) return res.status(400).json({ error: 'Remitente SMTP no configurado.' });
  db.prepare(`DELETE FROM reset_tokens WHERE usuario_id = ?`).run(user.id);
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare(`INSERT INTO reset_tokens (token, usuario_id, expira_en) VALUES (?, ?, ?)`).run(token, user.id, expira);
  const host = req.headers.host || `localhost:${PORT}`;
  const link = `http://${host}/reset/${token}`;
  try {
    await transporter.sendMail({
      from,
      to: destino,
      subject: `Recuperación de contraseña — ${user.nombre}`,
      html: `<p>Se ha solicitado restablecer la contraseña del usuario <strong>${user.nombre}</strong> (<em>${username}</em>).</p>
<p>Haz clic en el siguiente enlace para establecer una nueva contraseña (válido 2 horas):</p>
<p><a href="${link}">${link}</a></p>
<p>Si no solicitaste este cambio, ignora este correo.</p>`,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Error al enviar el correo: ' + e.message });
  }
});

app.get('/reset/:token', (req, res) => {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const row = db.prepare(`SELECT r.token, r.expira_en, u.nombre, u.username FROM reset_tokens r JOIN usuarios u ON u.id = r.usuario_id WHERE r.token = ?`).get(req.params.token);
  if (!row || row.expira_en <= now)
    return res.send(resetBox('Enlace inválido', '#ef4444', '<h2>Enlace inválido o expirado</h2><p>Solicita un nuevo enlace de recuperación.</p>'));
  res.send(resetBox('Nueva contraseña', '#0f1b3d',
    `<h2 style="text-align:left">Nueva contraseña</h2>
  <p style="text-align:left">Usuario: <strong>${row.nombre}</strong> (${row.username})</p>
  <form method="POST" style="text-align:left">
    <label>Nueva contraseña<input type="password" name="password" placeholder="Mínimo 4 caracteres" required autocomplete="new-password"></label>
    <label>Repetir contraseña<input type="password" name="password2" placeholder="Repite la contraseña" required autocomplete="new-password"></label>
    <button type="submit">Guardar contraseña</button>
  </form>`,
    `label{display:flex;flex-direction:column;gap:6px;font-size:.88rem;font-weight:600;color:#374151;margin-bottom:14px}
input{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:1rem;outline:none}
input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.15)}
button{width:100%;padding:10px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
button:hover{background:#1d4ed8}`
  ));
});

app.post('/reset/:token', express.urlencoded({ extended: false }), (req, res) => {
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const row = db.prepare(`SELECT r.usuario_id, r.expira_en FROM reset_tokens r WHERE r.token = ?`).get(req.params.token);
  if (!row || row.expira_en <= now)
    return res.send(resetBox('Enlace inválido', '#ef4444', '<h2>Enlace inválido o expirado</h2><p>Solicita un nuevo enlace de recuperación.</p>'));
  const { password, password2 } = req.body;
  if (!password || password.length < 4 || password !== password2)
    return res.send(resetBox('Error', '#ef4444',
      `<h2>Error</h2><p>${password !== password2 ? 'Las contraseñas no coinciden.' : 'Mínimo 4 caracteres.'}</p><p><a href="/reset/${req.params.token}" style="color:#2563eb">← Volver</a></p>`));
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.prepare(`UPDATE usuarios SET password_hash = ?, salt = ? WHERE id = ?`).run(hash, salt, row.usuario_id);
  db.prepare(`DELETE FROM reset_tokens WHERE token = ?`).run(req.params.token);
  db.prepare(`DELETE FROM sesiones WHERE usuario_id = ?`).run(row.usuario_id);
  res.send(resetBox('Contraseña actualizada', '#16a34a',
    `<h2>✓ Contraseña actualizada</h2><p>Ya puedes iniciar sesión con tu nueva contraseña.</p>
<a href="/" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">Ir al inicio</a>`));
});

// ---------- Middleware auth para todas las demás rutas /api ----------

const AUTH_PUBLIC = new Set(['/login', '/logout', '/me', '/ping', '/solicitar-reset']);
app.use('/api', (req, res, next) => {
  if (AUTH_PUBLIC.has(req.path)) return next();
  req.usuario = getUsuarioFromReq(req);
  if (!req.usuario) return res.status(401).json({ error: 'No autenticado' });
  next();
});

// ---------- Gestión de usuarios (admin) ----------

app.get('/api/usuarios', requireAuth, requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id, username, nombre, email, rol, activo, creado_en FROM usuarios ORDER BY nombre COLLATE NOCASE`).all());
});

app.post('/api/usuarios', requireAuth, requireAdmin, (req, res) => {
  const { username, nombre, password, rol } = req.body;
  if (!username?.trim() || !nombre?.trim() || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });
  const existing = db.prepare(`SELECT id FROM usuarios WHERE username = ?`).get(username.trim());
  if (existing) return res.status(409).json({ error: 'El usuario ya existe' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const info = db.prepare(`INSERT INTO usuarios (username, nombre, password_hash, salt, rol) VALUES (?, ?, ?, ?, ?)`).run(username.trim(), nombre.trim(), hash, salt, rol === 'admin' ? 'admin' : 'tecnico');
  res.status(201).json(db.prepare(`SELECT id, username, nombre, rol, activo FROM usuarios WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/usuarios/:id/password', requireAuth, (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
  // Solo admin puede cambiar contraseña de otro; cualquiera puede cambiar la propia
  if (String(req.usuario.id) !== req.params.id && req.usuario.rol !== 'admin')
    return res.status(403).json({ error: 'Sin permiso' });
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  db.prepare(`UPDATE usuarios SET password_hash = ?, salt = ? WHERE id = ?`).run(hash, salt, req.params.id);
  res.json({ ok: true });
});

app.put('/api/usuarios/:id/perfil', requireAuth, (req, res) => {
  if (String(req.usuario.id) !== req.params.id && req.usuario.rol !== 'admin')
    return res.status(403).json({ error: 'Sin permiso' });
  const { email, password } = req.body;
  if (password) {
    if (password.length < 4) return res.status(400).json({ error: 'Contraseña mínimo 4 caracteres' });
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = hashPassword(password, salt);
    db.prepare(`UPDATE usuarios SET email = ?, password_hash = ?, salt = ? WHERE id = ?`).run((email || '').trim() || null, hash, salt, req.params.id);
  } else {
    db.prepare(`UPDATE usuarios SET email = ? WHERE id = ?`).run((email || '').trim() || null, req.params.id);
  }
  res.json(db.prepare(`SELECT id, username, nombre, email, rol, activo FROM usuarios WHERE id = ?`).get(req.params.id));
});

app.delete('/api/usuarios/:id', requireAuth, requireAdmin, (req, res) => {
  if (String(req.usuario.id) === req.params.id) return res.status(400).json({ error: 'No puedes eliminarte a ti mismo' });
  const info = db.prepare(`UPDATE usuarios SET activo = 0 WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
  db.prepare(`DELETE FROM sesiones WHERE usuario_id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---------- Helpers ----------

function borrarFotoDeDisco(archivo) {
  fs.unlink(path.join(uploadsDir, archivo), () => {});
}

function borrarArchivoDeDisco(archivo) {
  fs.unlink(path.join(archivosDir, archivo), () => {});
}

// ---------- Email ----------

function getCfg() {
  const cfg = {};
  db.prepare('SELECT clave, valor FROM configuracion').all().forEach(r => cfg[r.clave] = r.valor);
  return cfg;
}

function crearTransporter(cfg) {
  if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) return null;
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: Number(cfg.smtp_port) || 587,
    secure: cfg.smtp_secure === '1',
    auth: { user: cfg.smtp_user, pass: cfg.smtp_pass },
    tls: { rejectUnauthorized: false },
  });
}

function getFromAddress(cfg) {
  const from = (cfg.smtp_from || '').trim() || (cfg.smtp_user || '').trim();
  return from || null;
}


// ---------- Tickets ----------

const TICKET_WITH_EQUIPO = `
  SELECT t.*,
    e.nombre        AS _eq_nombre,
    e.tipo          AS _eq_tipo,
    e.numero_serie  AS _eq_serie,
    e.cliente_id    AS _eq_cliente_id,
    COALESCE(ceq.nombre, cdir.nombre) AS _cl_nombre,
    COALESCE(ceq.email,  cdir.email)  AS _cl_email
  FROM tickets t
  LEFT JOIN equipos   e   ON e.id   = t.equipo_id
  LEFT JOIN clientes ceq  ON ceq.id = e.cliente_id
  LEFT JOIN clientes cdir ON cdir.id = t.cliente_id`;

function shapeTicket(row) {
  const { _eq_nombre, _eq_tipo, _eq_serie, _eq_cliente_id, _cl_nombre, _cl_email, ...t } = row;
  if (t.equipo_id)
    return { ...t, equipo: { nombre: _eq_nombre, tipo: _eq_tipo, numero_serie: _eq_serie, cliente_id: _eq_cliente_id, cliente_nombre: _cl_nombre, cliente_email: _cl_email } };
  if (t.cliente_id)
    return { ...t, equipo: { nombre: null, tipo: 'Incidencia general', numero_serie: null, cliente_id: t.cliente_id, cliente_nombre: _cl_nombre, cliente_email: _cl_email } };
  return { ...t, equipo: null };
}

function generarNumeroTicket() {
  const now = new Date();
  const yyyymm = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0');
  const last = db.prepare(`SELECT numero FROM tickets WHERE numero LIKE ? ORDER BY id DESC LIMIT 1`).get(`TK-${yyyymm}-%`);
  const n = last ? parseInt(last.numero.split('-')[2]) + 1 : 1;
  return `TK-${yyyymm}-${String(n).padStart(4, '0')}`;
}

function enrichTicket(t) {
  if (t.equipo_id) {
    const eq = db.prepare(`SELECT e.nombre, e.tipo, e.numero_serie, e.cliente_id, c.nombre as cliente_nombre, c.email as cliente_email FROM equipos e LEFT JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?`).get(t.equipo_id);
    return { ...t, equipo: eq };
  }
  if (t.cliente_id) {
    const cl = db.prepare(`SELECT nombre, email FROM clientes WHERE id = ?`).get(t.cliente_id);
    return { ...t, equipo: { nombre: null, tipo: 'Incidencia general', numero_serie: null, cliente_id: t.cliente_id, cliente_nombre: cl?.nombre || null, cliente_email: cl?.email || null } };
  }
  return { ...t, equipo: null };
}

app.get('/api/tickets', (req, res) => {
  const { estado, tecnico, fecha_desde, fecha_hasta, q } = req.query;
  const where = [];
  const params = [];
  if (estado) { where.push(`t.estado = ?`); params.push(estado); }
  if (tecnico !== undefined) {
    if (tecnico === '') { where.push(`(t.tecnico_asignado IS NULL OR t.tecnico_asignado = '')`); }
    else { where.push(`t.tecnico_asignado = ?`); params.push(tecnico); }
  }
  if (fecha_desde) { where.push(`t.fecha_entrada >= ?`); params.push(fecha_desde); }
  if (fecha_hasta) { where.push(`t.fecha_entrada <= ?`); params.push(fecha_hasta); }
  if (q) {
    const like = `%${q}%`;
    where.push(`(t.numero LIKE ? OR t.descripcion LIKE ? OR t.solucion LIKE ? OR COALESCE(ceq.nombre, cdir.nombre) LIKE ? OR e.nombre LIKE ?)`);
    params.push(like, like, like, like, like);
  }
  const filter = where.length ? ` WHERE ${where.join(' AND ')}` : '';
  const tickets = db.prepare(`${TICKET_WITH_EQUIPO}${filter} ORDER BY t.creado_en DESC`).all(...params).map(shapeTicket);
  if (tickets.length > 0) {
    const ids = tickets.map(t => t.id);
    const logs = db.prepare(`SELECT ticket_id, valor_nuevo AS estado, creado_en FROM ticket_log WHERE ticket_id IN (${ids.map(() => '?').join(',')}) AND campo='estado' ORDER BY ticket_id, id ASC`).all(...ids);
    const byId = {};
    logs.forEach(l => { (byId[l.ticket_id] = byId[l.ticket_id] || []).push({ estado: l.estado, cuando: l.creado_en }); });
    tickets.forEach(t => { t.estado_log = byId[t.id] || []; });
  }
  res.json(tickets);
});

app.get('/api/equipos/:id/tickets', (req, res) => {
  res.json(db.prepare(`${TICKET_WITH_EQUIPO} WHERE t.equipo_id = ? ORDER BY t.creado_en DESC`).all(req.params.id).map(shapeTicket));
});

app.post('/api/equipos/:id/tickets', (req, res) => {
  const eq = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!eq) return res.status(404).json({ error: 'Equipo no encontrado' });
  const { descripcion, solucion, tecnico_asignado, fecha_entrada, fecha_estimada, coste, notas_internas, asignado_por, horas_trabajadas, transportista, numero_seguimiento } = req.body;
  const numero = generarNumeroTicket();
  let costeNum, horasNum;
  try {
    costeNum = optionalNumber(coste, 'El coste');
    horasNum = optionalNumber(horas_trabajadas, 'Las horas trabajadas');
  } catch (err) { return res.status(400).json({ error: err.message }); }
  const info = db.prepare(`INSERT INTO tickets (numero, equipo_id, descripcion, solucion, tecnico_asignado, asignado_por, fecha_entrada, fecha_estimada, coste, notas_internas, horas_trabajadas, transportista, numero_seguimiento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(numero, req.params.id, optionalText(descripcion), optionalText(solucion), optionalText(tecnico_asignado), optionalText(asignado_por), fecha_entrada || new Date().toISOString().slice(0,10), fecha_estimada || null, costeNum, optionalText(notas_internas), horasNum, optionalText(transportista), optionalText(numero_seguimiento));
  res.status(201).json(enrichTicket(db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(info.lastInsertRowid)));
});

app.get('/api/clientes/:id/tickets', (req, res) => {
  res.json(db.prepare(`${TICKET_WITH_EQUIPO} WHERE (t.cliente_id = ? OR ceq.id = ?) ORDER BY t.creado_en DESC`)
    .all(req.params.id, req.params.id).map(shapeTicket));
});

app.post('/api/clientes/:id/tickets', (req, res) => {
  const cl = db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(req.params.id);
  if (!cl) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { descripcion, solucion, tecnico_asignado, fecha_entrada, fecha_estimada, coste, notas_internas, asignado_por, horas_trabajadas, transportista, numero_seguimiento } = req.body;
  const numero = generarNumeroTicket();
  let costeNum, horasNum;
  try {
    costeNum = optionalNumber(coste, 'El coste');
    horasNum = optionalNumber(horas_trabajadas, 'Las horas trabajadas');
  } catch (err) { return res.status(400).json({ error: err.message }); }
  const info = db.prepare(`INSERT INTO tickets (numero, cliente_id, descripcion, solucion, tecnico_asignado, asignado_por, fecha_entrada, fecha_estimada, coste, notas_internas, horas_trabajadas, transportista, numero_seguimiento) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(numero, req.params.id, optionalText(descripcion), optionalText(solucion), optionalText(tecnico_asignado), optionalText(asignado_por), fecha_entrada || new Date().toISOString().slice(0,10), fecha_estimada || null, costeNum, optionalText(notas_internas), horasNum, optionalText(transportista), optionalText(numero_seguimiento));
  res.status(201).json(enrichTicket(db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(info.lastInsertRowid)));
});

app.put('/api/tickets/:id', (req, res) => {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
  const { estado, descripcion, solucion, tecnico_asignado, fecha_entrada, fecha_estimada, fecha_entrega, coste, notas_internas, asignado_por, horas_trabajadas, transportista, numero_seguimiento } = req.body;
  const tecnicoAnterior = ticket.tecnico_asignado;
  let costeNum;
  let horasNum;
  try {
    costeNum = coste === undefined ? ticket.coste : optionalNumber(coste, 'El coste');
    horasNum = horas_trabajadas === undefined ? ticket.horas_trabajadas : optionalNumber(horas_trabajadas, 'Las horas trabajadas');
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const vals = {
    estado:           estado            || ticket.estado,
    descripcion:      descripcion       ?? ticket.descripcion,
    solucion:         solucion          ?? ticket.solucion,
    tecnico_asignado: tecnico_asignado  ?? ticket.tecnico_asignado,
    asignado_por:     (tecnico_asignado && tecnico_asignado !== tecnicoAnterior && asignado_por)
                        ? asignado_por
                        : (asignado_por !== undefined ? asignado_por : ticket.asignado_por),
    fecha_entrada:    fecha_entrada     || ticket.fecha_entrada,
    fecha_estimada:   fecha_estimada    ?? ticket.fecha_estimada,
    fecha_entrega:    fecha_entrega     ?? ticket.fecha_entrega,
    coste:            costeNum,
    notas_internas:   notas_internas    ?? ticket.notas_internas,
    horas_trabajadas: horasNum,
    transportista:       transportista      ?? ticket.transportista,
    numero_seguimiento:  numero_seguimiento ?? ticket.numero_seguimiento,
  };
  db.prepare(`UPDATE tickets SET estado=?,descripcion=?,solucion=?,tecnico_asignado=?,asignado_por=?,fecha_entrada=?,fecha_estimada=?,fecha_entrega=?,coste=?,notas_internas=?,horas_trabajadas=?,transportista=?,numero_seguimiento=? WHERE id=?`)
    .run(vals.estado, vals.descripcion, vals.solucion, vals.tecnico_asignado, vals.asignado_por, vals.fecha_entrada, vals.fecha_estimada, vals.fecha_entrega, vals.coste, vals.notas_internas, vals.horas_trabajadas, vals.transportista, vals.numero_seguimiento, req.params.id);

  const usuario = req.usuario?.nombre || 'Sistema';
  const logStmt = db.prepare(`INSERT INTO ticket_log (ticket_id, usuario, campo, valor_anterior, valor_nuevo) VALUES (?, ?, ?, ?, ?)`);
  if (vals.estado !== ticket.estado)
    logStmt.run(req.params.id, usuario, 'estado', ticket.estado, vals.estado);
  if (vals.tecnico_asignado !== ticket.tecnico_asignado)
    logStmt.run(req.params.id, usuario, 'tecnico_asignado', ticket.tecnico_asignado || null, vals.tecnico_asignado || null);

  res.json(enrichTicket({ ...ticket, ...vals }));
});

app.delete('/api/tickets/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM tickets WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Ticket no encontrado' });
  res.status(204).end();
});

app.get('/api/tickets/:id/log', (req, res) => {
  res.json(db.prepare(`SELECT * FROM ticket_log WHERE ticket_id = ? ORDER BY id ASC`).all(req.params.id));
});

app.post('/api/tickets/:id/nota', (req, res) => {
  const ticket = db.prepare(`SELECT id FROM tickets WHERE id = ?`).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
  const { nota } = req.body;
  if (!nota?.trim()) return res.status(400).json({ error: 'Nota vacía' });
  const usuario = req.usuario?.nombre || 'Sistema';
  db.prepare(`INSERT INTO ticket_log (ticket_id, usuario, campo, valor_nuevo) VALUES (?, ?, 'nota', ?)`).run(req.params.id, usuario, nota.trim());
  res.json({ ok: true });
});

app.post('/api/tickets/:id/notificar', async (req, res) => {
  const ticket = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' });
  if (!ticket.tecnico_asignado) return res.status(400).json({ error: 'El ticket no tiene técnico asignado.' });

  const tecnico = db.prepare(`SELECT nombre, email FROM usuarios WHERE nombre = ? AND activo = 1`).get(ticket.tecnico_asignado);
  if (!tecnico?.email) return res.status(400).json({ error: `${ticket.tecnico_asignado} no tiene email configurado. Ve a Ajustes → Usuarios y añade su email.` });

  const cfg = getCfg();
  const transporter = crearTransporter(cfg);
  if (!transporter) return res.status(400).json({ error: 'SMTP no configurado.' });
  const from = getFromAddress(cfg);
  if (!from) return res.status(400).json({ error: 'Remitente SMTP no configurado.' });

  const eq = ticket.equipo_id
    ? db.prepare(`SELECT e.nombre, e.tipo, c.nombre as cliente_nombre FROM equipos e LEFT JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?`).get(ticket.equipo_id)
    : ticket.cliente_id
      ? { nombre: null, tipo: 'Incidencia general', cliente_nombre: db.prepare(`SELECT nombre FROM clientes WHERE id = ?`).get(ticket.cliente_id)?.nombre }
      : null;

  const nombre_taller = cfg.nombre_taller || 'Control de Equipos';
  const asignadoPor = (req.body.asignado_por || ticket.asignado_por || '').trim();

  const filas = [
    ['N.º ticket',   ticket.numero],
    eq?.cliente_nombre ? ['Cliente', eq.cliente_nombre] : null,
    eq?.nombre         ? ['Equipo',  `${eq.nombre}${eq.tipo ? ` (${eq.tipo})` : ''}`] : null,
    ticket.descripcion ? ['Problema reportado', ticket.descripcion] : null,
    ticket.fecha_estimada ? ['Fecha estimada', ticket.fecha_estimada.split('-').reverse().join('/')] : null,
    asignadoPor ? ['Asignado por', asignadoPor] : null,
  ].filter(Boolean).map(([k, v]) =>
    `<tr><td style="padding:6px 12px;font-weight:700;color:#374151;white-space:nowrap;vertical-align:top">${escH(k)}</td><td style="padding:6px 12px;color:#1e293b">${escH(v)}</td></tr>`
  ).join('');

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;background:#f8fafc">
<div style="max-width:560px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#0f1b3d,#2563eb);border-radius:12px 12px 0 0;padding:20px 24px">
    <h1 style="color:#fff;margin:0;font-size:1.1rem">${escH(nombre_taller)}</h1>
    <p style="color:rgba(255,255,255,0.75);margin:4px 0 0;font-size:0.85rem">Ticket asignado a ti</p>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;background:#fff;padding:20px 24px">
    <p style="margin:0 0 16px;font-size:0.95rem">Hola <strong>${escH(tecnico.nombre)}</strong>, se te ha asignado el siguiente ticket:</p>
    <table style="border-collapse:collapse;width:100%;background:#f8fafc;border-radius:8px;overflow:hidden;font-size:0.88rem">
      <tbody>${filas}</tbody>
    </table>
    <p style="margin:16px 0 0;font-size:0.82rem;color:#64748b">Accede al sistema para ver todos los detalles.</p>
  </div>
</div>
</body></html>`;

  try {
    await transporter.sendMail({ from, to: tecnico.email, subject: `Ticket asignado: ${ticket.numero} — ${nombre_taller}`, html });
    res.json({ ok: true, to: tecnico.email });
  } catch (e) {
    res.status(500).json({ error: 'Error al enviar: ' + e.message });
  }
});


app.post('/api/tickets/enviar-informe', async (req, res) => {
  const cfg = getCfg();
  const transporter = crearTransporter(cfg);
  if (!transporter) return res.status(400).json({ error: 'SMTP no configurado.' });
  const from = getFromAddress(cfg);
  if (!from) return res.status(400).json({ error: 'Configura el campo "De" en configuración SMTP.' });

  const { to, filtro, cliente_id, asunto } = req.body;
  if (!to) return res.status(400).json({ error: 'Destinatario requerido.' });

  let tickets, tituloFiltro;
  const baseQ = `SELECT t.*, e.nombre as eq_nombre, e.tipo as eq_tipo,
    COALESCE(ceq.nombre, cdir.nombre) as cl_nombre
    FROM tickets t
    LEFT JOIN equipos e ON e.id = t.equipo_id
    LEFT JOIN clientes ceq ON ceq.id = e.cliente_id
    LEFT JOIN clientes cdir ON cdir.id = t.cliente_id`;

  if (filtro === 'hoy') {
    tickets = db.prepare(`${baseQ} WHERE t.fecha_entrada = date('now') ORDER BY t.id DESC`).all();
    tituloFiltro = `Tickets de hoy (${new Date().toLocaleDateString('es-ES')})`;
  } else if (filtro === 'cliente' && cliente_id) {
    tickets = db.prepare(`${baseQ} WHERE (ceq.id = ? OR t.cliente_id = ?) ORDER BY t.estado, t.id DESC`).all(cliente_id, cliente_id);
    const cl = db.prepare(`SELECT nombre FROM clientes WHERE id = ?`).get(cliente_id);
    tituloFiltro = `Tickets de ${cl?.nombre || 'cliente'}`;
  } else {
    tickets = db.prepare(`${baseQ} WHERE t.estado NOT IN ('Entregado','Cerrado') ORDER BY t.fecha_entrada, t.estado`).all();
    tituloFiltro = 'Tickets activos';
  }

  const nombre_taller = cfg.nombre_taller || 'Control de Equipos';
  const COLORES_ESTADO = {
    'Pendiente':'#94a3b8','Diagnóstico':'#3b82f6','En reparación':'#f59e0b',
    'Esperando piezas':'#a855f7','Listo':'#22c55e','Entregado':'#10b981','Cerrado':'#64748b',
  };

  const filas = tickets.length ? tickets.map(t => {
    const color = COLORES_ESTADO[t.estado] || '#94a3b8';
    return `<tr>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;font-family:monospace;font-weight:700;color:#2563eb;white-space:nowrap">${escH(t.numero)}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0">${escH(t.eq_nombre || '')}${t.eq_tipo ? ` <span style="color:#64748b;font-size:0.88em">(${escH(t.eq_tipo)})</span>` : ''}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0">${escH(t.cl_nombre || '—')}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0">
        <span style="display:inline-block;padding:2px 10px;border-radius:999px;font-size:0.82em;font-weight:700;background:${color}22;color:${pillTextColor(color)};border:1px solid ${color}55">${escH(t.estado)}</span>
      </td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0">${escH(t.tecnico_asignado || '—')}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;max-width:260px">${escH(t.descripcion || '—')}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;white-space:nowrap">${t.fecha_entrada || '—'}</td>
      <td style="padding:9px 12px;border:1px solid #e2e8f0;white-space:nowrap">${t.fecha_estimada || '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="8" style="padding:20px;text-align:center;color:#64748b">No hay tickets para este filtro.</td></tr>`;

  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;margin:0;padding:24px;color:#1e293b;background:#f8fafc">
<div style="max-width:900px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#0f1b3d,#2563eb);border-radius:12px 12px 0 0;padding:24px 28px">
    <h1 style="color:#fff;margin:0;font-size:1.2rem">${escH(nombre_taller)}</h1>
    <p style="color:rgba(255,255,255,0.75);margin:6px 0 0;font-size:0.9rem">${escH(tituloFiltro)} · ${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}</p>
  </div>
  <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px;overflow:hidden">
    <table style="border-collapse:collapse;width:100%;font-size:0.88rem">
      <thead style="background:#f1f5f9">
        <tr>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Ticket</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Equipo</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Cliente</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Estado</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Técnico</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Descripción</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Entrada</th>
          <th style="padding:10px 12px;border:1px solid #e2e8f0;text-align:left;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;color:#64748b">Estimada</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  </div>
  <p style="color:#94a3b8;font-size:0.78rem;text-align:center;margin-top:16px">Generado automáticamente por ${escH(nombre_taller)}</p>
</div>
</body></html>`;

  try {
    await transporter.sendMail({
      from,
      to,
      subject: asunto || `${tituloFiltro} — ${nombre_taller}`,
      html,
    });
    res.json({ ok: true, total: tickets.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/email/test', async (req, res) => {
  const cfg = getCfg();
  const transporter = crearTransporter(cfg);
  if (!transporter) return res.status(400).json({ error: 'SMTP no configurado. Rellena host, usuario y contraseña.' });
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Destinatario requerido' });
  const from = getFromAddress(cfg);
  if (!from) return res.status(400).json({ error: 'Configura el campo "De" o el usuario SMTP con un email válido.' });
  try {
    await transporter.sendMail({ from, to, subject: 'Prueba de correo — Control de Equipos', html: '<p>Si recibes este mensaje, la configuración SMTP es correcta.</p>' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function enrichEquipo(equipo) {
  equipo.componentes  = db.prepare(`SELECT * FROM componentes  WHERE equipo_id = ? ORDER BY id`).all(equipo.id);
  equipo.archivos     = db.prepare(`SELECT * FROM archivos     WHERE equipo_id = ? ORDER BY id`).all(equipo.id);
  equipo.credenciales = db.prepare(`SELECT * FROM credenciales WHERE equipo_id = ? ORDER BY id`).all(equipo.id);
  equipo.licencias    = db.prepare(`SELECT * FROM licencias    WHERE equipo_id = ? ORDER BY id`).all(equipo.id);
  equipo.fotos = db.prepare(`SELECT * FROM fotos WHERE equipo_id = ? AND intervencion_id IS NULL ORDER BY id`).all(equipo.id);
  const fotosInterv = db.prepare(`SELECT * FROM fotos WHERE equipo_id = ? AND intervencion_id IS NOT NULL ORDER BY id`).all(equipo.id);
  equipo.historial = db.prepare(`SELECT * FROM historial WHERE equipo_id = ? ORDER BY fecha DESC, id DESC`).all(equipo.id)
    .map(h => ({ ...h, fotos: fotosInterv.filter(f => f.intervencion_id === h.id) }));
  const allTickets = db.prepare(`SELECT * FROM tickets WHERE equipo_id = ? ORDER BY creado_en DESC`).all(equipo.id);
  equipo.tickets = allTickets;
  equipo.ticket_activo = allTickets.find(t => !['Entregado', 'Cerrado'].includes(t.estado)) || null;
  return equipo;
}

function enrichEquiposBatch(equipos) {
  if (equipos.length === 0) return equipos;
  const ids = equipos.map(e => e.id);
  const ph = ids.map(() => '?').join(',');
  const componentes  = db.prepare(`SELECT * FROM componentes  WHERE equipo_id IN (${ph}) ORDER BY id`).all(...ids);
  const archivos     = db.prepare(`SELECT * FROM archivos     WHERE equipo_id IN (${ph}) ORDER BY id`).all(...ids);
  const credenciales = db.prepare(`SELECT * FROM credenciales WHERE equipo_id IN (${ph}) ORDER BY id`).all(...ids);
  const licencias    = db.prepare(`SELECT * FROM licencias    WHERE equipo_id IN (${ph}) ORDER BY id`).all(...ids);
  const todasFotos   = db.prepare(`SELECT * FROM fotos        WHERE equipo_id IN (${ph}) ORDER BY id`).all(...ids);
  const historial    = db.prepare(`SELECT * FROM historial    WHERE equipo_id IN (${ph}) ORDER BY fecha DESC, id DESC`).all(...ids);
  const tickets      = db.prepare(`SELECT * FROM tickets      WHERE equipo_id IN (${ph}) ORDER BY creado_en DESC`).all(...ids);
  return equipos.map(eq => {
    const fotosGen   = todasFotos.filter(f => f.equipo_id === eq.id && f.intervencion_id == null);
    const fotosInterv = todasFotos.filter(f => f.equipo_id === eq.id && f.intervencion_id != null);
    const eqTickets  = tickets.filter(t => t.equipo_id === eq.id);
    return {
      ...eq,
      componentes:  componentes.filter(c  => c.equipo_id  === eq.id),
      archivos:     archivos.filter(a     => a.equipo_id  === eq.id),
      credenciales: credenciales.filter(c => c.equipo_id  === eq.id),
      licencias:    licencias.filter(l    => l.equipo_id  === eq.id),
      fotos: fotosGen,
      historial: historial.filter(h => h.equipo_id === eq.id)
        .map(h => ({ ...h, fotos: fotosInterv.filter(f => f.intervencion_id === h.id) })),
      tickets: eqTickets,
      ticket_activo: eqTickets.find(t => !['Entregado', 'Cerrado'].includes(t.estado)) || null,
    };
  });
}

// ---------- Clientes ----------

app.get('/api/clientes', (req, res) => {
  const q = (req.query.q || '').trim();
  const countSub = `(SELECT COUNT(*) FROM equipos WHERE cliente_id = c.id) AS num_equipos`;
  const ticketsSub = `(SELECT COUNT(*) FROM tickets t JOIN equipos e ON t.equipo_id = e.id WHERE e.cliente_id = c.id) AS num_tickets`;
  const ticketsActivosSub = `(SELECT COUNT(*) FROM tickets t JOIN equipos e ON t.equipo_id = e.id WHERE e.cliente_id = c.id AND t.estado NOT IN ('Entregado','Cerrado')) AS num_tickets_activos`;
  const licenciasSub = `(SELECT COUNT(*) FROM licencias_clientes WHERE cliente_id = c.id) AS num_licencias`;
  const cols = `c.*, ${countSub}, ${ticketsSub}, ${ticketsActivosSub}, ${licenciasSub}`;
  if (q) {
    const like = `%${q}%`;
    return res.json(db.prepare(
      `SELECT ${cols} FROM clientes c
       WHERE c.nombre LIKE ? OR c.telefono LIKE ? OR c.email LIKE ? OR c.numero_cliente LIKE ?
          OR c.cp LIKE ? OR c.ciudad LIKE ? OR c.provincia LIKE ?
       ORDER BY c.nombre COLLATE NOCASE`
    ).all(like, like, like, like, like, like, like));
  }
  res.json(db.prepare(`SELECT ${cols} FROM clientes c ORDER BY c.nombre COLLATE NOCASE`).all());
});

app.get('/api/clientes/:id', (req, res) => {
  const cliente = db.prepare(`SELECT *, (SELECT COUNT(*) FROM licencias_clientes WHERE cliente_id = clientes.id) AS num_licencias FROM clientes WHERE id = ?`).get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(cliente);
});

app.post('/api/clientes', (req, res) => {
  const { nombre, telefono, email, direccion, cp, ciudad, provincia, numero_cliente, notas } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const info = db.prepare(
    `INSERT INTO clientes (nombre, telefono, email, direccion, cp, ciudad, provincia, numero_cliente, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(nombre.trim(), telefono || null, email || null, direccion || null, cp || null, ciudad || null, provincia || null, numero_cliente || null, notas || null);
  res.status(201).json(db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/clientes/:id', (req, res) => {
  const { nombre, telefono, email, direccion, cp, ciudad, provincia, numero_cliente, notas } = req.body;
  if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
  const info = db.prepare(
    `UPDATE clientes SET nombre = ?, telefono = ?, email = ?, direccion = ?, cp = ?, ciudad = ?, provincia = ?, numero_cliente = ?, notas = ? WHERE id = ?`
  ).run(nombre.trim(), telefono || null, email || null, direccion || null, cp || null, ciudad || null, provincia || null, numero_cliente || null, notas || null, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.json(db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(req.params.id));
});

app.delete('/api/clientes/:id', (req, res) => {
  const fotos = db.prepare(`SELECT f.archivo FROM fotos f JOIN equipos e ON e.id = f.equipo_id WHERE e.cliente_id = ?`).all(req.params.id);
  const archivos = db.prepare(`SELECT a.archivo FROM archivos a JOIN equipos e ON e.id = a.equipo_id WHERE e.cliente_id = ?`).all(req.params.id);
  const info = db.prepare(`DELETE FROM clientes WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado' });
  fotos.forEach(f => borrarFotoDeDisco(f.archivo));
  archivos.forEach(a => borrarArchivoDeDisco(a.archivo));
  res.status(204).end();
});

// ---------- Equipos ----------

const TIPOS_CON_BATERIA = new Set(['Tablet', 'Portátil']);

function garantiaDeBody(value) {
  if (value === undefined || value === null || value === '') return 0;
  const meses = Number(value);
  if (!Number.isInteger(meses) || meses < 0) throw new Error('Los meses de garantía deben ser un entero no negativo');
  return meses;
}

function bateriaDeBody(tipo, b) {
  if (!TIPOS_CON_BATERIA.has(tipo)) return { bateria_tipo: null, bateria_cap_origen: null, bateria_cap_actual: null, bateria_vida_pct: null, bateria_descarga_mw: null, bateria_ciclos: null };
  return {
    bateria_tipo:        optionalText(b.bateria_tipo),
    bateria_cap_origen:  optionalNumber(b.bateria_cap_origen, 'La capacidad original de batería', { min: 0 }),
    bateria_cap_actual:  optionalNumber(b.bateria_cap_actual, 'La capacidad actual de batería', { min: 0 }),
    bateria_vida_pct:    optionalNumber(b.bateria_vida_pct, 'La vida de batería', { min: 0, max: 100 }),
    bateria_descarga_mw: optionalNumber(b.bateria_descarga_mw, 'La descarga de batería', { min: 0 }),
    bateria_ciclos:      optionalNumber(b.bateria_ciclos, 'Los ciclos de batería', { min: 0 }),
  };
}

app.get('/api/clientes/:id/equipos', (req, res) => {
  res.json(enrichEquiposBatch(db.prepare(`SELECT * FROM equipos WHERE cliente_id = ? ORDER BY creado_en DESC`).all(req.params.id)));
});

app.get('/api/equipos/sin-asignar/count', (req, res) => {
  const row = db.prepare(`SELECT COUNT(*) as n FROM equipos WHERE cliente_id IS NULL`).get();
  res.json({ count: row.n });
});

app.get('/api/equipos/sin-asignar', (req, res) => {
  res.json(enrichEquiposBatch(db.prepare(`SELECT * FROM equipos WHERE cliente_id IS NULL ORDER BY creado_en DESC`).all()));
});

// Mantiene sincronizado el stock de inventario con las tablets que hay en Oficina Megas
// (equipos tipo Tablet sin cliente asignado): busca un artículo activo con ese mismo
// nombre y ajusta su stock; si no existe y delta es positivo, lo crea en la categoría Tablets.
function ajustarStockTabletOficina(nombre, delta) {
  const nombreTrim = String(nombre || '').trim();
  if (!nombreTrim || !delta) return;
  const existente = db.prepare(`SELECT * FROM inventario_articulos WHERE activo = 1 AND nombre = ? COLLATE NOCASE`).get(nombreTrim);
  if (existente) {
    const nuevo = Math.max(0, existente.stock + delta);
    const aplicado = nuevo - existente.stock;
    if (aplicado === 0) return;
    db.prepare(`UPDATE inventario_articulos SET stock = ? WHERE id = ?`).run(nuevo, existente.id);
    db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario) VALUES (?, ?, ?, ?, ?, 'Sincronización Oficina Megas', 'Sistema')`)
      .run(existente.id, aplicado > 0 ? 'entrada' : 'ajuste', aplicado, existente.stock, nuevo);
  } else if (delta > 0) {
    const info = db.prepare(`INSERT INTO inventario_articulos (codigo, ean, nombre, categoria, unidad, stock, stock_minimo, ubicacion, notas) VALUES (NULL, NULL, ?, 'Tablets', 'ud.', ?, 0, NULL, NULL)`)
      .run(nombreTrim, delta);
    db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario) VALUES (?, 'entrada', ?, 0, ?, 'Sincronización Oficina Megas', 'Sistema')`)
      .run(info.lastInsertRowid, delta, delta);
  }
}

app.post('/api/equipos/sin-asignar', (req, res) => {
  const { tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, tiene_cargador, tiene_teclado, notas } = req.body;
  if (!tipo || !nombre || !nombre.trim()) return res.status(400).json({ error: 'Tipo y nombre son obligatorios' });
  const bat = bateriaDeBody(tipo, req.body);
  const info = db.prepare(
    `INSERT INTO equipos (cliente_id, tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, tiene_cargador, tiene_teclado, notas, bateria_tipo, bateria_cap_origen, bateria_cap_actual, bateria_vida_pct, bateria_descarga_mw, bateria_ciclos) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(tipo, nombre.trim(), numero_serie || null, fecha_entrega || null,
    garantiaDeBody(meses_garantia), mantenimiento ? 1 : 0,
    tipo === 'Tablet' ? (tiene_cargador ? 1 : 0) : null,
    tipo === 'Tablet' ? (tiene_teclado ? 1 : 0) : null, notas || null,
    bat.bateria_tipo, bat.bateria_cap_origen, bat.bateria_cap_actual, bat.bateria_vida_pct, bat.bateria_descarga_mw, bat.bateria_ciclos);
  if (tipo === 'Tablet') ajustarStockTabletOficina(nombre.trim(), 1);
  res.status(201).json(enrichEquipo(db.prepare(`SELECT * FROM equipos WHERE id = ?`).get(info.lastInsertRowid)));
});

app.put('/api/equipos/:id/asignar-cliente', (req, res) => {
  const { cliente_id } = req.body;
  if (cliente_id != null) {
    const cliente = db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(cliente_id);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  }
  const antes = db.prepare(`SELECT tipo, nombre, cliente_id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!antes) return res.status(404).json({ error: 'Equipo no encontrado' });
  const nuevoClienteId = cliente_id || null;
  const info = db.prepare(`UPDATE equipos SET cliente_id = ? WHERE id = ?`).run(nuevoClienteId, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (antes.tipo === 'Tablet') {
    if (antes.cliente_id == null && nuevoClienteId != null) ajustarStockTabletOficina(antes.nombre, -1);
    else if (antes.cliente_id != null && nuevoClienteId == null) ajustarStockTabletOficina(antes.nombre, 1);
  }
  res.json(enrichEquipo(db.prepare(`SELECT * FROM equipos WHERE id = ?`).get(req.params.id)));
});

app.get('/api/equipos/:id', (req, res) => {
  const equipo = db.prepare(`SELECT * FROM equipos WHERE id = ?`).get(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  res.json(enrichEquipo(equipo));
});

app.post('/api/clientes/:id/equipos', (req, res) => {
  const cliente = db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(req.params.id);
  if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, tiene_cargador, tiene_teclado, notas } = req.body;
  if (!tipo || !nombre || !nombre.trim()) return res.status(400).json({ error: 'Tipo y nombre son obligatorios' });
  const bat = bateriaDeBody(tipo, req.body);
  const info = db.prepare(
    `INSERT INTO equipos (cliente_id, tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, tiene_cargador, tiene_teclado, notas, bateria_tipo, bateria_cap_origen, bateria_cap_actual, bateria_vida_pct, bateria_descarga_mw, bateria_ciclos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.params.id, tipo, nombre.trim(), numero_serie || null, fecha_entrega || null,
    garantiaDeBody(meses_garantia), mantenimiento ? 1 : 0,
    tipo === 'Tablet' ? (tiene_cargador ? 1 : 0) : null,
    tipo === 'Tablet' ? (tiene_teclado ? 1 : 0) : null, notas || null,
    bat.bateria_tipo, bat.bateria_cap_origen, bat.bateria_cap_actual, bat.bateria_vida_pct, bat.bateria_descarga_mw, bat.bateria_ciclos);
  res.status(201).json(enrichEquipo(db.prepare(`SELECT * FROM equipos WHERE id = ?`).get(info.lastInsertRowid)));
});

app.put('/api/equipos/:id', (req, res) => {
  const { tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, tiene_cargador, tiene_teclado, notas } = req.body;
  if (!tipo || !nombre || !nombre.trim()) return res.status(400).json({ error: 'Tipo y nombre son obligatorios' });
  const antes = db.prepare(`SELECT tipo, nombre, cliente_id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!antes) return res.status(404).json({ error: 'Equipo no encontrado' });
  const bat = bateriaDeBody(tipo, req.body);
  const nombreNuevo = nombre.trim();
  const info = db.prepare(
    `UPDATE equipos SET tipo=?,nombre=?,numero_serie=?,fecha_entrega=?,meses_garantia=?,mantenimiento=?,tiene_cargador=?,tiene_teclado=?,notas=?,bateria_tipo=?,bateria_cap_origen=?,bateria_cap_actual=?,bateria_vida_pct=?,bateria_descarga_mw=?,bateria_ciclos=? WHERE id=?`
  ).run(tipo, nombreNuevo, numero_serie || null, fecha_entrega || null,
    garantiaDeBody(meses_garantia), mantenimiento ? 1 : 0,
    tipo === 'Tablet' ? (tiene_cargador ? 1 : 0) : null,
    tipo === 'Tablet' ? (tiene_teclado ? 1 : 0) : null, notas || null,
    bat.bateria_tipo, bat.bateria_cap_origen, bat.bateria_cap_actual, bat.bateria_vida_pct, bat.bateria_descarga_mw, bat.bateria_ciclos,
    req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (antes.cliente_id == null) {
    const eraTablet = antes.tipo === 'Tablet';
    const esTablet = tipo === 'Tablet';
    if (eraTablet && (!esTablet || antes.nombre !== nombreNuevo)) ajustarStockTabletOficina(antes.nombre, -1);
    if (esTablet && (!eraTablet || antes.nombre !== nombreNuevo)) ajustarStockTabletOficina(nombreNuevo, 1);
  }
  res.json(enrichEquipo(db.prepare(`SELECT * FROM equipos WHERE id = ?`).get(req.params.id)));
});

app.delete('/api/equipos/:id', (req, res) => {
  const antes = db.prepare(`SELECT tipo, nombre, cliente_id FROM equipos WHERE id = ?`).get(req.params.id);
  const fotos = db.prepare(`SELECT archivo FROM fotos WHERE equipo_id = ?`).all(req.params.id);
  const archivos = db.prepare(`SELECT archivo FROM archivos WHERE equipo_id = ?`).all(req.params.id);
  const info = db.prepare(`DELETE FROM equipos WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
  if (antes && antes.cliente_id == null && antes.tipo === 'Tablet') ajustarStockTabletOficina(antes.nombre, -1);
  fotos.forEach(f => borrarFotoDeDisco(f.archivo));
  archivos.forEach(a => borrarArchivoDeDisco(a.archivo));
  res.status(204).end();
});

// ---------- Componentes ----------

app.post('/api/equipos/:id/componentes', (req, res) => {
  const equipo = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  const { tipo, descripcion, numero_serie } = req.body;
  if (!tipo || !tipo.trim()) return res.status(400).json({ error: 'El tipo de componente es obligatorio' });
  const info = db.prepare(`INSERT INTO componentes (equipo_id, tipo, descripcion, numero_serie) VALUES (?, ?, ?, ?)`)
    .run(req.params.id, tipo.trim(), descripcion || null, numero_serie || null);
  res.status(201).json(db.prepare(`SELECT * FROM componentes WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/componentes/:id', (req, res) => {
  const { tipo, descripcion, numero_serie } = req.body;
  if (!tipo || !tipo.trim()) return res.status(400).json({ error: 'El tipo de componente es obligatorio' });
  const info = db.prepare(`UPDATE componentes SET tipo = ?, descripcion = ?, numero_serie = ? WHERE id = ?`)
    .run(tipo.trim(), descripcion || null, numero_serie || null, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Componente no encontrado' });
  res.json(db.prepare(`SELECT * FROM componentes WHERE id = ?`).get(req.params.id));
});

app.delete('/api/componentes/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM componentes WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Componente no encontrado' });
  res.status(204).end();
});

// ---------- Fotos (equipo general) ----------

app.post('/api/equipos/:id/fotos', async (req, res) => {
  const equipo = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  try {
    await runMulterFotos(req, res);
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No se ha recibido ninguna imagen' });
    const insert = db.prepare(`INSERT INTO fotos (equipo_id, archivo) VALUES (?, ?)`);
    for (const f of req.files) {
      const nombre = await guardarFotoComprimida(f.buffer);
      insert.run(req.params.id, nombre);
    }
    res.status(201).json(db.prepare(`SELECT * FROM fotos WHERE equipo_id = ? AND intervencion_id IS NULL ORDER BY id`).all(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- Fotos (intervención) ----------

app.post('/api/historial/:id/fotos', async (req, res) => {
  const intervencion = db.prepare(`SELECT * FROM historial WHERE id = ?`).get(req.params.id);
  if (!intervencion) return res.status(404).json({ error: 'Intervención no encontrada' });
  try {
    await runMulterFotos(req, res);
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No se ha recibido ninguna imagen' });
    const insert = db.prepare(`INSERT INTO fotos (equipo_id, intervencion_id, archivo) VALUES (?, ?, ?)`);
    for (const f of req.files) {
      const nombre = await guardarFotoComprimida(f.buffer);
      insert.run(intervencion.equipo_id, intervencion.id, nombre);
    }
    res.status(201).json(db.prepare(`SELECT * FROM fotos WHERE intervencion_id = ? ORDER BY id`).all(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/fotos/:id', (req, res) => {
  const foto = db.prepare(`SELECT * FROM fotos WHERE id = ?`).get(req.params.id);
  if (!foto) return res.status(404).json({ error: 'Foto no encontrada' });
  db.prepare(`DELETE FROM fotos WHERE id = ?`).run(req.params.id);
  borrarFotoDeDisco(foto.archivo);
  res.status(204).end();
});

// ---------- Archivos adjuntos ----------

app.post('/api/equipos/:id/archivos', (req, res) => {
  const equipo = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  uploadArchivo.single('archivo')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo' });
    const { categoria, descripcion } = req.body;
    const info = db.prepare(
      `INSERT INTO archivos (equipo_id, archivo, nombre_original, mimetype, tamano, categoria, descripcion) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(req.params.id, req.file.filename, req.file.originalname, req.file.mimetype, req.file.size, categoria || 'Otro', descripcion || null);
    res.status(201).json(db.prepare(`SELECT * FROM archivos WHERE id = ?`).get(info.lastInsertRowid));
  });
});

app.get('/api/archivos/:id/descargar', (req, res) => {
  const archivo = db.prepare(`SELECT * FROM archivos WHERE id = ?`).get(req.params.id);
  if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.download(path.join(archivosDir, archivo.archivo), archivo.nombre_original, err => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Error al descargar el archivo' });
  });
});

const MIMETYPES_PREVISUALIZABLES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp',
  'application/pdf', 'text/plain', 'text/csv',
]);

app.get('/api/archivos/:id/ver', (req, res) => {
  const archivo = db.prepare(`SELECT * FROM archivos WHERE id = ?`).get(req.params.id);
  if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
  if (!MIMETYPES_PREVISUALIZABLES.has(archivo.mimetype)) return res.status(415).json({ error: 'Este tipo de archivo no se puede previsualizar' });
  res.setHeader('Content-Type', archivo.mimetype);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(archivo.nombre_original)}"`);
  res.sendFile(path.join(archivosDir, archivo.archivo), err => {
    if (err && !res.headersSent) res.status(500).json({ error: 'Error al mostrar el archivo' });
  });
});

app.delete('/api/archivos/:id', (req, res) => {
  const archivo = db.prepare(`SELECT * FROM archivos WHERE id = ?`).get(req.params.id);
  if (!archivo) return res.status(404).json({ error: 'Archivo no encontrado' });
  db.prepare(`DELETE FROM archivos WHERE id = ?`).run(req.params.id);
  borrarArchivoDeDisco(archivo.archivo);
  res.status(204).end();
});

// ---------- Historial ----------

app.post('/api/equipos/:id/historial', (req, res) => {
  const equipo = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
  if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
  const { fecha, tipo, problema_reportado, descripcion, tecnico, coste, proxima_revision } = req.body;
  if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
  if (!tipo || !tipo.trim()) return res.status(400).json({ error: 'El tipo es obligatorio' });
  if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'El trabajo realizado es obligatorio' });
  const info = db.prepare(
    `INSERT INTO historial (equipo_id, fecha, tipo, problema_reportado, descripcion, tecnico, coste, proxima_revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(req.params.id, fecha, tipo.trim(), problema_reportado || null, descripcion.trim(), tecnico || null, coste ?? null, proxima_revision || null);
  const h = db.prepare(`SELECT * FROM historial WHERE id = ?`).get(info.lastInsertRowid);
  res.status(201).json({ ...h, fotos: [] });
});

app.put('/api/historial/:id', (req, res) => {
  const { fecha, tipo, problema_reportado, descripcion, tecnico, coste, proxima_revision } = req.body;
  if (!fecha) return res.status(400).json({ error: 'La fecha es obligatoria' });
  if (!tipo || !tipo.trim()) return res.status(400).json({ error: 'El tipo es obligatorio' });
  if (!descripcion || !descripcion.trim()) return res.status(400).json({ error: 'El trabajo realizado es obligatorio' });
  const info = db.prepare(
    `UPDATE historial SET fecha = ?, tipo = ?, problema_reportado = ?, descripcion = ?, tecnico = ?, coste = ?, proxima_revision = ? WHERE id = ?`
  ).run(fecha, tipo.trim(), problema_reportado || null, descripcion.trim(), tecnico || null, coste ?? null, proxima_revision || null, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Entrada no encontrada' });
  const h = db.prepare(`SELECT * FROM historial WHERE id = ?`).get(req.params.id);
  h.fotos = db.prepare(`SELECT * FROM fotos WHERE intervencion_id = ? ORDER BY id`).all(req.params.id);
  res.json(h);
});

app.delete('/api/historial/:id', (req, res) => {
  // Fotos de intervención pasan a fotos generales del equipo al borrar la intervención
  db.prepare(`UPDATE fotos SET intervencion_id = NULL WHERE intervencion_id = ?`).run(req.params.id);
  const info = db.prepare(`DELETE FROM historial WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Entrada no encontrada' });
  res.status(204).end();
});

app.patch('/api/historial/:id/revision', (req, res) => {
  const info = db.prepare(`UPDATE historial SET proxima_revision = NULL WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'No encontrado' });
  res.json({ ok: true });
});

// ---------- Plantillas de intervención ----------

app.get('/api/plantillas', (req, res) => {
  res.json(db.prepare(`SELECT * FROM plantillas ORDER BY nombre COLLATE NOCASE`).all());
});

app.post('/api/plantillas', (req, res) => {
  const { nombre, tipo, contenido } = req.body;
  if (!nombre?.trim() || !contenido?.trim()) return res.status(400).json({ error: 'Nombre y contenido son obligatorios' });
  const info = db.prepare(`INSERT INTO plantillas (nombre, tipo, contenido) VALUES (?, ?, ?)`).run(nombre.trim(), tipo || null, contenido.trim());
  res.status(201).json(db.prepare(`SELECT * FROM plantillas WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/plantillas/:id', (req, res) => {
  const { nombre, tipo, contenido } = req.body;
  if (!nombre?.trim() || !contenido?.trim()) return res.status(400).json({ error: 'Nombre y contenido son obligatorios' });
  const info = db.prepare(`UPDATE plantillas SET nombre = ?, tipo = ?, contenido = ? WHERE id = ?`).run(nombre.trim(), tipo || null, contenido.trim(), req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Plantilla no encontrada' });
  res.json(db.prepare(`SELECT * FROM plantillas WHERE id = ?`).get(req.params.id));
});

app.delete('/api/plantillas/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM plantillas WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Plantilla no encontrada' });
  res.status(204).end();
});

// ---------- Dashboard de inicio ----------

app.get('/api/dashboard', (req, res) => {
  const totalClientes = db.prepare(`SELECT COUNT(*) AS n FROM clientes`).get().n;
  const clientesNuevosMes = db.prepare(`SELECT COUNT(*) AS n FROM clientes WHERE strftime('%Y-%m', creado_en) = strftime('%Y-%m', 'now')`).get().n;
  const equiposOficina = db.prepare(`SELECT COUNT(*) AS n FROM equipos WHERE cliente_id IS NULL`).get().n;
  const ticketsAbiertos = db.prepare(`SELECT COUNT(*) AS n FROM tickets WHERE estado NOT IN ('Entregado', 'Cerrado')`).get().n;
  const ticketsCerradosHoy = db.prepare(`SELECT COUNT(DISTINCT ticket_id) AS n FROM ticket_log WHERE campo = 'estado' AND valor_nuevo IN ('Entregado', 'Cerrado') AND date(creado_en) = date('now')`).get().n;
  const bajoMinimo = db.prepare(`SELECT COUNT(*) AS n FROM inventario_articulos WHERE activo = 1 AND stock <= stock_minimo`).get().n;

  const movFilas = db.prepare(`
    SELECT date(creado_en) AS dia,
      SUM(CASE WHEN tipo IN ('entrada', 'ajuste') AND cantidad > 0 THEN cantidad ELSE 0 END) AS entradas,
      SUM(CASE WHEN tipo = 'salida' THEN -cantidad ELSE 0 END) AS salidas
    FROM inventario_movimientos
    WHERE date(creado_en) >= date('now', '-6 days')
    GROUP BY date(creado_en)
  `).all();
  const porDia = {};
  movFilas.forEach(f => { porDia[f.dia] = f; });
  const diasSemana = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const movimientos7dias = [];
  for (let i = 6; i >= 0; i--) {
    const fecha = new Date();
    fecha.setDate(fecha.getDate() - i);
    const clave = fecha.toISOString().slice(0, 10);
    const fila = porDia[clave];
    movimientos7dias.push({ dia: diasSemana[fecha.getDay()], entradas: fila ? fila.entradas : 0, salidas: fila ? fila.salidas : 0 });
  }

  const actividad = db.prepare(`
    SELECT * FROM (
      SELECT 'ticket_cerrado' AS tipo, 'Ticket cerrado' AS texto,
        COALESCE((SELECT nombre FROM clientes WHERE id = t.cliente_id), 'Oficina Megas') AS meta,
        tl.creado_en AS fecha
      FROM ticket_log tl JOIN tickets t ON t.id = tl.ticket_id
      WHERE tl.campo = 'estado' AND tl.valor_nuevo IN ('Cerrado', 'Entregado')
      UNION ALL
      SELECT 'cliente_nuevo' AS tipo, 'Cliente nuevo' AS texto, nombre AS meta, creado_en AS fecha FROM clientes
      UNION ALL
      SELECT 'salida_stock' AS tipo, 'Salida de stock' AS texto,
        COALESCE((SELECT nombre FROM clientes WHERE id = s.cliente_id), 'Oficina Megas') AS meta,
        s.creado_en AS fecha
      FROM inventario_salidas s
    )
    ORDER BY fecha DESC LIMIT 6
  `).all();

  const garantias = db.prepare(`
    SELECT * FROM (
      SELECT e.nombre AS equipo, COALESCE(c.nombre, 'Oficina Megas') AS cliente,
        CAST(julianday(date(e.fecha_entrega, '+' || e.meses_garantia || ' months')) - julianday('now') AS INTEGER) AS dias
      FROM equipos e LEFT JOIN clientes c ON c.id = e.cliente_id
      WHERE e.fecha_entrega IS NOT NULL AND e.meses_garantia > 0
    )
    WHERE dias BETWEEN 0 AND 30
    ORDER BY dias ASC LIMIT 5
  `).all();

  res.json({
    clientes: { total: totalClientes, nuevos_mes: clientesNuevosMes },
    equipos_oficina: equiposOficina,
    tickets: { abiertos: ticketsAbiertos, cerrados_hoy: ticketsCerradosHoy },
    bajo_minimo: bajoMinimo,
    movimientos_7dias: movimientos7dias,
    actividad,
    garantias,
  });
});

// ---------- Ping / versión ----------

app.get('/api/ping', (req, res) => res.json({ ok: true, version: 2 }));

app.get('/api/impresoras', (req, res) => {
  try {
    const out = execSync(
      'powershell -command "Get-Printer | Select-Object -ExpandProperty Name"',
      { timeout: 5000, encoding: 'utf8', windowsHide: true }
    );
    const nombres = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    res.json(nombres);
  } catch {
    res.json([]);
  }
});

app.post('/api/imprimir-envio', (req, res) => {
  try {
    const { html, impresora } = req.body;
    if (!html) return res.status(400).json({ error: 'Sin HTML' });
    if (!esSolicitudLocal(req)) {
      return res.status(409).json({ error: 'Este PC no es el servidor: se imprime desde el navegador.' });
    }
    const tmpFile = path.join(os.tmpdir(), `ce_print_${Date.now()}.html`);
    fs.writeFileSync(tmpFile, html, 'utf8');
    const imp = (impresora || '').trim();
    const fileUrl = 'file:///' + tmpFile.replace(/\\/g, '/');

    // Intento 1: verbo Windows Print/PrintTo (requiere asociación .html)
    let printed = false;
    try {
      const psCmd = imp
        ? `powershell -command "Start-Process -FilePath '${tmpFile}' -Verb PrintTo -ArgumentList '\\"${imp}\\"' -Wait -WindowStyle Hidden"`
        : `powershell -command "Start-Process -FilePath '${tmpFile}' -Verb Print -Wait -WindowStyle Hidden"`;
      execSync(psCmd, { timeout: 15000, windowsHide: true });
      printed = true;
    } catch {}

    // Intento 2: abrir en Edge/Chrome (sin asociación de archivo)
    if (!printed) {
      const pf  = process.env.ProgramFiles        || 'C:\\Program Files';
      const pf86= process.env['ProgramFiles(x86)']|| 'C:\\Program Files (x86)';
      const candidatos = [
        path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(pf,   'Microsoft\\Edge\\Application\\msedge.exe'),
        path.join(pf,   'Google\\Chrome\\Application\\chrome.exe'),
        path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'),
      ];
      const browser = candidatos.find(b => fs.existsSync(b));
      if (!browser) throw new Error('Sin asociación .html ni navegador instalado. Configure un navegador predeterminado.');
      // spawn desacoplado: el navegador queda abierto (para que el usuario pulse imprimir),
      // así que no podemos esperar a que el proceso termine como con execSync.
      const proc = spawn(browser, ['--new-window', fileUrl], { detached: true, stdio: 'ignore' });
      proc.unref();
      printed = true;
    }

    // Con el navegador de reserva el usuario tarda más en pulsar imprimir
    // (diálogo manual) que con el flujo nativo, así que damos más margen
    // antes de borrar el temporal.
    setTimeout(() => { try { fs.unlinkSync(tmpFile); } catch {} }, 5 * 60000);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/sw-icons', (req, res) => {
  const dir = path.join(__dirname, 'public', 'sw-icons');
  try {
    const files = fs.readdirSync(dir).filter(f => /\.(svg|png|jpg|webp)$/i.test(f));
    res.json(files);
  } catch { res.json([]); }
});

// ---------- Accesos ----------

app.put('/api/equipos/:id/accesos', (req, res) => {
  try {
    const { anydesk_id, anydesk_pass, megas_id, megas_pass, software_instalado } = req.body;
    const info = db.prepare(
      `UPDATE equipos SET anydesk_id = ?, anydesk_pass = ?, megas_id = ?, megas_pass = ?, software_instalado = ? WHERE id = ?`
    ).run(anydesk_id || null, anydesk_pass || null, megas_id || null, megas_pass || null, software_instalado || null, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Equipo no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('PUT /accesos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/equipos/:id/credenciales-bulk', (req, res) => {
  try {
    const equipo = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
    if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
    const { credenciales } = req.body;
    db.prepare(`DELETE FROM credenciales WHERE equipo_id = ?`).run(req.params.id);
    const insert = db.prepare(`INSERT INTO credenciales (equipo_id, tipo, usuario, password, nota) VALUES (?, ?, ?, ?, ?)`);
    (credenciales || []).forEach(c => insert.run(req.params.id, c.tipo || 'Usuario', c.usuario || null, c.password || null, c.nota || null));
    res.json(db.prepare(`SELECT * FROM credenciales WHERE equipo_id = ? ORDER BY id`).all(req.params.id));
  } catch (err) {
    console.error('PUT /credenciales-bulk:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/equipos/:id/licencias-bulk', (req, res) => {
  try {
    const equipo = db.prepare(`SELECT id FROM equipos WHERE id = ?`).get(req.params.id);
    if (!equipo) return res.status(404).json({ error: 'Equipo no encontrado' });
    const { licencias } = req.body;
    db.prepare(`DELETE FROM licencias WHERE equipo_id = ?`).run(req.params.id);
    const insert = db.prepare(`INSERT INTO licencias (equipo_id, nombre, clave, nota) VALUES (?, ?, ?, ?)`);
    (licencias || []).forEach(l => {
      if (l.nombre) insert.run(req.params.id, l.nombre, l.clave || null, l.nota || null);
    });
    res.json(db.prepare(`SELECT * FROM licencias WHERE equipo_id = ? ORDER BY id`).all(req.params.id));
  } catch (err) {
    console.error('PUT /licencias-bulk:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------- Busqueda global ----------

app.get('/api/buscar', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2) return res.json({ clientes: [], equipos: [], historial: [], componentes: [] });
  const like = `%${q}%`;

  const clientes = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM equipos WHERE cliente_id = c.id) as num_equipos
    FROM clientes c
    WHERE c.nombre LIKE ? OR c.telefono LIKE ? OR c.email LIKE ? OR c.numero_cliente LIKE ? OR c.ciudad LIKE ?
    ORDER BY c.nombre COLLATE NOCASE LIMIT 8
  `).all(like, like, like, like, like);

  const equipos = db.prepare(`
    SELECT e.*, c.nombre as cliente_nombre FROM equipos e
    LEFT JOIN clientes c ON c.id = e.cliente_id
    WHERE e.nombre LIKE ? OR e.numero_serie LIKE ? OR e.notas LIKE ?
    ORDER BY e.nombre COLLATE NOCASE LIMIT 8
  `).all(like, like, like);

  const historial = db.prepare(`
    SELECT h.id, h.equipo_id, h.tipo, h.fecha, h.descripcion, h.problema_reportado, h.tecnico,
           e.nombre as equipo_nombre, e.cliente_id, c.nombre as cliente_nombre
    FROM historial h
    JOIN equipos e ON e.id = h.equipo_id
    LEFT JOIN clientes c ON c.id = e.cliente_id
    WHERE h.descripcion LIKE ? OR h.problema_reportado LIKE ? OR h.tecnico LIKE ?
    ORDER BY h.fecha DESC LIMIT 6
  `).all(like, like, like);

  const componentes = db.prepare(`
    SELECT comp.*, e.nombre as equipo_nombre, e.cliente_id, c.nombre as cliente_nombre
    FROM componentes comp
    JOIN equipos e ON e.id = comp.equipo_id
    LEFT JOIN clientes c ON c.id = e.cliente_id
    WHERE comp.numero_serie LIKE ? OR comp.tipo LIKE ? OR comp.descripcion LIKE ?
    ORDER BY comp.tipo COLLATE NOCASE LIMIT 6
  `).all(like, like, like);

  res.json({ clientes, equipos, historial, componentes });
});

// ---------- Generador de número de serie ----------

const SERIE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randChars(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += SERIE_CHARS[Math.floor(Math.random() * SERIE_CHARS.length)];
  return s;
}

app.get('/api/generar-serie', (req, res) => {
  const tipo = String(req.query.tipo || 'EQ').replace(/[^A-Za-z0-9]/g, '').toUpperCase().substring(0, 2).padEnd(2, 'X');
  const now = new Date();
  const yymm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, '0');
  let serie;
  for (let i = 0; i < 20; i++) {
    serie = `CE-${tipo}-${yymm}-${randChars(4)}`;
    const existe = db.prepare(`SELECT 1 FROM equipos WHERE numero_serie = ? UNION ALL SELECT 1 FROM componentes WHERE numero_serie = ?`).get(serie, serie);
    if (!existe) break;
  }
  res.json({ serie });
});

// ---------- Etiqueta térmica 80mm ----------

app.get('/api/etiquetas', async (req, res) => {
  try {
    const ids = String(req.query.ids || '').split(',').map(Number).filter(id => Number.isInteger(id) && id > 0);
    const unicos = [...new Set(ids)];
    if (!unicos.length) return res.status(400).send('No se han seleccionado equipos');
    let copias = Number.parseInt(req.query.copias, 10) || 1;
    let columnas = Number.parseInt(req.query.columnas, 10) || 1;
    copias = Math.max(1, Math.min(60, copias));
    columnas = Math.max(1, Math.min(3, columnas));
    if (unicos.length === 1 && copias < columnas) copias = columnas;
    if (unicos.length > 1) copias = 1;
    if (unicos.length * copias > 60) return res.status(400).send('Puedes imprimir como máximo 60 etiquetas cada vez');
    const equipos = db.prepare(`SELECT e.*, c.nombre AS cliente_nombre FROM equipos e LEFT JOIN clientes c ON c.id=e.cliente_id WHERE e.id IN (${unicos.map(() => '?').join(',')})`).all(...unicos);
    const porId = new Map(equipos.map(e => [e.id, e]));
    if (!equipos.length) return res.status(404).send('No se han encontrado equipos');

    const incluir = key => req.query[key] !== undefined;
    const host = req.headers.host || `localhost:${PORT}`;
    const idsParaImprimir = unicos.length === 1 ? Array.from({ length: copias }, () => unicos[0]) : unicos;
    const etiquetas = await Promise.all(idsParaImprimir.filter(id => porId.has(id)).map(async id => {
      const eq = porId.get(id);
      const serie = incluir('serie') ? escH(eq.numero_serie || '(sin serie)') : '';
      const nombre = incluir('nombre') ? escH(eq.nombre) : '';
      const tipo = incluir('tipo') ? escH(eq.tipo) : '';
      const cliente = incluir('cliente') ? escH(eq.cliente_nombre || '') : '';
      let qrSvg = '';
      if (incluir('qr')) qrSvg = await QRCode.toString(`http://${host}/equipo/${eq.id}`, { type: 'svg', margin: 0, width: 110, color: { dark: '#000', light: '#fff' } });
      return `<article class="etiqueta">
        <div class="etiqueta-info">
          ${serie ? `<div class="serie">${serie}</div>` : ''}
          ${(nombre || tipo) ? `<div class="nombre">${nombre}${tipo ? ` <span class="tipo">${nombre ? '(' + tipo + ')' : tipo}</span>` : ''}</div>` : ''}
          ${cliente ? `<div class="cliente">${cliente}</div>` : ''}
        </div>
        ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
      </article>`;
    }));

    const etiquetaAncho = columnas === 1 ? '76mm' : columnas === 2 ? '37mm' : '24mm';
    const qrTam = columnas === 1 ? '20mm' : columnas === 2 ? '16mm' : '15mm';
    const altoEtiqueta = columnas === 1 ? '24mm' : '19mm';

    // Cada fila de `columnas` etiquetas es su propia "página" (altura automática):
    // así, una impresora de etiquetas con cuchilla automática corta sola al
    // terminar cada fila, en vez de sacar todas las etiquetas en una sola tira.
    const filas = [];
    for (let i = 0; i < etiquetas.length; i += columnas) filas.push(etiquetas.slice(i, i + columnas));
    const filasHtml = filas.map((fila, i) => `<div class="fila"${i === filas.length - 1 ? ' data-ultima' : ''}>${fila.join('')}</div>`).join('');

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas QR</title><style>
      *{box-sizing:border-box} @page{size:80mm auto;margin:1.5mm 2mm} html,body{margin:0;padding:0} body{font-family:Arial,sans-serif;color:#000}
      .hoja{width:76mm}.fila{display:grid;grid-template-columns:repeat(${columnas},1fr);align-items:start;break-after:page;page-break-after:always}.fila[data-ultima]{break-after:auto;page-break-after:auto}.etiqueta{width:${etiquetaAncho};min-height:${altoEtiqueta};padding:2mm 1mm;display:flex;align-items:flex-start;justify-content:center;gap:1mm;break-inside:avoid}.etiqueta-info{flex:1;min-width:0}.serie{font-size:${columnas === 1 ? '10pt' : '5.5pt'};font-weight:900;line-height:1.05;overflow-wrap:anywhere}.nombre{font-size:${columnas === 1 ? '8pt' : '5.5pt'};font-weight:700;margin-top:1mm;line-height:1.1;overflow-wrap:anywhere}.tipo{font-size:5pt;font-weight:400}.cliente{font-size:5pt;color:#444;margin-top:1mm;overflow-wrap:anywhere}.qr{width:${qrTam};height:${qrTam};flex-shrink:0}.qr svg{display:block;width:100%;height:100%}
      @media screen{body{padding:12mm;background:#eef1f6}.hoja{max-width:76mm;margin:auto}.fila{background:#fff;box-shadow:0 2px 15px #0002;margin-bottom:3mm}}
    </style></head><body><main class="hoja">${filasHtml}</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));</script></body></html>`);
  } catch (err) { res.status(500).send(resetBox('Error', '#ef4444', `<h2>Error al generar etiquetas</h2><p>${escH(err.message)}</p>`)); }
});

app.get('/api/equipos/:id/etiqueta', async (req, res) => {
  try {
    const eq = db.prepare(`SELECT e.*, c.nombre as cliente_nombre FROM equipos e LEFT JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?`).get(req.params.id);
    if (!eq) return res.status(404).send('No encontrado');

    const incSerie   = req.query.serie   !== undefined;
    const incNombre  = req.query.nombre  !== undefined;
    const incTipo    = req.query.tipo    !== undefined;
    const incCliente = req.query.cliente !== undefined;
    const incQr      = req.query.qr      !== undefined;

    const serie = incSerie ? escH(eq.numero_serie || '(sin serie)') : '';
    const nombre = incNombre ? escH(eq.nombre) : '';
    const tipo = incTipo ? escH(eq.tipo) : '';
    const cliente = incCliente ? escH(eq.cliente_nombre || '') : '';

    let qrSvg = '';
    if (incQr) {
      const host = req.headers.host || `localhost:${PORT}`;
      const deepLink = `http://${host}/equipo/${eq.id}`;
      qrSvg = await QRCode.toString(deepLink, { type: 'svg', margin: 0, width: 80, color: { dark: '#000', light: '#fff' } });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Etiqueta ${escH(eq.numero_serie || eq.nombre)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 80mm auto; margin: 1.5mm 2mm; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-font-smoothing: none; }
.wrap { display:flex; align-items:flex-start; gap:4mm; }
.info { flex:1; min-width:0; }
.serie { font-size:14pt; font-weight:900; letter-spacing:0.04em; line-height:1.1; }
.nombre { font-size:8.5pt; font-weight:700; margin-top:1.5mm; }
.cliente { font-size:7.5pt; color:#444; }
.qr { flex-shrink:0; width:17mm; height:17mm; }
.qr svg { width:100%; height:100%; }
@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
@media screen { body { padding:10px; } }
</style>
</head><body>
<div class="wrap">
  ${(serie || nombre || tipo || cliente) ? `<div class="info">
    ${serie ? `<div class="serie">${serie}</div>` : ''}
    ${(nombre || tipo) ? `<div class="nombre">${nombre}${tipo ? ` <span style="font-weight:400;font-size:7pt">${nombre ? '(' + tipo + ')' : tipo}</span>` : ''}</div>` : ''}
    ${cliente ? `<div class="cliente">${cliente}</div>` : ''}
  </div>` : ''}
  ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
</div>
<script>if(!window.matchMedia('print').matches){ window.onload=()=>{ window.print(); window.onafterprint=()=>window.close(); }; }</script>
</body></html>`);
  } catch (err) {
    res.status(500).send(resetBox('Error', '#ef4444', `<h2>Error al generar etiqueta</h2><p>${escH(err.message)}</p>`));
  }
});

// ---------- Vista de equipo (QR) — Mobile app ----------

app.get('/equipo/:id', (req, res) => {
  const usuario = getUsuarioFromReq(req);
  if (!usuario) return res.redirect('/?qr_equipo=' + req.params.id);
  res.sendFile(path.join(__dirname, 'public', 'equipo.html'));
});

// ---------- Vista de equipo (QR) — legacy (dead code) ----------

app.get('/equipo-legacy/:id', (req, res) => {
  const usuario = getUsuarioFromReq(req);
  if (!usuario) {
    return res.redirect(`/?qr_equipo=${req.params.id}`);
  }

  const eq = db.prepare(`
    SELECT e.*, c.nombre AS cliente_nombre, c.telefono AS cliente_tel, c.email AS cliente_email
    FROM equipos e LEFT JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?
  `).get(req.params.id);
  if (!eq) return res.status(404).send(resetBox('No encontrado', '#ef4444', '<h2>Equipo no encontrado</h2><p>El QR puede ser antiguo o incorrecto.</p>'));

  const historial = db.prepare(`SELECT * FROM historial WHERE equipo_id = ? ORDER BY fecha DESC, id DESC LIMIT 5`).all(eq.id);
  const ticketActivo = db.prepare(`SELECT * FROM tickets WHERE equipo_id = ? AND estado NOT IN ('Entregado','Cerrado') ORDER BY id DESC LIMIT 1`).get(eq.id);
  const componentes = db.prepare(`SELECT tipo, descripcion, numero_serie FROM componentes WHERE equipo_id = ? ORDER BY id`).all(eq.id);

  const fmtF = d => { if (!d) return '—'; const [y,m,dd] = d.split('-'); return `${dd}/${m}/${y}`; };

  const COLORES_ESTADO = {
    'Pendiente':'#94a3b8','Diagnóstico':'#3b82f6','En reparación':'#f59e0b',
    'Esperando piezas':'#a855f7','Listo':'#22c55e','Entregado':'#10b981','Cerrado':'#64748b',
  };

  const garantiaTxt = (() => {
    if (!eq.fecha_entrega || !eq.meses_garantia) return null;
    const [y,m,d] = eq.fecha_entrega.split('-').map(Number);
    const fin = new Date(y, m - 1 + Number(eq.meses_garantia), d);
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    return fin >= hoy
      ? { txt: `En garantía hasta ${fin.toLocaleDateString('es-ES')}`, ok: true }
      : { txt: `Garantía caducada (${fin.toLocaleDateString('es-ES')})`, ok: false };
  })();

  const filasInfo = [
    eq.cliente_nombre   ? ['Cliente',      escH(eq.cliente_nombre)]       : null,
    eq.numero_serie     ? ['N.º de serie', escH(eq.numero_serie)]          : null,
    eq.fecha_entrega    ? ['Recepción',    fmtF(eq.fecha_entrega)]          : null,
    eq.meses_garantia   ? ['Garantía',     eq.meses_garantia + ' meses']   : null,
    garantiaTxt ? ['Estado garantía', `<span style="color:${garantiaTxt.ok?'#16a34a':'#dc2626'}">${garantiaTxt.txt}</span>`] : null,
    eq.mantenimiento    ? ['Mantenimiento','Sí']                            : null,
    TIPOS_CON_BATERIA.has(eq.tipo) && eq.bateria_vida_pct != null
      ? ['Vida batería', `${eq.bateria_vida_pct}%${eq.bateria_cap_actual != null ? ` (${eq.bateria_cap_actual} mWh)` : ''}`] : null,
  ].filter(Boolean);

  const filasHist = historial.map(h => `
    <div class="hint">
      <div class="hint-head">
        <span class="hint-fecha">${fmtF(h.fecha)}</span>
        <span class="hint-tipo">${escH(h.tipo)}</span>
      </div>
      ${h.problema_reportado ? `<div class="hint-line"><b>Problema:</b> ${escH(h.problema_reportado)}</div>` : ''}
      <div class="hint-line"><b>Trabajo:</b> ${escH(h.descripcion)}</div>
      ${h.tecnico ? `<div class="hint-line hint-muted">Técnico: ${escH(h.tecnico)}</div>` : ''}
    </div>`).join('');

  const ticketHtml = ticketActivo ? (() => {
    const col = COLORES_ESTADO[ticketActivo.estado] || '#94a3b8';
    return `<div class="sect-titulo">Ticket activo</div>
      <div class="ticket-card" style="border-left:3px solid ${col}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong>${escH(ticketActivo.numero)}</strong>
          <span class="estado-pill" style="background:${col}22;color:${pillTextColor(col)};border:1px solid ${col}55">${escH(ticketActivo.estado)}</span>
        </div>
        ${ticketActivo.descripcion ? `<div class="hint-line" style="margin-top:6px">${escH(ticketActivo.descripcion)}</div>` : ''}
        ${ticketActivo.tecnico_asignado ? `<div class="hint-muted" style="margin-top:4px;font-size:0.8rem">Técnico: ${escH(ticketActivo.tecnico_asignado)}</div>` : ''}
        ${ticketActivo.fecha_estimada ? `<div class="hint-muted" style="font-size:0.8rem">Estimado: ${fmtF(ticketActivo.fecha_estimada)}</div>` : ''}
      </div>`;
  })() : '';

  const compHtml = componentes.length ? `<div class="sect-titulo">Componentes</div>
    ${componentes.map(c => `<div class="comp-row"><strong>${escH(c.tipo)}</strong>${c.descripcion?` — ${escH(c.descripcion)}`:''}${c.numero_serie?`<br><small style="color:#64748b">S/N: ${escH(c.numero_serie)}</small>`:''}</div>`).join('')}`
    : '';

  const cfg = getCfg();
  const nombre_taller = cfg.nombre_taller || 'Control de Equipos';

  const TIPO_EMOJI = { 'PC':'🖥️', 'Portátil':'💻', 'Tablet':'📱', 'TPV':'🖨️', 'Periférico':'🖱️' };
  const tipoEmoji = TIPO_EMOJI[eq.tipo] || '🔧';

  const COLOR_ESTADO = {
    'Pendiente':'#94a3b8','Diagnóstico':'#3b82f6','En reparación':'#f59e0b',
    'Esperando piezas':'#a855f7','Listo':'#22c55e','Entregado':'#10b981','Cerrado':'#64748b',
  };
  const COLOR_TIPO_HIST = {
    'Reparación':'#ef4444','Sustitución de componente':'#f97316','Mantenimiento preventivo':'#22c55e',
    'Actualización de software':'#3b82f6','Limpieza':'#06b6d4','Diagnóstico':'#a855f7',
    'Configuración':'#6366f1','Entrega':'#10b981',
  };

  const ticketBanner = ticketActivo ? (() => {
    const col = COLOR_ESTADO[ticketActivo.estado] || '#94a3b8';
    return `<div class="tk-banner" style="--tc:${col}">
      <div class="tk-banner-top">
        <span class="tk-num">${escH(ticketActivo.numero)}</span>
        <span class="tk-pill">${escH(ticketActivo.estado)}</span>
      </div>
      ${ticketActivo.descripcion ? `<div class="tk-desc">${escH(ticketActivo.descripcion)}</div>` : ''}
      <div class="tk-meta">
        ${ticketActivo.tecnico_asignado ? `<span>👤 ${escH(ticketActivo.tecnico_asignado)}</span>` : ''}
        ${ticketActivo.fecha_estimada ? `<span>📅 Estimado: ${fmtF(ticketActivo.fecha_estimada)}</span>` : ''}
      </div>
    </div>`;
  })() : '';

  const histItems = historial.map((h, i) => {
    const col = COLOR_TIPO_HIST[h.tipo] || '#94a3b8';
    return `<div class="tl-item${i === historial.length - 1 ? ' last' : ''}">
      <div class="tl-line"><div class="tl-dot" style="background:${col}"></div></div>
      <div class="tl-body">
        <div class="tl-meta">
          <span class="tl-fecha">${fmtF(h.fecha)}</span>
          <span class="tl-tipo" style="color:${col};background:${col}18">${escH(h.tipo)}</span>
        </div>
        ${h.problema_reportado ? `<div class="tl-prob">❗ ${escH(h.problema_reportado)}</div>` : ''}
        <div class="tl-work">${escH(h.descripcion)}</div>
        ${h.tecnico ? `<div class="tl-tec">👤 ${escH(h.tecnico)}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  const compChips = componentes.length ? componentes.map(c =>
    `<div class="comp-chip">
      <div class="comp-tipo">${escH(c.tipo)}${c.descripcion ? ` <span class="comp-desc">· ${escH(c.descripcion)}</span>` : ''}</div>
      ${c.numero_serie ? `<div class="comp-sn">S/N ${escH(c.numero_serie)}</div>` : ''}
    </div>`
  ).join('') : '';

  const infoChips = [
    eq.numero_serie  ? `<div class="info-chip"><span class="ic-label">N/S</span><span class="ic-val">${escH(eq.numero_serie)}</span></div>` : '',
    eq.fecha_entrega ? `<div class="info-chip"><span class="ic-label">Recepción</span><span class="ic-val">${fmtF(eq.fecha_entrega)}</span></div>` : '',
    garantiaTxt      ? `<div class="info-chip" style="--cc:${garantiaTxt.ok?'#16a34a':'#dc2626'}"><span class="ic-label">Garantía</span><span class="ic-val ic-val--color">${garantiaTxt.txt}</span></div>` : '',
    eq.mantenimiento ? `<div class="info-chip" style="--cc:#16a34a"><span class="ic-label">Mantenimiento</span><span class="ic-val ic-val--color">Activo</span></div>` : '',
    TIPOS_CON_BATERIA.has(eq.tipo) && eq.bateria_vida_pct != null
      ? `<div class="info-chip"><span class="ic-label">Batería</span><span class="ic-val">${eq.bateria_vida_pct}%${eq.bateria_cap_actual!=null?` · ${eq.bateria_cap_actual} mWh`:''}</span></div>` : '',
  ].filter(Boolean).join('');

  const telHtml = eq.cliente_tel
    ? `<a href="tel:${escH(eq.cliente_tel)}" class="tel-link">📞 ${escH(eq.cliente_tel)}</a>` : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0f1b3d">
<title>${escH(eq.nombre)}</title>
<style>
:root{--blue:#2563eb;--dark:#0f1b3d;--bg:#f0f4f8;--white:#fff;--text:#1e293b;--muted:#64748b;--border:#e2e8f0;--radius:16px;--shadow:0 2px 12px rgba(0,0,0,.08)}
*{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);min-height:100vh;padding-bottom:env(safe-area-inset-bottom,20px)}

/* Hero */
.hero{background:linear-gradient(150deg,var(--dark) 0%,#1a3a8f 100%);padding:calc(16px + env(safe-area-inset-top,0px)) 20px 28px;position:relative;overflow:hidden}
.hero::after{content:'';position:absolute;inset:0;background:radial-gradient(circle at 80% 50%,rgba(37,99,235,.4) 0%,transparent 60%);pointer-events:none}
.hero-taller{font-size:.72rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:10px}
.hero-emoji{font-size:2.2rem;line-height:1;margin-bottom:8px}
.hero-nombre{font-size:1.5rem;font-weight:800;color:#fff;line-height:1.2;margin-bottom:6px}
.hero-tipo{display:inline-block;font-size:.72rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;background:rgba(255,255,255,.15);color:rgba(255,255,255,.9);padding:3px 10px;border-radius:999px;backdrop-filter:blur(4px)}
.hero-cliente{margin-top:10px;font-size:.85rem;color:rgba(255,255,255,.75);display:flex;align-items:center;gap:6px;flex-wrap:wrap}

/* Ticket banner */
.tk-banner{margin:16px 16px 0;background:var(--white);border-radius:var(--radius);padding:14px 16px;border-left:4px solid var(--tc,#94a3b8);box-shadow:var(--shadow)}
.tk-banner-top{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:6px}
.tk-num{font-family:ui-monospace,monospace;font-size:.8rem;font-weight:700;color:var(--blue)}
.tk-pill{font-size:.7rem;font-weight:800;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--tc) 15%,transparent);color:var(--tc);border:1px solid color-mix(in srgb,var(--tc) 35%,transparent);white-space:nowrap}
.tk-label{font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:4px}
.tk-title{font-weight:700;font-size:.82rem;margin-bottom:2px}
.tk-desc{font-size:.83rem;color:var(--text);line-height:1.4;margin-bottom:6px}
.tk-meta{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:.78rem;color:var(--muted)}

/* Info chips */
.chips-wrap{padding:16px 16px 0;display:flex;flex-direction:column;gap:1px;background:var(--border);border-radius:var(--radius);overflow:hidden;margin:16px 16px 0;box-shadow:var(--shadow)}
.info-chip{background:var(--white);padding:12px 14px;display:flex;justify-content:space-between;align-items:center;gap:8px}
.ic-label{font-size:.75rem;font-weight:600;color:var(--muted);white-space:nowrap}
.ic-val{font-size:.85rem;font-weight:600;text-align:right}
.ic-val--color{color:var(--cc,var(--text))}

/* Notas */
.notas-box{margin:12px 16px 0;background:var(--white);border-radius:var(--radius);padding:12px 14px;font-size:.83rem;color:var(--muted);font-style:italic;line-height:1.5;box-shadow:var(--shadow)}

/* Tel link */
.tel-link{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;background:rgba(37,99,235,.08);color:var(--blue);border-radius:999px;font-size:.82rem;font-weight:600;text-decoration:none;margin-top:6px}

/* Section header */
.sh{display:flex;align-items:center;gap:8px;margin:22px 16px 10px}
.sh-line{flex:1;height:1px;background:var(--border)}
.sh-txt{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);white-space:nowrap}

/* Timeline */
.timeline{margin:0 16px;display:flex;flex-direction:column}
.tl-item{display:flex;gap:12px;padding-bottom:16px}
.tl-item.last{padding-bottom:0}
.tl-line{display:flex;flex-direction:column;align-items:center;width:18px;flex-shrink:0;padding-top:3px}
.tl-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;box-shadow:0 0 0 3px var(--white)}
.tl-line::after{content:'';flex:1;width:2px;background:var(--border);margin-top:4px}
.tl-item.last .tl-line::after{display:none}
.tl-body{flex:1;min-width:0;background:var(--white);border-radius:12px;padding:11px 13px;box-shadow:var(--shadow)}
.tl-meta{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:5px}
.tl-fecha{font-size:.73rem;color:var(--muted);white-space:nowrap}
.tl-tipo{font-size:.68rem;font-weight:700;padding:2px 8px;border-radius:999px}
.tl-prob{font-size:.8rem;color:#b45309;background:#fef3c7;border-radius:6px;padding:4px 8px;margin-bottom:4px;line-height:1.4}
.tl-work{font-size:.83rem;line-height:1.45;color:var(--text)}
.tl-tec{font-size:.74rem;color:var(--muted);margin-top:4px}

/* Componentes */
.comp-grid{margin:0 16px;display:flex;flex-direction:column;gap:8px}
.comp-chip{background:var(--white);border-radius:12px;padding:10px 14px;box-shadow:var(--shadow)}
.comp-tipo{font-size:.85rem;font-weight:600}
.comp-desc{font-weight:400;color:var(--muted)}
.comp-sn{font-size:.72rem;color:var(--muted);margin-top:2px;font-family:ui-monospace,monospace}

/* CTA */
.cta{margin:24px 16px 0;display:flex;flex-direction:column;gap:10px}
.btn-cta{display:flex;align-items:center;justify-content:center;gap:8px;padding:15px;border-radius:var(--radius);font-size:.95rem;font-weight:700;text-decoration:none;transition:opacity .15s}
.btn-cta:active{opacity:.75}
.btn-primary{background:var(--blue);color:#fff}

/* Footer */
.footer{padding:20px 16px;text-align:center;font-size:.72rem;color:var(--muted)}
</style>
</head><body>

<div class="hero">
  <div class="hero-taller">${escH(nombre_taller)}</div>
  <div class="hero-emoji">${tipoEmoji}</div>
  <div class="hero-nombre">${escH(eq.nombre)}</div>
  <span class="hero-tipo">${escH(eq.tipo)}</span>
  ${eq.cliente_nombre ? `<div class="hero-cliente"><span style="opacity:.5">Cliente</span> <strong style="color:#fff">${escH(eq.cliente_nombre)}</strong>${telHtml}</div>` : ''}
</div>

${ticketActivo ? `
<div style="margin:16px 16px 0;font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:#f59e0b;display:flex;align-items:center;gap:6px">
  <span style="width:7px;height:7px;border-radius:50%;background:#f59e0b;display:inline-block;animation:pulse 1.5s infinite"></span>
  Ticket en curso
</div>
${ticketBanner}` : ''}

${infoChips ? `<div class="chips-wrap">${infoChips}</div>` : ''}
${eq.notas ? `<div class="notas-box">💬 ${escH(eq.notas)}</div>` : ''}

${compChips ? `
<div class="sh"><span class="sh-txt">Componentes</span><div class="sh-line"></div></div>
<div class="comp-grid">${compChips}</div>` : ''}

${historial.length ? `
<div class="sh"><span class="sh-txt">Historial de intervenciones</span><div class="sh-line"></div></div>
<div class="timeline">${histItems}</div>` : ''}

<div class="cta">
  <a href="/" class="btn-cta btn-primary">Abrir aplicación completa →</a>
</div>

<div class="footer">${escH(nombre_taller)} · ${new Date().toLocaleDateString('es-ES')}</div>

<style>@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}</style>
</body></html>`);
});

// ---------- Inventario ----------

function inventarioCantidad(value, label = 'La cantidad') {
  const cantidad = optionalNumber(value, label, { min: Number.MIN_VALUE });
  if (cantidad == null) throw new Error(`${label} es obligatoria`);
  return cantidad;
}

function inventarioSalidaCompleta(id) {
  const salida = db.prepare(`
    SELECT s.*, c.nombre AS cliente_nombre
    FROM inventario_salidas s LEFT JOIN clientes c ON c.id = s.cliente_id
    WHERE s.id = ?
  `).get(id);
  if (!salida) return null;
  salida.lineas = db.prepare(`
    SELECT l.*, a.codigo, a.nombre, a.unidad
    FROM inventario_salida_lineas l JOIN inventario_articulos a ON a.id = l.articulo_id
    WHERE l.salida_id = ? ORDER BY l.id
  `).all(id);
  return salida;
}

function normalizarEan(value) {
  const ean = String(value ?? '').replace(/[^0-9]/g, '');
  if (!ean) return null;
  if (![8, 12, 13, 14].includes(ean.length)) throw new Error('El EAN debe tener 8, 12, 13 o 14 dígitos');
  return ean;
}

async function buscarArticuloPorEan(ean) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(ean)}`, {
      headers: { Accept: 'application/json' }, signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Servicio de consulta no disponible (${response.status})`);
    const data = await response.json();
    const item = data.items?.[0];
    if (!item) return null;
    return {
      ean,
      nombre: item.title || item.description || '',
      categoria: item.category || null,
      marca: item.brand || null,
      imagen: item.images?.[0] || null,
    };
  } finally { clearTimeout(timeout); }
}

app.get('/api/inventario/articulos', (req, res) => {
  const incluirInactivos = req.query.incluir_inactivos === '1';
  const q = String(req.query.q || '').trim();
  const where = [incluirInactivos ? '1 = 1' : 'a.activo = 1'];
  const params = [];
  if (q) {
    where.push('(a.nombre LIKE ? OR a.codigo LIKE ? OR a.categoria LIKE ? OR a.ubicacion LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const articulos = db.prepare(`
    SELECT a.*, CASE WHEN a.stock <= a.stock_minimo THEN 1 ELSE 0 END AS stock_bajo,
      (SELECT MAX(m.creado_en) FROM inventario_movimientos m WHERE m.articulo_id = a.id) AS ultimo_movimiento
    FROM inventario_articulos a WHERE ${where.join(' AND ')}
    ORDER BY a.activo DESC, a.nombre COLLATE NOCASE
  `).all(...params);
  res.json(articulos);
});

app.get('/api/inventario/buscar-ean/:ean', async (req, res) => {
  let ean;
  try { ean = normalizarEan(req.params.ean); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  if (!ean) return res.status(400).json({ error: 'EAN vacío' });
  const local = db.prepare(`SELECT * FROM inventario_articulos WHERE ean = ?`).get(ean);
  if (local) return res.json({ encontrado: true, origen: 'local', articulo: local });
  try {
    const articulo = await buscarArticuloPorEan(ean);
    if (!articulo) return res.status(404).json({ error: 'No se ha encontrado ningún producto para ese EAN' });
    res.json({ encontrado: true, origen: 'upcitemdb', articulo });
  } catch (err) {
    res.status(502).json({ error: 'No se pudo consultar el servicio público de EAN. Puedes completar el nombre manualmente.' });
  }
});

app.post('/api/inventario/articulos', (req, res) => {
  const { codigo, ean: eanBody, nombre, categoria, unidad, stock_minimo, ubicacion, notas } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del artículo es obligatorio' });
  let minimo, ean;
  let inicial;
  try {
    ean = eanBody ? normalizarEan(eanBody) : null;
    minimo = stock_minimo === undefined || stock_minimo === '' ? 0 : optionalNumber(stock_minimo, 'El stock mínimo', { min: 0 });
    inicial = req.body.stock === undefined || req.body.stock === '' ? 0 : optionalNumber(req.body.stock, 'El stock inicial', { min: 0 });
  } catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const crear = db.transaction(() => {
      const info = db.prepare(`INSERT INTO inventario_articulos (codigo, ean, nombre, categoria, unidad, stock, stock_minimo, ubicacion, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(optionalText(codigo), ean, nombre.trim(), optionalText(categoria), optionalText(unidad) || 'ud.', inicial, minimo, optionalText(ubicacion), optionalText(notas));
      if (inicial > 0) db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario) VALUES (?, 'entrada', ?, 0, ?, 'Stock inicial', ?)`)
        .run(info.lastInsertRowid, inicial, inicial, req.usuario?.nombre || 'Sistema');
      return info.lastInsertRowid;
    });
    const id = crear();
    res.status(201).json(db.prepare(`SELECT * FROM inventario_articulos WHERE id = ?`).get(id));
  } catch (err) {
    res.status(err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400).json({ error: err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'El código ya está en uso' : err.message });
  }
});

app.put('/api/inventario/articulos/:id', (req, res) => {
  const { codigo, ean: eanBody, nombre, categoria, unidad, stock_minimo, ubicacion, notas, activo } = req.body;
  if (!nombre?.trim()) return res.status(400).json({ error: 'El nombre del artículo es obligatorio' });
  let minimo, ean;
  try { ean = eanBody ? normalizarEan(eanBody) : null; minimo = optionalNumber(stock_minimo, 'El stock mínimo', { min: 0 }); }
  catch (err) { return res.status(400).json({ error: err.message }); }
  try {
    const info = db.prepare(`UPDATE inventario_articulos SET codigo=?, ean=?, nombre=?, categoria=?, unidad=?, stock_minimo=?, ubicacion=?, notas=?, activo=? WHERE id=?`)
      .run(optionalText(codigo), ean, nombre.trim(), optionalText(categoria), optionalText(unidad) || 'ud.', minimo ?? 0, optionalText(ubicacion), optionalText(notas), activo === false ? 0 : 1, req.params.id);
    if (!info.changes) return res.status(404).json({ error: 'Artículo no encontrado' });
    res.json(db.prepare(`SELECT * FROM inventario_articulos WHERE id = ?`).get(req.params.id));
  } catch (err) {
    res.status(err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 400).json({ error: err.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 'El código ya está en uso' : err.message });
  }
});

// La eliminación de artículos se hace como baja lógica para conservar
// movimientos y salidas históricas. Dejan de aparecer en el catálogo activo.
app.post('/api/inventario/articulos/eliminar', (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.ids) ? req.body.ids : [])
    .map(Number)
    .filter(id => Number.isInteger(id) && id > 0))];
  if (!ids.length) return res.status(400).json({ error: 'Selecciona al menos un artículo' });
  const marks = ids.map(() => '?').join(',');
  const activos = db.prepare(`SELECT id FROM inventario_articulos WHERE activo = 1 AND id IN (${marks})`).all(...ids);
  if (!activos.length) return res.status(404).json({ error: 'No se encontraron artículos activos para eliminar' });
  db.prepare(`UPDATE inventario_articulos SET activo = 0 WHERE activo = 1 AND id IN (${marks})`).run(...ids);
  res.json({ eliminados: activos.length, ids: activos.map(a => a.id) });
});

function separarFilaCSV(linea, separador) {
  const valores = []; let actual = ''; let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (ch === '"' && entreComillas && linea[i + 1] === '"') { actual += '"'; i++; continue; }
    if (ch === '"') { entreComillas = !entreComillas; continue; }
    if (ch === separador && !entreComillas) { valores.push(actual.trim()); actual = ''; }
    else actual += ch;
  }
  valores.push(actual.trim());
  return valores;
}

function normalizarCabeceraCSV(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parsearCSVInventario(texto) {
  const filas = String(texto || '').replace(/^\uFEFF/, '').split(/\r?\n/).filter(linea => linea.trim());
  if (!filas.length) return [];
  const separador = (filas[0].match(/;/g) || []).length >= (filas[0].match(/,/g) || []).length ? ';' : ',';
  const cabeceras = separarFilaCSV(filas.shift(), separador).map(normalizarCabeceraCSV);
  const indice = (...nombres) => nombres.map(normalizarCabeceraCSV).map(n => cabeceras.indexOf(n)).find(i => i >= 0);
  const columnas = {
    ean: indice('ean', 'barcode', 'codigo_de_barras', 'gtin'), codigo: indice('codigo', 'sku', 'referencia'),
    nombre: indice('nombre', 'articulo', 'producto', 'nombre_articulo'), categoria: indice('categoria', 'familia'),
    unidad: indice('unidad', 'unidades'), stock: indice('stock', 'existencias', 'cantidad'),
    stock_minimo: indice('stock_minimo', 'minimo', 'stock_min'), ubicacion: indice('ubicacion', 'almacen'), notas: indice('notas', 'observaciones'),
  };
  if (columnas.nombre == null) throw new Error('El CSV debe incluir una columna «nombre» o «artículo»');
  return filas.map(linea => {
    const c = separarFilaCSV(linea, separador);
    const get = key => columnas[key] == null ? '' : c[columnas[key]] || '';
    return { ean: get('ean'), codigo: get('codigo'), nombre: get('nombre'), categoria: get('categoria'), unidad: get('unidad'), stock: get('stock'), stock_minimo: get('stock_minimo'), ubicacion: get('ubicacion'), notas: get('notas') };
  });
}

app.post('/api/inventario/importar', (req, res) => {
  try {
    const filas = parsearCSVInventario(req.body?.contenido);
    if (filas.length > 2000) return res.status(400).json({ error: 'El CSV no puede superar 2.000 filas' });
    const resultado = { creados: 0, actualizados: 0, errores: [], stock_inicial_aplicado: 0 };
    const importar = db.transaction(() => {
      filas.forEach((fila, index) => {
        try {
          if (!fila.nombre.trim()) throw new Error('falta el nombre');
          const ean = fila.ean.trim() ? normalizarEan(fila.ean) : null;
          const stock = fila.stock.trim() === '' ? 0 : optionalNumber(fila.stock.replace(',', '.'), 'stock', { min: 0 });
          const minimo = fila.stock_minimo.trim() === '' ? 0 : optionalNumber(fila.stock_minimo.replace(',', '.'), 'stock mínimo', { min: 0 });
          const existente = ean
            ? db.prepare(`SELECT * FROM inventario_articulos WHERE ean = ?`).get(ean)
            : fila.codigo.trim() ? db.prepare(`SELECT * FROM inventario_articulos WHERE codigo = ?`).get(fila.codigo.trim()) : null;
          if (existente) {
            db.prepare(`UPDATE inventario_articulos SET codigo=?, ean=?, nombre=?, categoria=?, unidad=?, stock_minimo=?, ubicacion=?, notas=? WHERE id=?`)
              .run(optionalText(fila.codigo) || existente.codigo, ean || existente.ean, fila.nombre.trim(), optionalText(fila.categoria), optionalText(fila.unidad) || 'ud.', minimo, optionalText(fila.ubicacion), optionalText(fila.notas), existente.id);
            resultado.actualizados++;
          } else {
            const info = db.prepare(`INSERT INTO inventario_articulos (codigo, ean, nombre, categoria, unidad, stock, stock_minimo, ubicacion, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(optionalText(fila.codigo), ean, fila.nombre.trim(), optionalText(fila.categoria), optionalText(fila.unidad) || 'ud.', stock, minimo, optionalText(fila.ubicacion), optionalText(fila.notas));
            if (stock > 0) db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, usuario) VALUES (?, 'entrada', ?, 0, ?, 'Importación CSV', ?)`)
              .run(info.lastInsertRowid, stock, stock, req.usuario?.nombre || 'Sistema');
            if (stock > 0) resultado.stock_inicial_aplicado++;
            resultado.creados++;
          }
        } catch (err) { resultado.errores.push(`Fila ${index + 2}: ${err.message}`); }
      });
    });
    importar();
    res.json(resultado);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

function inventarioMovimientosQuery({ tipo = '', q = '', limit = null } = {}) {
  const where = ['1 = 1'];
  const params = [];
  if (tipo === 'entradas') {
    where.push(`m.tipo IN ('entrada', 'ajuste')`);
  } else if (['entrada', 'ajuste', 'salida'].includes(tipo)) {
    where.push('m.tipo = ?'); params.push(tipo);
  }
  if (q) {
    where.push('(a.nombre LIKE ? OR a.codigo LIKE ? OR a.ean LIKE ? OR m.referencia LIKE ? OR c.nombre LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like, like);
  }
  const sql = `
    SELECT m.*, a.nombre AS articulo_nombre, a.codigo AS articulo_codigo, a.unidad,
      c.nombre AS cliente_nombre
    FROM inventario_movimientos m
      JOIN inventario_articulos a ON a.id = m.articulo_id
      LEFT JOIN inventario_salidas s ON s.id = m.salida_id
      LEFT JOIN clientes c ON c.id = s.cliente_id
    WHERE ${where.join(' AND ')}
    ORDER BY m.creado_en DESC, m.id DESC
    ${limit ? 'LIMIT ?' : ''}
  `;
  return db.prepare(sql).all(...params, ...(limit ? [limit] : []));
}

app.get('/api/inventario/dashboard', (req, res) => {
  const entradas = db.prepare(`SELECT COUNT(*) AS n FROM inventario_movimientos WHERE tipo IN ('entrada', 'ajuste') AND date(creado_en) = date('now')`).get().n;
  const salidas = db.prepare(`SELECT COUNT(*) AS n FROM inventario_movimientos WHERE tipo = 'salida' AND date(creado_en) = date('now')`).get().n;
  const recientes = inventarioMovimientosQuery({ limit: 8 });
  res.json({ resumen: { entradas, salidas }, recientes });
});

app.get('/api/inventario/movimientos', (req, res) => {
  const tipo = String(req.query.tipo || '').trim();
  const q = String(req.query.q || '').trim();
  res.json(inventarioMovimientosQuery({ tipo, q, limit: 200 }));
});

app.post('/api/inventario/movimientos', (req, res) => {
  const articulo = db.prepare(`SELECT * FROM inventario_articulos WHERE id = ?`).get(req.body.articulo_id);
  if (!articulo) return res.status(404).json({ error: 'Artículo no encontrado' });
  const tipo = req.body.tipo === 'ajuste' ? 'ajuste' : 'entrada';
  let cantidad, stockNuevo;
  try {
    if (tipo === 'entrada') {
      cantidad = inventarioCantidad(req.body.cantidad);
      stockNuevo = articulo.stock + cantidad;
    } else {
      stockNuevo = optionalNumber(req.body.stock_nuevo, 'El stock nuevo', { min: 0 });
      if (stockNuevo == null) throw new Error('El stock nuevo es obligatorio');
      cantidad = stockNuevo - articulo.stock;
    }
  } catch (err) { return res.status(400).json({ error: err.message }); }
  const aplicar = db.transaction(() => {
    db.prepare(`UPDATE inventario_articulos SET stock = ? WHERE id = ?`).run(stockNuevo, articulo.id);
    db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, referencia, notas, usuario) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(articulo.id, tipo, cantidad, articulo.stock, stockNuevo, optionalText(req.body.referencia), optionalText(req.body.notas), req.usuario?.nombre || 'Sistema');
  });
  aplicar();
  res.status(201).json(db.prepare(`SELECT * FROM inventario_articulos WHERE id = ?`).get(articulo.id));
});

app.post('/api/inventario/salidas', (req, res) => {
  const lineasEntrada = Array.isArray(req.body.lineas) ? req.body.lineas : [];
  if (!lineasEntrada.length) return res.status(400).json({ error: 'Añade al menos un artículo a la salida' });
  if (req.body.cliente_id != null && !db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(req.body.cliente_id))
    return res.status(404).json({ error: 'Cliente no encontrado' });
  const agregadas = new Map();
  try {
    lineasEntrada.forEach(linea => {
      const id = Number(linea.articulo_id);
      if (!Number.isInteger(id) || id <= 0) throw new Error('Artículo no válido');
      agregadas.set(id, (agregadas.get(id) || 0) + inventarioCantidad(linea.cantidad));
    });
  } catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const crearSalida = db.transaction(() => {
      const articulos = [...agregadas.entries()].map(([id]) => db.prepare(`SELECT * FROM inventario_articulos WHERE id = ? AND activo = 1`).get(id));
      if (articulos.some(a => !a)) throw new Error('Uno de los artículos no existe o está inactivo');
      articulos.forEach(a => {
        const cantidad = agregadas.get(a.id);
        if (a.stock < cantidad) throw new Error(`Stock insuficiente para «${a.nombre}» (disponible: ${a.stock} ${a.unidad})`);
      });
      const salida = db.prepare(`INSERT INTO inventario_salidas (cliente_id, fecha, referencia, notas, usuario, facturado) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(req.body.cliente_id || null, req.body.fecha || new Date().toISOString().slice(0, 10), optionalText(req.body.referencia), optionalText(req.body.notas), req.usuario?.nombre || 'Sistema', req.body.facturado ? 1 : 0);
      const lineaStmt = db.prepare(`INSERT INTO inventario_salida_lineas (salida_id, articulo_id, cantidad) VALUES (?, ?, ?)`);
      const updateStmt = db.prepare(`UPDATE inventario_articulos SET stock = stock - ? WHERE id = ?`);
      const movStmt = db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, salida_id, referencia, notas, usuario) VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?)`);
      articulos.forEach(a => {
        const cantidad = agregadas.get(a.id);
        const nuevo = a.stock - cantidad;
        lineaStmt.run(salida.lastInsertRowid, a.id, cantidad);
        updateStmt.run(cantidad, a.id);
        movStmt.run(a.id, -cantidad, a.stock, nuevo, salida.lastInsertRowid, optionalText(req.body.referencia), optionalText(req.body.notas), req.usuario?.nombre || 'Sistema');
      });
      return salida.lastInsertRowid;
    });
    const id = crearSalida();
    res.status(201).json(inventarioSalidaCompleta(id));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.get('/api/inventario/salidas/:id', (req, res) => {
  const salida = inventarioSalidaCompleta(req.params.id);
  if (!salida) return res.status(404).json({ error: 'Salida no encontrada' });
  res.json(salida);
});

app.put('/api/inventario/salidas/:id', (req, res) => {
  const salidaActual = db.prepare(`SELECT * FROM inventario_salidas WHERE id = ?`).get(req.params.id);
  if (!salidaActual) return res.status(404).json({ error: 'Salida no encontrada' });
  const lineasEntrada = Array.isArray(req.body.lineas) ? req.body.lineas : [];
  if (!lineasEntrada.length) return res.status(400).json({ error: 'Añade al menos un artículo a la salida' });
  if (req.body.cliente_id != null && !db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(req.body.cliente_id))
    return res.status(404).json({ error: 'Cliente no encontrado' });
  const agregadas = new Map();
  try {
    lineasEntrada.forEach(linea => {
      const id = Number(linea.articulo_id);
      if (!Number.isInteger(id) || id <= 0) throw new Error('Artículo no válido');
      agregadas.set(id, (agregadas.get(id) || 0) + inventarioCantidad(linea.cantidad));
    });
  } catch (err) { return res.status(400).json({ error: err.message }); }

  try {
    const actualizarSalida = db.transaction(() => {
      // Revertir el stock de las líneas anteriores y borrar sus movimientos antes de validar las nuevas
      const lineasAntiguas = db.prepare(`SELECT * FROM inventario_salida_lineas WHERE salida_id = ?`).all(req.params.id);
      lineasAntiguas.forEach(l => db.prepare(`UPDATE inventario_articulos SET stock = stock + ? WHERE id = ?`).run(l.cantidad, l.articulo_id));
      db.prepare(`DELETE FROM inventario_movimientos WHERE salida_id = ?`).run(req.params.id);
      db.prepare(`DELETE FROM inventario_salida_lineas WHERE salida_id = ?`).run(req.params.id);

      const articulos = [...agregadas.entries()].map(([id]) => db.prepare(`SELECT * FROM inventario_articulos WHERE id = ? AND activo = 1`).get(id));
      if (articulos.some(a => !a)) throw new Error('Uno de los artículos no existe o está inactivo');
      articulos.forEach(a => {
        const cantidad = agregadas.get(a.id);
        if (a.stock < cantidad) throw new Error(`Stock insuficiente para «${a.nombre}» (disponible: ${a.stock} ${a.unidad})`);
      });

      db.prepare(`UPDATE inventario_salidas SET cliente_id = ?, fecha = ?, referencia = ?, notas = ?, facturado = ? WHERE id = ?`)
        .run(req.body.cliente_id || null, req.body.fecha || salidaActual.fecha, optionalText(req.body.referencia), optionalText(req.body.notas), req.body.facturado ? 1 : 0, req.params.id);

      const lineaStmt = db.prepare(`INSERT INTO inventario_salida_lineas (salida_id, articulo_id, cantidad) VALUES (?, ?, ?)`);
      const updateStmt = db.prepare(`UPDATE inventario_articulos SET stock = stock - ? WHERE id = ?`);
      const movStmt = db.prepare(`INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, salida_id, referencia, notas, usuario) VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?)`);
      articulos.forEach(a => {
        const cantidad = agregadas.get(a.id);
        const nuevo = a.stock - cantidad;
        lineaStmt.run(req.params.id, a.id, cantidad);
        updateStmt.run(cantidad, a.id);
        movStmt.run(a.id, -cantidad, a.stock, nuevo, req.params.id, optionalText(req.body.referencia), optionalText(req.body.notas), req.usuario?.nombre || 'Sistema');
      });
    });
    actualizarSalida();
    res.json(inventarioSalidaCompleta(req.params.id));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/inventario/salidas/:id', (req, res) => {
  const salida = db.prepare(`SELECT * FROM inventario_salidas WHERE id = ?`).get(req.params.id);
  if (!salida) return res.status(404).json({ error: 'Salida no encontrada' });
  const eliminarSalida = db.transaction(() => {
    const lineas = db.prepare(`SELECT * FROM inventario_salida_lineas WHERE salida_id = ?`).all(req.params.id);
    lineas.forEach(l => db.prepare(`UPDATE inventario_articulos SET stock = stock + ? WHERE id = ?`).run(l.cantidad, l.articulo_id));
    db.prepare(`DELETE FROM inventario_movimientos WHERE salida_id = ?`).run(req.params.id);
    db.prepare(`DELETE FROM inventario_salidas WHERE id = ?`).run(req.params.id);
  });
  eliminarSalida();
  res.status(204).end();
});

app.get('/api/inventario/salidas', (req, res) => {
  const salidas = db.prepare(`
    SELECT s.*, c.nombre AS cliente_nombre,
      (SELECT COUNT(*) FROM inventario_salida_lineas l WHERE l.salida_id = s.id) AS num_lineas,
      (SELECT COALESCE(SUM(l.cantidad), 0) FROM inventario_salida_lineas l WHERE l.salida_id = s.id) AS unidades
    FROM inventario_salidas s LEFT JOIN clientes c ON c.id = s.cliente_id
    ORDER BY s.fecha DESC, s.id DESC LIMIT 100
  `).all();
  salidas.forEach(s => { s.lineas = db.prepare(`SELECT l.*, a.nombre, a.codigo, a.unidad FROM inventario_salida_lineas l JOIN inventario_articulos a ON a.id = l.articulo_id WHERE l.salida_id = ? ORDER BY l.id`).all(s.id); });
  res.json(salidas);
});

app.get('/api/inventario/informe', (req, res) => {
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const clienteId = req.query.cliente_id ? Number(req.query.cliente_id) : null;
  const facturado = req.query.facturado === '1' ? 1 : req.query.facturado === '0' ? 0 : null;
  const where = ['1 = 1'];
  const params = [];
  if (desde) { where.push('s.fecha >= ?'); params.push(desde); }
  if (hasta) { where.push('s.fecha <= ?'); params.push(hasta); }
  if (Number.isInteger(clienteId) && clienteId > 0) { where.push('s.cliente_id = ?'); params.push(clienteId); }
  if (facturado != null) { where.push('s.facturado = ?'); params.push(facturado); }
  const salidas = db.prepare(`
    SELECT s.id, s.fecha, s.referencia, s.notas, s.usuario, s.cliente_id, s.facturado, c.nombre AS cliente_nombre,
      COUNT(l.id) AS lineas, COALESCE(SUM(l.cantidad), 0) AS unidades
    FROM inventario_salidas s LEFT JOIN clientes c ON c.id = s.cliente_id
      LEFT JOIN inventario_salida_lineas l ON l.salida_id = s.id
    WHERE ${where.join(' AND ')} GROUP BY s.id ORDER BY s.fecha DESC, s.id DESC
  `).all(...params);
  salidas.forEach(s => {
    s.lineas_detalle = db.prepare(`
      SELECT a.id AS articulo_id, a.nombre, a.unidad, l.cantidad, a.stock
      FROM inventario_salida_lineas l JOIN inventario_articulos a ON a.id = l.articulo_id
      WHERE l.salida_id = ? ORDER BY l.id
    `).all(s.id);
  });
  const articulos = db.prepare(`SELECT *, CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END AS stock_bajo FROM inventario_articulos WHERE activo = 1 ORDER BY nombre COLLATE NOCASE`).all();
  const facturadas = salidas.filter(s => s.facturado).length;
  res.json({
    resumen: {
      articulos: articulos.length, stock_bajo: articulos.filter(a => a.stock_bajo).length,
      salidas: salidas.length, unidades: salidas.reduce((s, x) => s + Number(x.unidades || 0), 0),
      facturadas, sin_facturar: salidas.length - facturadas,
    },
    articulos, salidas,
  });
});

app.put('/api/inventario/salidas/:id/facturado', (req, res) => {
  const info = db.prepare(`UPDATE inventario_salidas SET facturado = ? WHERE id = ?`).run(req.body.facturado ? 1 : 0, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Salida no encontrada' });
  res.json(inventarioSalidaCompleta(req.params.id));
});

app.get('/api/inventario/informe/csv', (req, res) => {
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const clienteId = req.query.cliente_id ? Number(req.query.cliente_id) : null;
  const facturado = req.query.facturado === '1' ? 1 : req.query.facturado === '0' ? 0 : null;
  const where = ['1 = 1']; const params = [];
  if (desde) { where.push('s.fecha >= ?'); params.push(desde); }
  if (hasta) { where.push('s.fecha <= ?'); params.push(hasta); }
  if (Number.isInteger(clienteId) && clienteId > 0) { where.push('s.cliente_id = ?'); params.push(clienteId); }
  if (facturado != null) { where.push('s.facturado = ?'); params.push(facturado); }
  const rows = db.prepare(`SELECT s.fecha, c.nombre AS cliente, s.referencia, a.codigo, a.nombre AS articulo, l.cantidad, a.unidad, s.usuario, s.facturado FROM inventario_salidas s LEFT JOIN clientes c ON c.id=s.cliente_id JOIN inventario_salida_lineas l ON l.salida_id=s.id JOIN inventario_articulos a ON a.id=l.articulo_id WHERE ${where.join(' AND ')} ORDER BY s.fecha DESC, s.id DESC, l.id`).all(...params);
  const esc = value => { const text = value == null ? '' : String(value); return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; };
  const csv = [['Fecha', 'Cliente', 'Referencia', 'Código', 'Artículo', 'Cantidad', 'Unidad', 'Usuario', 'Facturado'], ...rows.map(r => [r.fecha, r.cliente, r.referencia, r.codigo, r.articulo, r.cantidad, r.unidad, r.usuario, r.facturado ? 'Sí' : 'No'])].map(row => row.map(esc).join(';')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''inventario_${new Date().toISOString().slice(0,10)}.csv`);
  res.send('﻿' + csv);
});

app.get('/api/inventario/exportar/excel', async (req, res) => {
  const articulos = db.prepare(`SELECT * FROM inventario_articulos ORDER BY nombre COLLATE NOCASE`).all();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ControlEquipos'; wb.created = new Date();
  const estHead = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } } };
  const sh = wb.addWorksheet('Inventario');
  sh.columns = [
    { header: 'Código', key: 'codigo', width: 14 }, { header: 'EAN', key: 'ean', width: 16 },
    { header: 'Nombre', key: 'nombre', width: 36 }, { header: 'Categoría', key: 'categoria', width: 20 },
    { header: 'Unidad', key: 'unidad', width: 10 }, { header: 'Stock', key: 'stock', width: 10 },
    { header: 'Stock mínimo', key: 'stock_minimo', width: 13 }, { header: 'Ubicación', key: 'ubicacion', width: 16 },
    { header: 'Notas', key: 'notas', width: 30 }, { header: 'Activo', key: 'activo', width: 10 },
  ];
  articulos.forEach(a => sh.addRow({
    codigo: a.codigo || '', ean: a.ean || '', nombre: a.nombre, categoria: a.categoria || '',
    unidad: a.unidad, stock: a.stock, stock_minimo: a.stock_minimo, ubicacion: a.ubicacion || '',
    notas: a.notas || '', activo: a.activo ? 'Sí' : 'No',
  }));
  const r = sh.getRow(1); r.eachCell(c => Object.assign(c, estHead)); r.height = 18; r.commit();
  sh.autoFilter = { from: 'A1', to: 'J1' };

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''inventario_${new Date().toISOString().slice(0,10)}.xlsx`);
  await wb.xlsx.write(res);
  res.end();
});

function construirInformeSalidas({ desde, hasta, clienteId, facturado, logoSrc, pedir, pedirArticulos, paraCorreo }) {
  const where = ['1 = 1']; const params = [];
  if (desde) { where.push('s.fecha >= ?'); params.push(desde); }
  if (hasta) { where.push('s.fecha <= ?'); params.push(hasta); }
  if (Number.isInteger(clienteId) && clienteId > 0) { where.push('s.cliente_id = ?'); params.push(clienteId); }
  if (facturado != null) { where.push('s.facturado = ?'); params.push(facturado); }

  const lineas = db.prepare(`
    SELECT s.fecha, c.nombre AS cliente, s.referencia, a.id AS articulo_id, a.codigo, a.nombre AS articulo, l.cantidad, a.unidad
    FROM inventario_salidas s LEFT JOIN clientes c ON c.id = s.cliente_id
      JOIN inventario_salida_lineas l ON l.salida_id = s.id
      JOIN inventario_articulos a ON a.id = l.articulo_id
    WHERE ${where.join(' AND ')} ORDER BY s.fecha DESC, s.id DESC, l.id
  `).all(...params);

  const articuloIds = [...new Set(lineas.map(l => l.articulo_id))];
  const articulos = articuloIds.length ? db.prepare(`
    SELECT *, CASE WHEN stock <= stock_minimo THEN 1 ELSE 0 END AS stock_bajo
    FROM inventario_articulos WHERE id IN (${articuloIds.map(() => '?').join(',')}) ORDER BY nombre COLLATE NOCASE
  `).all(...articuloIds) : [];

  // Sin selección explícita (p.ej. el botón de Facturación): se auto-sugieren los artículos
  // con un mínimo definido (>0) y por debajo de él. Con selección explícita (modal "Pedir"),
  // se piden exactamente esos artículos, tengan o no un mínimo definido.
  const articulosPedir = pedirArticulos == null
    ? db.prepare(`SELECT * FROM inventario_articulos WHERE activo = 1 AND stock_minimo > 0 AND stock <= stock_minimo ORDER BY nombre COLLATE NOCASE`).all()
    : (pedirArticulos.length
        ? db.prepare(`SELECT * FROM inventario_articulos WHERE id IN (${pedirArticulos.map(() => '?').join(',')}) ORDER BY nombre COLLATE NOCASE`).all(...pedirArticulos)
        : []);

  const cliente = Number.isInteger(clienteId) && clienteId > 0 ? db.prepare(`SELECT nombre FROM clientes WHERE id = ?`).get(clienteId) : null;
  const cfg = getCfg();
  const nombre_taller = cfg.nombre_taller || 'Control de Equipos';
  const fmtRango = desde || hasta ? `${desde ? fmtFechaExp(desde) : '…'} — ${hasta ? fmtFechaExp(hasta) : '…'}` : 'Todas las fechas';

  const filasSalidas = lineas.length === 0 ? '<p class="empty">No hay movimientos de salida con estos filtros.</p>' : `
    <table><thead><tr><th>Fecha</th><th>Cliente</th>${paraCorreo ? '' : '<th>Referencia</th>'}<th>Artículo</th><th>Cantidad</th></tr></thead><tbody>
      ${lineas.map(l => `<tr>
        <td style="white-space:nowrap">${fmtFechaExp(l.fecha)}</td>
        <td>${escH(l.cliente) || 'Oficina Megas'}</td>
        ${paraCorreo ? '' : `<td>${escH(l.referencia) || '—'}</td>`}
        <td>${escH(l.articulo)}${l.codigo ? ` <span style="color:#94a0b4">(${escH(l.codigo)})</span>` : ''}</td>
        <td style="white-space:nowrap">${l.cantidad} ${escH(l.unidad)}</td>
      </tr>`).join('')}
    </tbody></table>`;

  const filasStock = articulos.length === 0 ? '<p class="empty">No hay artículos con movimientos en este periodo.</p>' : `
    <table><thead><tr><th>Artículo</th><th>Código</th><th>Stock actual</th><th>Stock mínimo</th></tr></thead><tbody>
      ${articulos.map(a => `<tr>
        <td>${escH(a.nombre)}</td>
        <td>${escH(a.codigo) || '—'}</td>
        <td style="white-space:nowrap">${a.stock} ${escH(a.unidad)}${a.stock_bajo ? ' <span class="badge bwarn">Bajo mínimo</span>' : ''}</td>
        <td style="white-space:nowrap">${a.stock_minimo} ${escH(a.unidad)}</td>
      </tr>`).join('')}
    </tbody></table>`;

  const cuerpo = `${paraCorreo ? '' : `
  <div class="rhead">
    <div class="rbrand"><img src="${logoSrc}" style="height:30px;width:auto;object-fit:contain;display:block;margin-bottom:5px" alt="Logo"><h1>${escH(nombre_taller)}</h1><p>Informe de movimientos de salida · ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
    <div class="rmeta"><strong>${cliente ? escH(cliente.nombre) : 'Todos los clientes'}</strong>${fmtRango}</div>
  </div>`}
  <div class="sec">
    <div class="sec-t">Movimientos de salida</div>
    ${filasSalidas}
  </div>
  <div class="sec">
    <div class="sec-t">Stock actual</div>
    ${filasStock}
  </div>${(pedir && pedir.trim()) || articulosPedir.length ? `
  <div class="sec">
    <div class="sec-t" style="font-size:12pt">Pedir</div>
    ${pedir && pedir.trim() ? `<p style="white-space:pre-line;font-size:12pt;line-height:1.6;margin:0">${escH(pedir.trim())}</p>` : ''}
    ${articulosPedir.length ? `
    <ul style="margin:${pedir && pedir.trim() ? '12px' : '0'} 0 0;padding-left:20px;font-size:12pt;line-height:1.7">
      ${articulosPedir.map(a => `<li><strong>${escH(a.nombre)}</strong> — stock actual ${a.stock} ${escH(a.unidad)}${a.stock_minimo > 0 ? ` (mínimo ${a.stock_minimo} ${escH(a.unidad)})` : ''}</li>`).join('')}
    </ul>` : ''}
  </div>` : ''}`;

  return { cuerpo, fmtRango, cliente };
}

const INFORME_SALIDAS_STYLE = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;color:#1a2033;background:#fff;line-height:1.45}
.report{max-width:210mm;margin:0 auto;padding:14mm 16mm 20mm}
.rhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid #2563eb}
.rbrand h1{font-size:15pt;color:#2563eb;font-weight:700}.rbrand p{font-size:8.5pt;color:#6b7280;margin-top:2px}
.rmeta{text-align:right;font-size:8.5pt;color:#6b7280}.rmeta strong{display:block;font-size:13pt;color:#1a2033;font-weight:700;margin-bottom:2px}
.sec{margin-bottom:20px}.sec-t{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#2563eb;padding-bottom:5px;border-bottom:1px solid #e5e8f0;margin-bottom:10px}
.stats{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}
.stat{background:#f5f7fb;border-radius:6px;padding:8px 14px;text-align:center}
.stat-n{font-size:15pt;font-weight:700;color:#2563eb;display:block;line-height:1}
.stat-n.warn{color:#d97706}
.stat-l{font-size:8pt;color:#6b7280;margin-top:2px}
.badge{display:inline-block;font-size:7.5pt;padding:2px 8px;border-radius:999px;font-weight:700}
.bok{background:#dcfce7;color:#15803d}.bwarn{background:#fee2e2;color:#b91c1c}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th{background:#f5f7fb;text-align:left;padding:5px 7px;font-size:7.5pt;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em}
td{padding:5px 7px;border-bottom:1px solid #f0f2f6;vertical-align:top}
tr:last-child td{border-bottom:none}
.empty{color:#94a0b4;font-size:8.5pt;font-style:italic;padding:2px 0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sec{page-break-inside:avoid}@page{margin:10mm 12mm;size:A4}}`;

function parseFiltrosInforme(q) {
  return {
    desde: q.desde || null,
    hasta: q.hasta || null,
    clienteId: q.cliente_id ? Number(q.cliente_id) : null,
    facturado: q.facturado === '1' ? 1 : q.facturado === '0' ? 0 : null,
    pedir: q.pedir || '',
    pedirArticulos: q.pedir_articulos != null
      ? String(q.pedir_articulos).split(',').map(s => Number(s.trim())).filter(n => Number.isInteger(n) && n > 0)
      : null,
  };
}

app.get('/api/inventario/facturacion/pdf', (req, res) => {
  const filtros = parseFiltrosInforme(req.query);
  const { cuerpo } = construirInformeSalidas({ ...filtros, logoSrc: '/logo.png' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe de salidas — Inventario</title>
<style>
${INFORME_SALIDAS_STYLE}
.no-print{max-width:210mm;margin:10px auto 0;padding:0 16mm;display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.no-print input{font:inherit;font-size:9pt;padding:7px 10px;border-radius:7px;border:1px solid #d7dce6;min-width:220px}
.no-print button{font:inherit;font-size:9pt;font-weight:600;padding:7px 14px;border-radius:7px;border:1px solid #d7dce6;background:#fff;color:#1a2033;cursor:pointer}
.no-print button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
#correo-estado{font-size:8.5pt;color:#6b7280;flex-basis:100%;text-align:right}
@media print{.no-print{display:none}}
</style></head><body>
<div class="no-print">
  <input type="text" id="correo-destino" placeholder="correo@destino.com otro@destino.com" style="min-width:280px">
  <button type="button" id="btn-enviar-correo">Enviar por correo</button>
  <button type="button" class="primary" onclick="window.print()">Imprimir / Guardar PDF</button>
  <span id="correo-estado"></span>
</div>
<div class="report">${cuerpo}</div>
<script>
document.getElementById('btn-enviar-correo').addEventListener('click', async () => {
  const input = document.getElementById('correo-destino');
  const estado = document.getElementById('correo-estado');
  const to = input.value.trim();
  if (!to) { estado.textContent = 'Escribe primero una dirección de correo.'; input.focus(); return; }
  estado.textContent = 'Enviando…';
  try {
    const params = new URLSearchParams(window.location.search);
    const res = await fetch('/api/inventario/informe/email?' + params.toString(), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'No se pudo enviar el correo');
    estado.textContent = 'Correo enviado a ' + to;
  } catch (err) { estado.textContent = 'Error: ' + err.message; }
});
</script>
</body></html>`);
});

app.post('/api/inventario/informe/email', async (req, res) => {
  const destinatarios = (req.body.to || '').trim().split(/[\s,]+/).filter(Boolean);
  if (!destinatarios.length) return res.status(400).json({ error: 'Falta la dirección de destino' });
  const cfg = getCfg();
  const transporter = crearTransporter(cfg);
  if (!transporter) return res.status(400).json({ error: 'SMTP no configurado. Contacta con el administrador.' });
  const from = getFromAddress(cfg);
  if (!from) return res.status(400).json({ error: 'Configura el campo "De" o el usuario SMTP con un email válido.' });
  const filtros = parseFiltrosInforme(req.query);
  const { cuerpo, fmtRango, cliente } = construirInformeSalidas({ ...filtros, logoSrc: 'cid:logo', paraCorreo: true });
  const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><style>${INFORME_SALIDAS_STYLE}</style></head><body><div class="report">${cuerpo}</div></body></html>`;
  try {
    await transporter.sendMail({
      from,
      to: destinatarios.join(', '),
      subject: `Informe de salidas de stock — ${cliente ? cliente.nombre + ' — ' : ''}${fmtRango}`,
      html,
      attachments: [{ filename: 'logo.png', path: path.join(__dirname, 'public', 'logo.png'), cid: 'logo' }],
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'No se pudo enviar el correo: ' + err.message }); }
});

// ---------- Envíos ----------

app.get('/api/envios', (req, res) => {
  const tipo = ['Envio', 'Devolucion'].includes(req.query.tipo) ? req.query.tipo : null;
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const where = ['1 = 1']; const params = [];
  if (tipo) { where.push('tipo = ?'); params.push(tipo); }
  if (desde) { where.push('fecha >= ?'); params.push(desde); }
  if (hasta) { where.push('fecha <= ?'); params.push(hasta); }
  const rows = db.prepare(`SELECT * FROM envios WHERE ${where.join(' AND ')} ORDER BY fecha DESC, id DESC LIMIT 300`).all(...params);
  res.json(rows);
});

app.post('/api/envios', (req, res) => {
  const { fecha, transportista, tipo, notas, numero_seguimiento } = req.body;
  if (!transportista || !String(transportista).trim()) return res.status(400).json({ error: 'Falta el transportista' });
  if (!['Envio', 'Devolucion'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  const usuario = getUsuarioFromReq(req)?.nombre || null;
  const info = db.prepare(`INSERT INTO envios (fecha, transportista, numero_seguimiento, tipo, notas, usuario) VALUES (?,?,?,?,?,?)`)
    .run(fecha || new Date().toISOString().slice(0, 10), String(transportista).trim(), (numero_seguimiento || '').trim() || null, tipo, notas || null, usuario);
  res.json(db.prepare(`SELECT * FROM envios WHERE id = ?`).get(info.lastInsertRowid));
});

app.put('/api/envios/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM envios WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Envío no encontrado' });
  const { fecha, transportista, tipo, notas, numero_seguimiento } = req.body;
  if (tipo && !['Envio', 'Devolucion'].includes(tipo)) return res.status(400).json({ error: 'Tipo inválido' });
  db.prepare(`UPDATE envios SET fecha = ?, transportista = ?, numero_seguimiento = ?, tipo = ?, notas = ? WHERE id = ?`).run(
    fecha || existing.fecha,
    transportista != null && String(transportista).trim() ? String(transportista).trim() : existing.transportista,
    numero_seguimiento !== undefined ? ((numero_seguimiento || '').trim() || null) : existing.numero_seguimiento,
    tipo || existing.tipo,
    notas !== undefined ? notas : existing.notas,
    req.params.id,
  );
  res.json(db.prepare(`SELECT * FROM envios WHERE id = ?`).get(req.params.id));
});

app.delete('/api/envios/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM envios WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Envío no encontrado' });
  res.json({ ok: true });
});

// ---------- Licencias de software por cliente ----------

app.get('/api/licencias', (req, res) => {
  const rows = db.prepare(`
    SELECT l.*, c.nombre AS cliente_nombre
    FROM licencias_clientes l
    JOIN clientes c ON c.id = l.cliente_id
    ORDER BY l.fecha DESC, l.id DESC
    LIMIT 500
  `).all();
  res.json(rows);
});

app.post('/api/licencias', (req, res) => {
  const { cliente_id, programa, numero_licencia, fecha } = req.body;
  const cliente = cliente_id ? db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(cliente_id) : null;
  if (!cliente) return res.status(400).json({ error: 'Selecciona un cliente' });
  if (!programa || !String(programa).trim()) return res.status(400).json({ error: 'Falta el programa' });
  const usuario = getUsuarioFromReq(req)?.nombre || null;
  const info = db.prepare(`INSERT INTO licencias_clientes (cliente_id, programa, numero_licencia, fecha, usuario) VALUES (?,?,?,?,?)`)
    .run(cliente.id, String(programa).trim(), (numero_licencia || '').trim() || null, fecha || new Date().toISOString().slice(0, 10), usuario);
  const row = db.prepare(`SELECT l.*, c.nombre AS cliente_nombre FROM licencias_clientes l JOIN clientes c ON c.id = l.cliente_id WHERE l.id = ?`).get(info.lastInsertRowid);
  res.json(row);
});

app.put('/api/licencias/:id', (req, res) => {
  const existing = db.prepare(`SELECT * FROM licencias_clientes WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Licencia no encontrada' });
  const { cliente_id, programa, numero_licencia, fecha } = req.body;
  let clienteIdFinal = existing.cliente_id;
  if (cliente_id !== undefined) {
    const cliente = db.prepare(`SELECT id FROM clientes WHERE id = ?`).get(cliente_id);
    if (!cliente) return res.status(400).json({ error: 'Selecciona un cliente' });
    clienteIdFinal = cliente.id;
  }
  db.prepare(`UPDATE licencias_clientes SET cliente_id = ?, programa = ?, numero_licencia = ?, fecha = ? WHERE id = ?`).run(
    clienteIdFinal,
    programa != null && String(programa).trim() ? String(programa).trim() : existing.programa,
    numero_licencia !== undefined ? ((numero_licencia || '').trim() || null) : existing.numero_licencia,
    fecha || existing.fecha,
    req.params.id,
  );
  const row = db.prepare(`SELECT l.*, c.nombre AS cliente_nombre FROM licencias_clientes l JOIN clientes c ON c.id = l.cliente_id WHERE l.id = ?`).get(req.params.id);
  res.json(row);
});

app.delete('/api/licencias/:id', (req, res) => {
  const info = db.prepare(`DELETE FROM licencias_clientes WHERE id = ?`).run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'Licencia no encontrada' });
  res.json({ ok: true });
});

app.get('/api/envios/informe/pdf', (req, res) => {
  const tipo = ['Envio', 'Devolucion'].includes(req.query.tipo) ? req.query.tipo : null;
  const desde = req.query.desde || null;
  const hasta = req.query.hasta || null;
  const where = ['1 = 1']; const params = [];
  if (tipo) { where.push('tipo = ?'); params.push(tipo); }
  if (desde) { where.push('fecha >= ?'); params.push(desde); }
  if (hasta) { where.push('fecha <= ?'); params.push(hasta); }
  const rows = db.prepare(`SELECT * FROM envios WHERE ${where.join(' AND ')} ORDER BY fecha DESC, id DESC`).all(...params);

  const cfg = getCfg();
  const nombre_taller = cfg.nombre_taller || 'Control de Equipos';
  const tituloTipo = tipo === 'Envio' ? 'Envíos' : tipo === 'Devolucion' ? 'Devoluciones' : 'Envíos y devoluciones';
  const fmtRango = desde || hasta ? `${desde ? fmtFechaExp(desde) : '…'} — ${hasta ? fmtFechaExp(hasta) : '…'}` : 'Todas las fechas';
  const totalEnvios = rows.filter(r => r.tipo === 'Envio').length;
  const totalDevol = rows.filter(r => r.tipo === 'Devolucion').length;

  const filas = rows.length === 0 ? '<p class="empty">No hay registros con estos filtros.</p>' : `
    <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Transportista</th><th>Nº seguimiento</th><th>Notas</th></tr></thead><tbody>
      ${rows.map(r => `<tr>
        <td style="white-space:nowrap">${fmtFechaExp(r.fecha)}</td>
        <td>${r.tipo === 'Envio' ? '<span class="badge bok">Envío</span>' : '<span class="badge bwarn">Devolución</span>'}</td>
        <td>${escH(r.transportista)}</td>
        <td>${escH(r.numero_seguimiento) || '—'}</td>
        <td>${escH(r.notas) || '—'}</td>
      </tr>`).join('')}
    </tbody></table>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe — ${escH(tituloTipo)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;color:#1a2033;background:#fff;line-height:1.45}
.report{max-width:210mm;margin:0 auto;padding:14mm 16mm 20mm}
.rhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid #2563eb}
.rbrand h1{font-size:15pt;color:#2563eb;font-weight:700}.rbrand p{font-size:8.5pt;color:#6b7280;margin-top:2px}
.rmeta{text-align:right;font-size:8.5pt;color:#6b7280}.rmeta strong{display:block;font-size:13pt;color:#1a2033;font-weight:700;margin-bottom:2px}
.sec{margin-bottom:20px}.sec-t{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#2563eb;padding-bottom:5px;border-bottom:1px solid #e5e8f0;margin-bottom:10px}
.stats{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}
.stat{background:#f5f7fb;border-radius:6px;padding:8px 14px;text-align:center}
.stat-n{font-size:15pt;font-weight:700;color:#2563eb;display:block;line-height:1}
.stat-l{font-size:8pt;color:#6b7280;margin-top:2px}
.badge{display:inline-block;font-size:7.5pt;padding:2px 8px;border-radius:999px;font-weight:700}
.bok{background:#dcfce7;color:#15803d}.bwarn{background:#fee2e2;color:#b91c1c}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th{background:#f5f7fb;text-align:left;padding:5px 7px;font-size:7.5pt;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em}
td{padding:5px 7px;border-bottom:1px solid #f0f2f6;vertical-align:top}
tr:last-child td{border-bottom:none}
.empty{color:#94a0b4;font-size:8.5pt;font-style:italic;padding:2px 0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.sec{page-break-inside:avoid}@page{margin:10mm 12mm;size:A4}}
</style></head><body>
<div class="report">
  <div class="rhead">
    <div class="rbrand"><img src="/logo.png" style="height:30px;width:auto;object-fit:contain;display:block;margin-bottom:5px" alt="Logo"><h1>${escH(nombre_taller)}</h1><p>Informe de ${escH(tituloTipo.toLowerCase())} · ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
    <div class="rmeta"><strong>${escH(tituloTipo)}</strong>${fmtRango}</div>
  </div>
  <div class="sec">
    <div class="sec-t">Resumen</div>
    <div class="stats">
      <div class="stat"><span class="stat-n">${rows.length}</span><span class="stat-l">Total</span></div>
      <div class="stat"><span class="stat-n">${totalEnvios}</span><span class="stat-l">Envíos</span></div>
      <div class="stat"><span class="stat-n">${totalDevol}</span><span class="stat-l">Devoluciones</span></div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-t">Detalle</div>
    ${filas}
  </div>
</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
</body></html>`);
});

// ---------- Configuración ----------

app.get('/api/config', (req, res) => {
  const rows = db.prepare('SELECT clave, valor FROM configuracion').all();
  const config = {};
  rows.forEach(r => config[r.clave] = r.valor);
  res.json(config);
});

app.put('/api/config', requireAdmin, (req, res) => {
  const stmt = db.prepare('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)');
  Object.entries(req.body).forEach(([k, v]) => stmt.run(k, String(v)));
  res.json({ ok: true });
});

// ---------- Etiqueta de envío ----------

app.get('/api/clientes/:id/etiqueta-envio', (req, res) => {
  try {
  const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
  if (!cliente) return res.status(404).send('No encontrado');
  const cfgRows = db.prepare('SELECT clave, valor FROM configuracion').all();
  const cfg = {};
  cfgRows.forEach(r => cfg[r.clave] = r.valor);

  const conRetorno = req.query.retorno === '1';
  const fraOrig  = escH(cfg.fra_orig || '');
  const numCli   = escH(cfg.cli || '');
  const nombre   = escH(cliente.nombre);
  const dir      = escH(cliente.direccion || '');
  const cpCiudad = [cliente.cp, cliente.ciudad].filter(Boolean).map(escH).join(' ');
  const provincia = escH(cliente.provincia || '');
  const tel      = escH(cliente.telefono || '');

  const linea1 = [fraOrig ? `Fra.Orig: ${fraOrig}` : '', numCli ? `Cli: ${numCli}` : ''].filter(Boolean).join('&nbsp;&nbsp;&nbsp;');

  const bloqueRetorno = conRetorno ? `<hr class="sep"><div class="retorno">CON RETORNO</div>` : '';

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="es"><head>
<meta charset="UTF-8">
<title>Envío ${nombre}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
@page { size: 80mm auto; margin: 3mm 3mm; }
body { font-family: Arial, Helvetica, sans-serif; color: #000; -webkit-font-smoothing: none; font-smoothing: none; }
.nombre { font-size:13pt; font-weight:900; line-height:1.15; margin-bottom:1mm; }
.dir { font-size:9pt; font-weight:700; line-height:1.6; }
.sep { border:none; border-top:2px solid #000; margin:2.5mm 0; }
.codigos { font-size:8pt; font-weight:900; line-height:1.5; }
.retorno {
  font-size:13pt; font-weight:900; text-align:center; letter-spacing:0.08em;
  border:2px solid #000; padding:1.5mm 0; margin:1.5mm 0;
  text-transform:uppercase;
}
@media print { * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
@media screen { body{padding:10px;} }
</style>
</head><body>
<div class="nombre">${nombre}</div>
<div class="dir">
  ${dir ? `${dir}<br>` : ''}
  ${cpCiudad ? `${cpCiudad}<br>` : ''}
  ${provincia ? `${provincia}<br>` : ''}
  ${tel ? `Tel: ${tel}` : ''}
</div>
${linea1 ? `<hr class="sep"><div class="codigos">${linea1}</div>` : ''}
${bloqueRetorno}
<script>if(!window.matchMedia('print').matches){ window.onload=()=>{ window.print(); window.onafterprint=()=>window.close(); }; }</script>
</body></html>`);
  } catch (err) {
    res.status(500).send(resetBox('Error', '#ef4444', `<h2>Error al generar etiqueta</h2><p>${escH(err.message)}</p>`));
  }
});

// ---------- Informe de dispositivo (cliente) ----------

app.get('/api/equipos/:id/informe-dispositivo', (req, res) => {
  try {
    const eq = db.prepare(`SELECT e.*, c.nombre as cliente_nombre, c.telefono as cliente_tel, c.email as cliente_email FROM equipos e LEFT JOIN clientes c ON c.id = e.cliente_id WHERE e.id = ?`).get(req.params.id);
    if (!eq) return res.status(404).send('No encontrado');
    const cfg = getCfg();
    const nombre_taller = cfg.nombre_taller || 'Control de Equipos';
    const historial = db.prepare(`SELECT * FROM historial WHERE equipo_id = ? ORDER BY fecha DESC, id DESC`).all(eq.id);
    const tickets = db.prepare(`SELECT * FROM tickets WHERE equipo_id = ? ORDER BY creado_en ASC`).all(eq.id);
    const incluirComponentes = !!req.query.componentes;
    const componentes = incluirComponentes ? db.prepare(`SELECT tipo, descripcion, numero_serie, creado_en FROM componentes WHERE equipo_id = ? ORDER BY id`).all(eq.id) : [];

    const fmtF = d => {
      if (!d) return '—';
      const [y, m, dd] = d.split('-');
      return `${dd}/${m}/${y}`;
    };

    const COLORES_TK = {
      'Pendiente':'#94a3b8','Diagnóstico':'#3b82f6','En reparación':'#f59e0b',
      'Esperando piezas':'#a855f7','Listo':'#22c55e','Entregado':'#10b981','Cerrado':'#64748b'
    };

    const filaHist = h => {
      const partes = [];
      if (h.problema_reportado) partes.push(`<b>Problema:</b> ${escH(h.problema_reportado)}`);
      partes.push(`<b>Trabajo:</b> ${escH(h.descripcion)}`);
      if (h.tecnico) partes.push(`<b>Técnico:</b> ${escH(h.tecnico)}`);
      if (h.coste != null) partes.push(`<b>Coste:</b> ${Number(h.coste).toFixed(2)} €`);
      return `<tr><td style="white-space:nowrap">${fmtF(h.fecha)}</td><td>${escH(h.tipo)}</td><td>${partes.join('<br>')}</td></tr>`;
    };

    const filaTicket = t => {
      const activo = !['Entregado','Cerrado'].includes(t.estado);
      const col = COLORES_TK[t.estado] || '#94a3b8';
      const estadoPill = `<span style="display:inline-block;font-size:7pt;font-weight:700;padding:1px 7px;border-radius:999px;background:${col}20;color:${pillTextColor(col)};border:1px solid ${col}55">${escH(t.estado)}</span>`;
      const partes = [];
      if (t.descripcion) partes.push(`<b>Problema:</b> ${escH(t.descripcion)}`);
      if (t.solucion)    partes.push(`<b>Solución:</b> ${escH(t.solucion)}`);
      if (t.tecnico_asignado) partes.push(`<b>Técnico:</b> ${escH(t.tecnico_asignado)}`);
      if (t.coste != null) partes.push(`<b>Coste:</b> ${Number(t.coste).toFixed(2)} €`);
      const rowStyle = activo ? ' style="background:#fffbeb"' : '';
      return `<tr${rowStyle}><td style="font-family:monospace;white-space:nowrap">${escH(t.numero)}</td><td style="white-space:nowrap">${fmtF(t.fecha_entrada)}</td><td>${estadoPill}</td><td style="white-space:nowrap">${fmtF(t.fecha_estimada)}</td><td style="white-space:nowrap">${fmtF(t.fecha_entrega)}</td><td>${partes.join('<br>')}</td></tr>`;
    };

    const tablaHist = historial.length === 0 ? '<p class="vacio">Sin intervenciones registradas.</p>' : `
      <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th></tr></thead>
      <tbody>${historial.map(filaHist).join('')}</tbody></table>`;

    const tablaTickets = `<h2>Tickets (${tickets.length})</h2>
      ${tickets.length === 0
        ? '<p class="vacio">Sin tickets registrados.</p>'
        : `<table><thead><tr><th>N.º</th><th>Entrada</th><th>Estado</th><th>Estimado</th><th>Entrega</th><th>Detalle</th></tr></thead>
           <tbody>${tickets.map(filaTicket).join('')}</tbody></table>`}`;

    const hoy = new Date().toLocaleDateString('es-ES');
    const datosEquipo = [
      ['Dispositivo', eq.nombre],
      ['Tipo', eq.tipo],
      eq.numero_serie    ? ['N.º de serie',       eq.numero_serie]       : null,
      eq.cliente_nombre  ? ['Cliente',             eq.cliente_nombre]     : null,
      eq.fecha_entrega   ? ['Fecha de recepción',  fmtF(eq.fecha_entrega)]: null,
    ].filter(Boolean).map(([k, v]) => `<tr><td class="dk">${k}</td><td>${escH(v)}</td></tr>`).join('');

    const tieneBateria = TIPOS_CON_BATERIA.has(eq.tipo) && (
      eq.bateria_tipo || eq.bateria_cap_origen != null || eq.bateria_cap_actual != null ||
      eq.bateria_vida_pct != null || eq.bateria_descarga_mw != null || eq.bateria_ciclos != null);

    const datosBateria = tieneBateria ? [
      eq.bateria_tipo        ? ['Tipo de batería',          eq.bateria_tipo]                     : null,
      eq.bateria_cap_origen  != null ? ['Cap. máx. origen', eq.bateria_cap_origen + ' mWh']      : null,
      eq.bateria_cap_actual  != null ? ['Cap. máx. actual', eq.bateria_cap_actual + ' mWh']      : null,
      eq.bateria_vida_pct    != null ? ['Vida de batería',  eq.bateria_vida_pct + ' %']          : null,
      eq.bateria_descarga_mw != null ? ['Vel. descarga',    eq.bateria_descarga_mw + ' mW']      : null,
      eq.bateria_ciclos      != null ? ['Ciclos carga/desc',String(eq.bateria_ciclos)]            : null,
    ].filter(Boolean).map(([k, v]) => `<tr><td class="dk">${k}</td><td>${escH(v)}</td></tr>`).join('') : '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<title>Informe — ${escH(eq.nombre)}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
@page{size:A4;margin:18mm 16mm}
body{font-family:Arial,Helvetica,sans-serif;font-size:9pt;color:#000;background:#fff;padding:20px}
@media print{body{padding:0}}
header{border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:14px}
header h1{font-size:13pt;font-weight:900}
header p{font-size:8pt;margin-top:2px}
h2{font-size:9pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #000;padding-bottom:3px;margin:14px 0 6px}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th{text-align:left;border-bottom:1px solid #000;padding:3px 6px;font-size:7.5pt;text-transform:uppercase;letter-spacing:.04em}
td{padding:4px 6px;border-bottom:1px solid #ccc;vertical-align:top}
.dk{font-weight:700;width:120px}
.vacio{font-style:italic;color:#555;font-size:8.5pt;margin:4px 0}
footer{margin-top:18px;font-size:7.5pt;color:#555;border-top:1px solid #ccc;padding-top:6px;text-align:right}
</style></head><body>
<header>
  <div style="display:flex;align-items:center;gap:12px">
    <img src="/logo.png" style="height:34px;width:auto;object-fit:contain" alt="Logo">
    <div>
      <h1>${escH(nombre_taller)}</h1>
      <p>Informe de dispositivo &mdash; ${hoy}</p>
    </div>
  </div>
</header>
<h2>Datos del equipo</h2>
<table><tbody>${datosEquipo}</tbody></table>
${tieneBateria ? `<h2>Estado de la batería</h2><table><tbody>${datosBateria}</tbody></table>` : ''}
${incluirComponentes ? `<h2>Componentes</h2>
${componentes.length === 0
  ? '<p class="vacio">Sin componentes registrados.</p>'
  : `<table><thead><tr><th>Componente</th><th>Descripción</th><th>N.º de serie</th></tr></thead><tbody>
${componentes.map(c => `<tr><td>${escH(c.tipo)}</td><td>${escH(c.descripcion) || '—'}</td><td>${escH(c.numero_serie) || '—'}</td></tr>`).join('')}
</tbody></table>`}` : ''}
${tablaTickets}
<h2>Historial de intervenciones (${historial.length})</h2>
${tablaHist}
<footer>Documento generado el ${hoy} &mdash; ${escH(nombre_taller)}</footer>
<script>window.onload=()=>window.print();</script>
</body></html>`);
  } catch (err) {
    res.status(500).send(resetBox('Error', '#ef4444', `<h2>Error al generar informe</h2><p>${escH(err.message)}</p>`));
  }
});

// ---------- Exportar ----------

function getDatosCliente(clienteId) {
  const cliente = db.prepare(`SELECT * FROM clientes WHERE id = ?`).get(clienteId);
  if (!cliente) return null;
  const equipos = db.prepare(`SELECT * FROM equipos WHERE cliente_id = ? ORDER BY creado_en DESC`).all(clienteId);
  return { cliente, equipos: equipos.map(enrichEquipo) };
}

function textoGarantiaExport(fechaEntrega, mesesGarantia) {
  if (!fechaEntrega || !mesesGarantia) return 'Sin datos';
  const [y, m, d] = fechaEntrega.split('-').map(Number);
  const fin = new Date(y, m - 1 + Number(mesesGarantia), d);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const finStr = fin.toLocaleDateString('es-ES');
  return fin >= hoy ? `En garantía hasta ${finStr}` : `Caducada (${finStr})`;
}

function fmtFechaExp(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function fmtTamanoExp(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function escH(s) {
  if (s == null) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generarHtmlInforme({ cliente, equipos }) {
  const cfg = getCfg();
  const nombre_taller = cfg.nombre_taller || 'Control de Equipos';
  const totalComp   = equipos.reduce((s, e) => s + e.componentes.length, 0);
  const totalInterv = equipos.reduce((s, e) => s + e.historial.length, 0);
  const totalArch   = equipos.reduce((s, e) => s + e.archivos.length, 0);
  const totalTk     = equipos.reduce((s, e) => s + (e.tickets || []).length, 0);
  const tkActivos   = equipos.reduce((s, e) => s + (e.tickets || []).filter(t => !['Entregado','Cerrado'].includes(t.estado)).length, 0);

  const COLORES_ESTADO = {
    'Pendiente':'#94a3b8','Diagnóstico':'#3b82f6','En reparación':'#f59e0b',
    'Esperando piezas':'#a855f7','Listo':'#22c55e','Entregado':'#10b981','Cerrado':'#64748b'
  };
  function tkEstiloEstado(estado) {
    const c = COLORES_ESTADO[estado] || '#94a3b8';
    return `background:${c}20;color:${pillTextColor(c)};border:1px solid ${c}55;display:inline-block;font-size:7pt;font-weight:700;padding:1px 7px;border-radius:999px`;
  }

  const equiposHtml = equipos.map(eq => {
    const garantia = textoGarantiaExport(eq.fecha_entrega, eq.meses_garantia);
    const vencida = garantia.startsWith('Caducada');

    const compHtml = eq.componentes.length === 0
      ? '<p class="empty">Sin componentes.</p>'
      : `<table><thead><tr><th>Componente</th><th>Descripción</th><th>N/S</th><th>Añadido</th></tr></thead><tbody>
          ${eq.componentes.map(c => `<tr><td>${escH(c.tipo)}</td><td>${escH(c.descripcion) || '—'}</td><td>${escH(c.numero_serie) || '—'}</td><td style="white-space:nowrap">${c.creado_en ? c.creado_en.slice(0,10).split('-').reverse().join('/') : '—'}</td></tr>`).join('')}
         </tbody></table>`;

    const histHtml = eq.historial.length === 0
      ? '<p class="empty">Sin intervenciones.</p>'
      : `<table><thead><tr><th>Fecha</th><th>Tipo</th><th>Problema</th><th>Trabajo realizado</th><th>Técnico</th><th>Coste</th><th>Próx. revisión</th></tr></thead><tbody>
          ${eq.historial.map(h => `<tr>
            <td style="white-space:nowrap">${fmtFechaExp(h.fecha)}</td>
            <td>${escH(h.tipo)}</td>
            <td>${escH(h.problema_reportado) || '—'}</td>
            <td>${escH(h.descripcion)}</td>
            <td>${escH(h.tecnico) || '—'}</td>
            <td style="white-space:nowrap">${h.coste != null ? Number(h.coste).toFixed(2) + ' €' : '—'}</td>
            <td style="white-space:nowrap">${fmtFechaExp(h.proxima_revision) || '—'}</td>
          </tr>`).join('')}
         </tbody></table>`;

    const tickets = eq.tickets || [];
    const tkHtml = tickets.length === 0
      ? '<p class="empty">Sin tickets.</p>'
      : `<table><thead><tr><th>Nº</th><th>Estado</th><th>Descripción</th><th>Técnico</th><th>Entrada</th><th>Estimado</th><th>Entrega</th><th>Coste</th></tr></thead><tbody>
          ${tickets.map(t => `<tr>
            <td style="font-family:monospace;white-space:nowrap">${escH(t.numero)}</td>
            <td><span style="${tkEstiloEstado(t.estado)}">${escH(t.estado)}</span></td>
            <td>${escH(t.descripcion) || '—'}</td>
            <td>${escH(t.tecnico_asignado) || '—'}</td>
            <td style="white-space:nowrap">${fmtFechaExp(t.fecha_entrada) || '—'}</td>
            <td style="white-space:nowrap">${fmtFechaExp(t.fecha_estimada) || '—'}</td>
            <td style="white-space:nowrap">${fmtFechaExp(t.fecha_entrega) || '—'}</td>
            <td style="white-space:nowrap">${t.coste != null ? Number(t.coste).toFixed(2) + ' €' : '—'}</td>
          </tr>`).join('')}
         </tbody></table>`;

    const archHtml = eq.archivos.length === 0 ? '' :
      `<div class="sub"><div class="sub-t">Archivos adjuntos (${eq.archivos.length})</div>
       <table><thead><tr><th>Nombre</th><th>Categoría</th><th>Descripción</th><th>Tamaño</th></tr></thead><tbody>
         ${eq.archivos.map(a => `<tr><td>${escH(a.nombre_original)}</td><td>${escH(a.categoria)}</td><td>${escH(a.descripcion) || '—'}</td><td>${fmtTamanoExp(a.tamano)}</td></tr>`).join('')}
       </tbody></table></div>`;

    return `<div class="ecard">
      <div class="ehead">
        <div><span class="enombre">${escH(eq.nombre)}</span><span class="etipo">${escH(eq.tipo)}</span></div>
        <div>
          <span class="badge ${vencida ? 'bwarn' : 'bok'}">${garantia}</span>
          ${eq.mantenimiento ? '<span class="badge bok" style="margin-left:4px">Con mantenimiento</span>' : ''}
          ${tickets.filter(t => !['Entregado','Cerrado'].includes(t.estado)).length > 0
            ? `<span class="badge bwarn" style="margin-left:4px">Ticket activo</span>` : ''}
        </div>
      </div>
      <div class="emeta">N/S: ${escH(eq.numero_serie) || '—'} · Entrega: ${fmtFechaExp(eq.fecha_entrega) || '—'} · Garantía: ${eq.meses_garantia} meses${eq.tipo === 'Tablet' ? ' · Cargador: ' + (eq.tiene_cargador ? 'Sí' : 'No') + ' · Teclado: ' + (eq.tiene_teclado ? 'Sí' : 'No') : ''}</div>
      ${eq.notas ? `<div class="enotas">${escH(eq.notas)}</div>` : ''}
      <div class="sub"><div class="sub-t">Tickets (${tickets.length})</div>${tkHtml}</div>
      <div class="sub"><div class="sub-t">Componentes (${eq.componentes.length})</div>${compHtml}</div>
      <div class="sub"><div class="sub-t">Historial de intervenciones (${eq.historial.length})</div>${histHtml}</div>
      ${archHtml}
    </div>`;
  }).join('');

  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Informe — ${escH(cliente.nombre)}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:10pt;color:#1a2033;background:#fff;line-height:1.45}
.report{max-width:210mm;margin:0 auto;padding:14mm 16mm 20mm}
.rhead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;padding-bottom:12px;border-bottom:2px solid #2563eb}
.rbrand h1{font-size:15pt;color:#2563eb;font-weight:700}.rbrand p{font-size:8.5pt;color:#6b7280;margin-top:2px}
.rmeta{text-align:right;font-size:8.5pt;color:#6b7280}.rmeta strong{display:block;font-size:13pt;color:#1a2033;font-weight:700;margin-bottom:2px}
.sec{margin-bottom:20px}.sec-t{font-size:8.5pt;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#2563eb;padding-bottom:5px;border-bottom:1px solid #e5e8f0;margin-bottom:10px}
.cgrid{display:grid;grid-template-columns:auto 1fr;gap:3px 16px;font-size:9.5pt}
.clabel{font-weight:700;color:#6b7280;white-space:nowrap}
.stats{display:flex;gap:12px;margin-top:10px;flex-wrap:wrap}
.stat{background:#f5f7fb;border-radius:6px;padding:8px 14px;text-align:center}
.stat-n{font-size:15pt;font-weight:700;color:#2563eb;display:block;line-height:1}
.stat-n.warn{color:#d97706}
.stat-l{font-size:8pt;color:#6b7280;margin-top:2px}
.ecard{border:1px solid #e5e8f0;border-radius:8px;padding:12px 14px;margin-bottom:14px}
.ehead{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px;flex-wrap:wrap;gap:6px}
.enombre{font-size:11pt;font-weight:700}
.etipo{display:inline-block;font-size:7.5pt;font-weight:700;text-transform:uppercase;background:#eaf0ff;color:#1e3a8a;padding:2px 7px;border-radius:999px;margin-left:7px;vertical-align:middle}
.emeta{font-size:8.5pt;color:#6b7280;margin-bottom:4px}
.enotas{background:#fffbeb;border:1px solid #fde68a;padding:5px 9px;border-radius:5px;font-size:8.5pt;margin:5px 0}
.badge{display:inline-block;font-size:7.5pt;padding:2px 8px;border-radius:999px;font-weight:700}
.bok{background:#dcfce7;color:#15803d}.bwarn{background:#fee2e2;color:#b91c1c}
.sub{margin-top:10px}.sub-t{font-size:8pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#94a0b4;margin-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:8.5pt}
th{background:#f5f7fb;text-align:left;padding:5px 7px;font-size:7.5pt;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.03em}
td{padding:5px 7px;border-bottom:1px solid #f0f2f6;vertical-align:top}
tr:last-child td{border-bottom:none}
.empty{color:#94a0b4;font-size:8.5pt;font-style:italic;padding:2px 0}
@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.ecard{page-break-inside:avoid}@page{margin:10mm 12mm;size:A4}}
</style></head><body>
<div class="report">
  <div class="rhead">
    <div class="rbrand"><img src="/logo.png" style="height:30px;width:auto;object-fit:contain;display:block;margin-bottom:5px" alt="Logo"><h1>${escH(nombre_taller)}</h1><p>Informe de cliente · ${new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })}</p></div>
    <div class="rmeta"><strong>${escH(cliente.nombre)}</strong>${escH(cliente.telefono) || ''}${cliente.telefono && cliente.email ? ' · ' : ''}${escH(cliente.email) || ''}</div>
  </div>
  <div class="sec">
    <div class="sec-t">Datos del cliente</div>
    <div class="cgrid">
      ${cliente.telefono ? `<span class="clabel">Teléfono</span><span>${escH(cliente.telefono)}</span>` : ''}
      ${cliente.email ? `<span class="clabel">Email</span><span>${escH(cliente.email)}</span>` : ''}
      ${cliente.direccion ? `<span class="clabel">Dirección</span><span>${escH(cliente.direccion)}</span>` : ''}
      ${cliente.notas ? `<span class="clabel">Notas</span><span>${escH(cliente.notas)}</span>` : ''}
    </div>
    <div class="stats">
      <div class="stat"><span class="stat-n">${equipos.length}</span><span class="stat-l">Equipos</span></div>
      <div class="stat"><span class="stat-n">${totalComp}</span><span class="stat-l">Componentes</span></div>
      <div class="stat"><span class="stat-n">${totalInterv}</span><span class="stat-l">Intervenciones</span></div>
      <div class="stat"><span class="stat-n ${tkActivos > 0 ? 'warn' : ''}">${totalTk}</span><span class="stat-l">Tickets${tkActivos > 0 ? ` (${tkActivos} activos)` : ''}</span></div>
      <div class="stat"><span class="stat-n">${totalArch}</span><span class="stat-l">Archivos</span></div>
    </div>
  </div>
  <div class="sec">
    <div class="sec-t">Equipos (${equipos.length})</div>
    ${equipos.length === 0 ? '<p class="empty">Sin equipos registrados.</p>' : equiposHtml}
  </div>
</div>
<script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));</script>
</body></html>`;
}

app.get('/api/clientes/:id/exportar/pdf', (req, res) => {
  const datos = getDatosCliente(req.params.id);
  if (!datos) return res.status(404).json({ error: 'Cliente no encontrado' });
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(generarHtmlInforme(datos));
});

app.get('/api/clientes/:id/exportar/excel', async (req, res) => {
  const datos = getDatosCliente(req.params.id);
  if (!datos) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { cliente, equipos } = datos;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'ControlEquipos'; wb.created = new Date();
  const estHead = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } } };
  const fijaHead = sh => { const r = sh.getRow(1); r.eachCell(c => Object.assign(c, estHead)); r.height = 18; r.commit(); };

  const shCli = wb.addWorksheet('Cliente');
  shCli.getColumn(1).width = 22; shCli.getColumn(2).width = 42;
  [['Campo','Valor'],['Nombre',cliente.nombre],['Teléfono',cliente.telefono||''],['Email',cliente.email||''],
   ['Dirección',cliente.direccion||''],['Notas',cliente.notas||''],['Alta',cliente.creado_en],['',''],
   ['Equipos',equipos.length],['Componentes',equipos.reduce((s,e)=>s+e.componentes.length,0)],
   ['Intervenciones',equipos.reduce((s,e)=>s+e.historial.length,0)],['Archivos',equipos.reduce((s,e)=>s+e.archivos.length,0)],
  ].forEach(row => shCli.addRow(row));
  fijaHead(shCli);

  const shEq = wb.addWorksheet('Equipos');
  shEq.columns = [
    {header:'Nombre',key:'nombre',width:28},{header:'Tipo',key:'tipo',width:14},{header:'N/S',key:'ns',width:22},
    {header:'Fecha entrega',key:'fent',width:14},{header:'Garantía (meses)',key:'mgar',width:17},
    {header:'Estado garantía',key:'egar',width:35},{header:'Mantenimiento',key:'mant',width:15},
    {header:'Cargador',key:'carg',width:12},{header:'Teclado',key:'tecl',width:12},{header:'Notas',key:'notas',width:40},
  ];
  equipos.forEach(eq => shEq.addRow({
    nombre:eq.nombre,tipo:eq.tipo,ns:eq.numero_serie||'',fent:fmtFechaExp(eq.fecha_entrega),mgar:eq.meses_garantia,
    egar:textoGarantiaExport(eq.fecha_entrega,eq.meses_garantia),mant:eq.mantenimiento?'Sí':'No',
    carg:eq.tipo==='Tablet'?(eq.tiene_cargador?'Sí':'No'):'',
    tecl:eq.tipo==='Tablet'?(eq.tiene_teclado?'Sí':'No'):'',notas:eq.notas||'',
  }));
  fijaHead(shEq);

  const shComp = wb.addWorksheet('Componentes');
  shComp.columns = [{header:'Equipo',key:'eq',width:28},{header:'Tipo',key:'tipo',width:22},{header:'Descripción',key:'desc',width:32},{header:'N/S',key:'ns',width:22}];
  equipos.forEach(eq => eq.componentes.forEach(c => shComp.addRow({eq:eq.nombre,tipo:c.tipo,desc:c.descripcion||'',ns:c.numero_serie||''})));
  fijaHead(shComp);

  const shHist = wb.addWorksheet('Historial');
  shHist.columns = [
    {header:'Equipo',key:'eq',width:28},{header:'N/S',key:'ns',width:20},{header:'Fecha',key:'fecha',width:12},{header:'Tipo',key:'tipo',width:26},
    {header:'Problema reportado',key:'prob',width:40},{header:'Trabajo realizado',key:'desc',width:52},
    {header:'Técnico',key:'tec',width:20},{header:'Coste (€)',key:'coste',width:12},{header:'Próx. revisión',key:'prox',width:15},
  ];
  equipos.forEach(eq => eq.historial.forEach(h => shHist.addRow({
    eq:eq.nombre,ns:eq.numero_serie||'',fecha:fmtFechaExp(h.fecha),tipo:h.tipo,prob:h.problema_reportado||'',
    desc:h.descripcion,tec:h.tecnico||'',coste:h.coste??'',prox:fmtFechaExp(h.proxima_revision),
  })));
  fijaHead(shHist);

  const shArch = wb.addWorksheet('Archivos');
  shArch.columns = [
    {header:'Equipo',key:'eq',width:28},{header:'Nombre archivo',key:'nombre',width:42},
    {header:'Categoría',key:'cat',width:16},{header:'Descripción',key:'desc',width:32},
    {header:'Tamaño',key:'tam',width:12},{header:'Fecha',key:'fecha',width:20},
  ];
  equipos.forEach(eq => eq.archivos.forEach(a => shArch.addRow({
    eq:eq.nombre,nombre:a.nombre_original,cat:a.categoria,desc:a.descripcion||'',tam:fmtTamanoExp(a.tamano),fecha:a.creado_en,
  })));
  fijaHead(shArch);

  const shTk = wb.addWorksheet('Tickets');
  shTk.columns = [
    {header:'Nº Ticket',key:'num',width:14},{header:'Equipo',key:'eq',width:28},{header:'Estado',key:'estado',width:20},
    {header:'Descripción',key:'desc',width:40},{header:'Técnico',key:'tec',width:20},
    {header:'F. entrada',key:'entrada',width:13},{header:'F. estimada',key:'estimada',width:13},
    {header:'F. entrega',key:'entrega',width:13},{header:'Coste (€)',key:'coste',width:12},{header:'Solución',key:'sol',width:40},
  ];
  equipos.forEach(eq => (eq.tickets || []).forEach(t => shTk.addRow({
    num:t.numero,eq:eq.nombre,estado:t.estado,desc:t.descripcion||'',tec:t.tecnico_asignado||'',
    entrada:fmtFechaExp(t.fecha_entrada),estimada:fmtFechaExp(t.fecha_estimada),entrega:fmtFechaExp(t.fecha_entrega),
    coste:t.coste??'',sol:t.solucion||'',
  })));
  fijaHead(shTk);

  const nombreXlsx = `${cliente.nombre.replace(/[^\w\s-]/gi,'_').trim()}_${new Date().toISOString().slice(0,10)}.xlsx`;
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(nombreXlsx)}`);
  await wb.xlsx.write(res);
  res.end();
});

app.get('/api/clientes/:id/exportar/csv', (req, res) => {
  const datos = getDatosCliente(req.params.id);
  if (!datos) return res.status(404).json({ error: 'Cliente no encontrado' });
  const { cliente, equipos } = datos;
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return (s.includes(';')||s.includes('"')||s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const rows = [['Cliente','Equipo','Tipo_Equipo','N_Serie','Fecha_Entrega','Estado_Garantia','Mantenimiento','Fecha_Intervencion','Tipo_Intervencion','Problema_Reportado','Trabajo_Realizado','Tecnico','Coste_EUR','Proxima_Revision'].join(';')];
  equipos.forEach(eq => {
    const base = [cliente.nombre,eq.nombre,eq.tipo,eq.numero_serie||'',fmtFechaExp(eq.fecha_entrega),textoGarantiaExport(eq.fecha_entrega,eq.meses_garantia),eq.mantenimiento?'Sí':'No'];
    if (eq.historial.length === 0) {
      rows.push([...base,'','','','','','',''].map(esc).join(';'));
    } else {
      eq.historial.forEach(h => rows.push([...base,fmtFechaExp(h.fecha),h.tipo,h.problema_reportado||'',h.descripcion,h.tecnico||'',h.coste??'',fmtFechaExp(h.proxima_revision)].map(esc).join(';')));
    }
  });
  const nombreCsv = `${cliente.nombre.replace(/[^\w\s-]/gi,'_').trim()}_${new Date().toISOString().slice(0,10)}.csv`;
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(nombreCsv)}`);
  res.send('﻿' + rows.join('\r\n'));
});

// Respuestas JSON consistentes para errores no controlados y rutas API inexistentes.
app.use('/api', (err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(`[API ${req.method} ${req.path}]`, err);
  res.status(err.statusCode || 500).json({ error: err.message || 'Error interno del servidor' });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta API no encontrada' }));

app.listen(PORT, '0.0.0.0', () => {
  const os = require('os');
  const nets = os.networkInterfaces();
  console.log(`\nControlEquipos escuchando en el puerto ${PORT}`);
  console.log(`  Local:  http://localhost:${PORT}`);
  Object.values(nets).flat().forEach(net => {
    if (net.family === 'IPv4' && !net.internal) console.log(`  Red:    http://${net.address}:${PORT}`);
  });
  console.log('');
});

function cerrarServidor(signal) {
  console.log(`\n${signal}: cerrando ControlEquipos...`);
  db.close();
  process.exit(0);
}

process.once('SIGINT', () => cerrarServidor('SIGINT'));
process.once('SIGTERM', () => cerrarServidor('SIGTERM'));
