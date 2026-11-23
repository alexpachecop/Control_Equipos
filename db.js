/**
 * db.js — Capa de datos (better-sqlite3, SQLite síncrono)
 * ======================================================
 * El esquema se crea con `CREATE TABLE IF NOT EXISTS` al arrancar, y las
 * migraciones posteriores (columnas nuevas en una tabla ya existente) se
 * aplican con `PRAGMA table_info(...)` + `ALTER TABLE ... ADD COLUMN`
 * protegido por una comprobación de que la columna no exista ya. Esto
 * permite desplegar una versión nueva de la app sobre una base de datos
 * real ya poblada sin tocarla a mano ni perder datos.
 *
 * Cascadas relevantes: clientes → equipos → componentes, equipos → fotos.
 */

const path = require('path');
const Database = require('better-sqlite3');

// Dentro del ejecutable empaquetado, __dirname apunta al snapshot de solo lectura;
// el archivo de datos debe vivir junto al .exe real para poder escribirse y persistir.
const baseDir = process.pkg ? path.dirname(process.execPath) : __dirname;
const db = new Database(path.join(baseDir, 'data.sqlite'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT,
    email TEXT,
    direccion TEXT,
    notas TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS equipos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    nombre TEXT NOT NULL,
    numero_serie TEXT,
    fecha_entrega TEXT,
    meses_garantia INTEGER NOT NULL DEFAULT 0,
    mantenimiento INTEGER NOT NULL DEFAULT 0,
    tiene_cargador INTEGER,
    notas TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS componentes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL,
    descripcion TEXT,
    numero_serie TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fotos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    intervencion_id INTEGER,
    archivo TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS archivos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    archivo TEXT NOT NULL,
    nombre_original TEXT NOT NULL,
    mimetype TEXT NOT NULL,
    tamano INTEGER NOT NULL,
    categoria TEXT NOT NULL DEFAULT 'Otro',
    descripcion TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS historial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    fecha TEXT NOT NULL,
    tipo TEXT NOT NULL,
    problema_reportado TEXT,
    descripcion TEXT NOT NULL,
    tecnico TEXT,
    coste REAL,
    proxima_revision TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_equipos_cliente ON equipos(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_componentes_equipo ON componentes(equipo_id);
  CREATE INDEX IF NOT EXISTS idx_fotos_equipo ON fotos(equipo_id);
  CREATE INDEX IF NOT EXISTS idx_archivos_equipo ON archivos(equipo_id);
  CREATE INDEX IF NOT EXISTS idx_historial_equipo ON historial(equipo_id);

  CREATE TABLE IF NOT EXISTS credenciales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL DEFAULT 'Usuario',
    usuario TEXT,
    password TEXT,
    nota TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_credenciales_equipo ON credenciales(equipo_id);

  CREATE TABLE IF NOT EXISTS licencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    equipo_id INTEGER NOT NULL REFERENCES equipos(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    clave TEXT,
    nota TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_licencias_equipo ON licencias(equipo_id);

  CREATE TABLE IF NOT EXISTS configuracion (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    numero TEXT NOT NULL UNIQUE,
    equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
    estado TEXT NOT NULL DEFAULT 'Pendiente',
    descripcion TEXT,
    tecnico_asignado TEXT,
    fecha_entrada TEXT NOT NULL DEFAULT (date('now')),
    fecha_estimada TEXT,
    fecha_entrega TEXT,
    coste REAL,
    notas_internas TEXT,
    email_listo_enviado INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tickets_equipo   ON tickets(equipo_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_cliente  ON tickets(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_tickets_estado   ON tickets(estado);

  CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nombre TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    rol TEXT NOT NULL DEFAULT 'tecnico',
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_usuarios_username ON usuarios(username);

  CREATE TABLE IF NOT EXISTS sesiones (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_en TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS reset_tokens (
    token TEXT PRIMARY KEY,
    usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    expira_en TEXT NOT NULL
  );
`);

const columnasEquipos = db.prepare(`PRAGMA table_info(equipos)`).all().map(c => c.name);
if (!columnasEquipos.includes('tiene_cargador')) {
  db.exec(`ALTER TABLE equipos ADD COLUMN tiene_cargador INTEGER`);
}
if (!columnasEquipos.includes('tiene_teclado')) {
  db.exec(`ALTER TABLE equipos ADD COLUMN tiene_teclado INTEGER`);
}

const columnasFotos = db.prepare(`PRAGMA table_info(fotos)`).all().map(c => c.name);
if (!columnasFotos.includes('intervencion_id')) {
  db.exec(`ALTER TABLE fotos ADD COLUMN intervencion_id INTEGER`);
}

const columnasHistorial = db.prepare(`PRAGMA table_info(historial)`).all().map(c => c.name);
if (!columnasHistorial.includes('problema_reportado')) {
  db.exec(`ALTER TABLE historial ADD COLUMN problema_reportado TEXT`);
}

const columnasClientes = db.prepare(`PRAGMA table_info(clientes)`).all().map(c => c.name);
if (!columnasClientes.includes('numero_cliente')) {
  db.exec(`ALTER TABLE clientes ADD COLUMN numero_cliente TEXT`);
}
if (!columnasClientes.includes('cp')) {
  db.exec(`ALTER TABLE clientes ADD COLUMN cp TEXT`);
}
if (!columnasClientes.includes('ciudad')) {
  db.exec(`ALTER TABLE clientes ADD COLUMN ciudad TEXT`);
}
if (!columnasClientes.includes('provincia')) {
  db.exec(`ALTER TABLE clientes ADD COLUMN provincia TEXT`);
}

const columnasUsuarios = db.prepare(`PRAGMA table_info(usuarios)`).all().map(c => c.name);
if (!columnasUsuarios.includes('email')) db.exec(`ALTER TABLE usuarios ADD COLUMN email TEXT`);

const columnasEquiposAccesos = db.prepare(`PRAGMA table_info(equipos)`).all().map(c => c.name);
if (!columnasEquiposAccesos.includes('anydesk_id'))        db.exec(`ALTER TABLE equipos ADD COLUMN anydesk_id TEXT`);
if (!columnasEquiposAccesos.includes('anydesk_pass'))      db.exec(`ALTER TABLE equipos ADD COLUMN anydesk_pass TEXT`);
if (!columnasEquiposAccesos.includes('megas_id'))          db.exec(`ALTER TABLE equipos ADD COLUMN megas_id TEXT`);
if (!columnasEquiposAccesos.includes('megas_pass'))        db.exec(`ALTER TABLE equipos ADD COLUMN megas_pass TEXT`);
if (!columnasEquiposAccesos.includes('software_instalado'))db.exec(`ALTER TABLE equipos ADD COLUMN software_instalado TEXT`);

// Crear usuario de demostración por defecto si no hay usuarios
if (db.prepare(`SELECT COUNT(*) as n FROM usuarios`).get().n === 0) {
  const _crypto = require('crypto');
  const _salt = _crypto.randomBytes(16).toString('hex');
  const _hash = _crypto.createHash('sha256').update('Demo1234' + _salt).digest('hex');
  db.prepare(`INSERT INTO usuarios (username, nombre, password_hash, salt, rol) VALUES ('Demo', 'Demo', ?, ?, 'admin')`).run(_hash, _salt);
}

// Limpiar sesiones expiradas al arrancar
db.exec(`DELETE FROM sesiones WHERE expira_en <= datetime('now')`);

// Hacer cliente_id nullable en equipos (bases de datos existentes tenían NOT NULL)
const _eqClienteCol = db.prepare(`PRAGMA table_info(equipos)`).all().find(c => c.name === 'cliente_id');
if (_eqClienteCol && _eqClienteCol.notnull === 1) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE equipos_nullable (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL,
      nombre TEXT NOT NULL,
      numero_serie TEXT,
      fecha_entrega TEXT,
      meses_garantia INTEGER NOT NULL DEFAULT 0,
      mantenimiento INTEGER NOT NULL DEFAULT 0,
      tiene_cargador INTEGER,
      notas TEXT,
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      anydesk_id TEXT,
      anydesk_pass TEXT,
      megas_id TEXT,
      megas_pass TEXT,
      software_instalado TEXT
    );
    INSERT INTO equipos_nullable SELECT id, cliente_id, tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, tiene_cargador, notas, creado_en, anydesk_id, anydesk_pass, megas_id, megas_pass, software_instalado FROM equipos;
    DROP TABLE equipos;
    ALTER TABLE equipos_nullable RENAME TO equipos;
    CREATE INDEX IF NOT EXISTS idx_equipos_cliente ON equipos(cliente_id);
  `);
  db.pragma('foreign_keys = ON');
}

// Migrar tabla tickets: equipo_id nullable + añadir cliente_id
const _tkCols = db.prepare(`PRAGMA table_info(tickets)`).all();
const _tkColNames = _tkCols.map(c => c.name);
const _tkEqCol = _tkCols.find(c => c.name === 'equipo_id');
const _needsTicketMigration = (_tkEqCol && _tkEqCol.notnull === 1) || !_tkColNames.includes('cliente_id');
if (_needsTicketMigration) {
  db.pragma('foreign_keys = OFF');
  const hasCid = _tkColNames.includes('cliente_id');
  db.exec(`
    CREATE TABLE tickets_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL UNIQUE,
      equipo_id INTEGER REFERENCES equipos(id) ON DELETE CASCADE,
      cliente_id INTEGER REFERENCES clientes(id) ON DELETE CASCADE,
      estado TEXT NOT NULL DEFAULT 'Pendiente',
      descripcion TEXT,
      tecnico_asignado TEXT,
      fecha_entrada TEXT NOT NULL DEFAULT (date('now')),
      fecha_estimada TEXT,
      fecha_entrega TEXT,
      coste REAL,
      notas_internas TEXT,
      email_listo_enviado INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO tickets_new (id,numero,equipo_id,${hasCid ? 'cliente_id,' : ''}estado,descripcion,tecnico_asignado,fecha_entrada,fecha_estimada,fecha_entrega,coste,notas_internas,email_listo_enviado,creado_en)
      SELECT id,numero,equipo_id,${hasCid ? 'cliente_id,' : ''}estado,descripcion,tecnico_asignado,fecha_entrada,fecha_estimada,fecha_entrega,coste,notas_internas,email_listo_enviado,creado_en FROM tickets;
    DROP TABLE tickets;
    ALTER TABLE tickets_new RENAME TO tickets;
    CREATE INDEX IF NOT EXISTS idx_tickets_equipo ON tickets(equipo_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_cliente ON tickets(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);
  `);
  db.pragma('foreign_keys = ON');
}

const _tkColsFinal = db.prepare(`PRAGMA table_info(tickets)`).all().map(c => c.name);
if (!_tkColsFinal.includes('solucion'))     db.exec(`ALTER TABLE tickets ADD COLUMN solucion TEXT`);
if (!_tkColsFinal.includes('asignado_por')) db.exec(`ALTER TABLE tickets ADD COLUMN asignado_por TEXT`);
if (!_tkColsFinal.includes('transportista'))       db.exec(`ALTER TABLE tickets ADD COLUMN transportista TEXT`);
if (!_tkColsFinal.includes('numero_seguimiento'))  db.exec(`ALTER TABLE tickets ADD COLUMN numero_seguimiento TEXT`);

const _batCols = db.prepare(`PRAGMA table_info(equipos)`).all().map(c => c.name);
if (!_batCols.includes('bateria_tipo'))         db.exec(`ALTER TABLE equipos ADD COLUMN bateria_tipo TEXT`);
if (!_batCols.includes('bateria_cap_origen'))   db.exec(`ALTER TABLE equipos ADD COLUMN bateria_cap_origen INTEGER`);
if (!_batCols.includes('bateria_cap_actual'))   db.exec(`ALTER TABLE equipos ADD COLUMN bateria_cap_actual INTEGER`);
if (!_batCols.includes('bateria_vida_pct'))     db.exec(`ALTER TABLE equipos ADD COLUMN bateria_vida_pct REAL`);
if (!_batCols.includes('bateria_descarga_mw'))  db.exec(`ALTER TABLE equipos ADD COLUMN bateria_descarga_mw REAL`);
if (!_batCols.includes('bateria_ciclos'))       db.exec(`ALTER TABLE equipos ADD COLUMN bateria_ciclos INTEGER`);

// horas_trabajadas en tickets
const _tkHoras = db.prepare(`PRAGMA table_info(tickets)`).all().map(c => c.name);
if (!_tkHoras.includes('horas_trabajadas')) db.exec(`ALTER TABLE tickets ADD COLUMN horas_trabajadas REAL`);

// Tabla de log de cambios de ticket
db.exec(`
  CREATE TABLE IF NOT EXISTS ticket_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    usuario TEXT NOT NULL,
    campo TEXT NOT NULL,
    valor_anterior TEXT,
    valor_nuevo TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_ticket_log_ticket ON ticket_log(ticket_id);
`);

// Tabla de plantillas de intervención
db.exec(`
  CREATE TABLE IF NOT EXISTS plantillas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    tipo TEXT,
    contenido TEXT NOT NULL,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------- Inventario ----------
// El stock actual se mantiene en artículos y cada cambio queda auditado en movimientos.
// Las salidas se agrupan para poder consultar qué se entregó a cada cliente.
db.exec(`
  CREATE TABLE IF NOT EXISTS inventario_articulos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo TEXT UNIQUE,
    ean TEXT UNIQUE,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad TEXT NOT NULL DEFAULT 'ud.',
    stock REAL NOT NULL DEFAULT 0,
    stock_minimo REAL NOT NULL DEFAULT 0,
    ubicacion TEXT,
    notas TEXT,
    activo INTEGER NOT NULL DEFAULT 1,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_inventario_articulos_nombre ON inventario_articulos(nombre COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_inventario_articulos_activo ON inventario_articulos(activo);

  CREATE TABLE IF NOT EXISTS inventario_salidas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
    fecha TEXT NOT NULL DEFAULT (date('now')),
    referencia TEXT,
    notas TEXT,
    usuario TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_inventario_salidas_cliente ON inventario_salidas(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_inventario_salidas_fecha ON inventario_salidas(fecha);

  CREATE TABLE IF NOT EXISTS inventario_salida_lineas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    salida_id INTEGER NOT NULL REFERENCES inventario_salidas(id) ON DELETE CASCADE,
    articulo_id INTEGER NOT NULL REFERENCES inventario_articulos(id),
    cantidad REAL NOT NULL CHECK (cantidad > 0)
  );
  CREATE INDEX IF NOT EXISTS idx_inventario_lineas_salida ON inventario_salida_lineas(salida_id);
  CREATE INDEX IF NOT EXISTS idx_inventario_lineas_articulo ON inventario_salida_lineas(articulo_id);

  CREATE TABLE IF NOT EXISTS inventario_movimientos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    articulo_id INTEGER NOT NULL REFERENCES inventario_articulos(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'ajuste', 'salida')),
    cantidad REAL NOT NULL,
    stock_anterior REAL NOT NULL,
    stock_nuevo REAL NOT NULL,
    salida_id INTEGER REFERENCES inventario_salidas(id) ON DELETE SET NULL,
    referencia TEXT,
    notas TEXT,
    usuario TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_inventario_mov_articulo ON inventario_movimientos(articulo_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_inventario_mov_tipo ON inventario_movimientos(tipo);
`);

const columnasInventario = db.prepare(`PRAGMA table_info(inventario_articulos)`).all().map(c => c.name);
if (!columnasInventario.includes('ean')) db.exec(`ALTER TABLE inventario_articulos ADD COLUMN ean TEXT`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_inventario_articulos_ean ON inventario_articulos(ean) WHERE ean IS NOT NULL AND ean <> ''`);

const columnasSalidas = db.prepare(`PRAGMA table_info(inventario_salidas)`).all().map(c => c.name);
if (!columnasSalidas.includes('facturado')) db.exec(`ALTER TABLE inventario_salidas ADD COLUMN facturado INTEGER NOT NULL DEFAULT 0`);

// ---------- Envíos ----------
// Registro de envíos/devoluciones por transportista (MRW, SEUR, Celeritas...),
// independiente del inventario: aquí solo se lleva control del paquete en sí.
db.exec(`
  CREATE TABLE IF NOT EXISTS envios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL DEFAULT (date('now')),
    transportista TEXT NOT NULL,
    numero_seguimiento TEXT,
    tipo TEXT NOT NULL DEFAULT 'Envio' CHECK (tipo IN ('Envio', 'Devolucion')),
    notas TEXT,
    usuario TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_envios_fecha ON envios(fecha);
  CREATE INDEX IF NOT EXISTS idx_envios_tipo ON envios(tipo);
`);

const columnasEnvios = db.prepare(`PRAGMA table_info(envios)`).all().map(c => c.name);
if (!columnasEnvios.includes('numero_seguimiento')) db.exec(`ALTER TABLE envios ADD COLUMN numero_seguimiento TEXT`);

// ---------- Licencias de software por cliente ----------
// Distinta de la tabla "licencias" (claves de software por equipo): aquí se registra,
// por cliente, qué licencia de programa (Office, Kaspersky...) tiene y su número/fecha.
db.exec(`
  CREATE TABLE IF NOT EXISTS licencias_clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    programa TEXT NOT NULL,
    numero_licencia TEXT,
    fecha TEXT NOT NULL DEFAULT (date('now')),
    usuario TEXT,
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_licencias_clientes_cliente ON licencias_clientes(cliente_id);
`);

// Datos de ejemplo (cliente, equipo, ticket y artículo de inventario) para que
// el demo no arranque completamente vacío. Ficticios, solo se insertan si la
// base de datos es nueva (sin clientes todavía).
if (db.prepare(`SELECT COUNT(*) as n FROM clientes`).get().n === 0) {
  const hoy = new Date().toISOString().slice(0, 10);

  const cliente = db.prepare(`
    INSERT INTO clientes (nombre, telefono, email, direccion, notas, numero_cliente, cp, ciudad, provincia)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run('Bar El Rincón', '600 11 22 33', 'contacto@ejemplo.com', 'Calle Ejemplo, 1',
    'Cliente de demostración', 'DEMO-001', '28000', 'Madrid', 'Madrid');

  const equipo = db.prepare(`
    INSERT INTO equipos (cliente_id, tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, notas)
    VALUES (?, 'TPV', 'TPV Caja 1', 'DEMO-SN-0001', ?, 24, 1, 'Equipo de demostración')
  `).run(cliente.lastInsertRowid, hoy);

  db.prepare(`
    INSERT INTO historial (equipo_id, fecha, tipo, descripcion, tecnico)
    VALUES (?, ?, 'Instalación', 'Instalación inicial del TPV y configuración del software de gestión.', 'Demo')
  `).run(equipo.lastInsertRowid, hoy);

  const yyyymm = hoy.slice(0, 7).replace('-', '');
  db.prepare(`
    INSERT INTO tickets (numero, equipo_id, cliente_id, estado, descripcion, tecnico_asignado, fecha_entrada)
    VALUES (?, ?, ?, 'Entregado', 'Revisión de la impresora de tickets.', 'Demo', ?)
  `).run(`TK-${yyyymm}-0001`, equipo.lastInsertRowid, cliente.lastInsertRowid, hoy);

  db.prepare(`
    INSERT INTO tickets (numero, equipo_id, cliente_id, estado, descripcion, tecnico_asignado, fecha_entrada)
    VALUES (?, ?, ?, 'Pendiente', 'El TPV no detecta el datáfono por Bluetooth.', 'Demo', ?)
  `).run(`TK-${yyyymm}-0002`, equipo.lastInsertRowid, cliente.lastInsertRowid, hoy);

  // Equipo propio del taller (sin cliente asignado), para la sección "Oficina"
  db.prepare(`
    INSERT INTO equipos (cliente_id, tipo, nombre, numero_serie, fecha_entrega, meses_garantia, mantenimiento, notas)
    VALUES (NULL, 'PC', 'PC Oficina 1', 'DEMO-SN-0002', ?, 12, 0, 'Equipo de oficina de demostración')
  `).run(hoy);

  const articulo = db.prepare(`
    INSERT INTO inventario_articulos (codigo, nombre, categoria, unidad, stock, stock_minimo, ubicacion)
    VALUES ('ART-001', 'Rollo papel térmico 80mm', 'Consumibles', 'ud.', 25, 5, 'Almacén')
  `).run();

  // Una salida de ejemplo para que el resumen de inventario no esté vacío
  const cantidadSalida = 5;
  const stockTrasSalida = 25 - cantidadSalida;
  const salida = db.prepare(`
    INSERT INTO inventario_salidas (cliente_id, fecha, referencia, notas, usuario)
    VALUES (?, ?, 'Entrega inicial', 'Salida de demostración', 'Demo')
  `).run(cliente.lastInsertRowid, hoy);
  db.prepare(`
    INSERT INTO inventario_salida_lineas (salida_id, articulo_id, cantidad)
    VALUES (?, ?, ?)
  `).run(salida.lastInsertRowid, articulo.lastInsertRowid, cantidadSalida);
  db.prepare(`
    UPDATE inventario_articulos SET stock = ? WHERE id = ?
  `).run(stockTrasSalida, articulo.lastInsertRowid);
  db.prepare(`
    INSERT INTO inventario_movimientos (articulo_id, tipo, cantidad, stock_anterior, stock_nuevo, salida_id, referencia, notas, usuario)
    VALUES (?, 'salida', ?, 25, ?, ?, 'Entrega inicial', 'Salida de demostración', 'Demo')
  `).run(articulo.lastInsertRowid, cantidadSalida, stockTrasSalida, salida.lastInsertRowid);

  db.prepare(`
    INSERT INTO licencias_clientes (cliente_id, programa, numero_licencia, fecha, usuario)
    VALUES (?, 'Office 365', 'DEMO-LIC-0001', ?, 'Demo')
  `).run(cliente.lastInsertRowid, hoy);
}

module.exports = db;
