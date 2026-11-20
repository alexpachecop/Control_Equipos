# Arquitectura

Control de Equipos (también llamada **megasOS** en la interfaz) es una aplicación de
gestión para un taller de reparación: clientes, sus equipos, historial de
intervenciones, tickets de reparación e inventario de piezas/consumibles.

Es una aplicación **monolítica de un solo proceso Node.js**: no hay frontend y
backend separados, ni build step, ni frameworks pesados. Esto fue una decisión
deliberada para que la app se pueda ejecutar en un PC cualquiera de la oficina
sin instalar nada más que Node (o, empaquetada, ni eso).

```
┌─────────────────────────────────────────────┐
│          Navegador (multipágina, vanilla)     │
│   public/pages/<sección>/*.html + *.js         │
└───────────────────────┬───────────────────────┘
                         │ fetch() → JSON
┌───────────────────────▼───────────────────────┐
│             server.js (Express)                │
│   Rutas /api/* · autenticación por cookie       │
│   Envío de email (nodemailer) · PDFs/Excel/QR   │
└───────────────────────┬───────────────────────┘
                         │ better-sqlite3 (síncrono)
┌───────────────────────▼───────────────────────┐
│                  db.js → data.sqlite            │
│   Esquema + migraciones inline, WAL, FKs ON     │
└─────────────────────────────────────────────────┘
```

## Backend — `server.js`

- **Express 5**, un único archivo con todas las rutas bajo `/api/`.
- **Autenticación por sesión en cookie**: `POST /api/login` crea una fila en
  `sesiones` (tabla con `token`, `usuario_id`, `expira_en`) y devuelve una
  cookie `httpOnly`. Los middlewares `requireAuth`/`requireAdmin` protegen las
  rutas que lo necesitan.
- **Subida de archivos** con `multer` (fotos de equipos, adjuntos, logo).
- **Generación de documentos**: PDF y Excel de fichas de cliente
  (`exceljs` + generación manual de PDF), CSV de inventario, códigos QR
  (`qrcode`) para etiquetas de equipo.
- **Redimensionado de imágenes** con `sharp` (fotos subidas).
- **Email** con `nodemailer` (avisos de "ticket listo", recuperación de
  contraseña, informes de tickets por correo) — se configura en
  Configuración → Correo SMTP.

## Capa de datos — `db.js`

- **better-sqlite3**: acceso **síncrono** a SQLite (sin callbacks ni
  promesas), lo que simplifica mucho el código de `server.js` a cambio de
  bloquear el hilo en cada consulta — aceptable aquí porque el volumen de
  datos y de usuarios concurrentes es bajo (un taller, no una web pública).
- El esquema se crea con `CREATE TABLE IF NOT EXISTS` al arrancar, y todos los
  cambios posteriores (nuevas columnas, nuevas tablas) se aplican como
  **migraciones inline**: código que comprueba con `PRAGMA table_info(...)` si
  la columna ya existe y, si no, hace `ALTER TABLE`. Así la misma base de
  datos se puede abrir con versiones antiguas o nuevas del código sin pasos
  manuales — ver [03-base-de-datos.md](03-base-de-datos.md).
- `PRAGMA journal_mode = WAL` + `PRAGMA foreign_keys = ON`: journal WAL para
  mejor concurrencia lectura/escritura, claves foráneas activas para que los
  borrados en cascada (cliente → equipos → componentes/fotos) los garantice
  la propia base de datos.
- Si la tabla `usuarios` está vacía (primer arranque), se crea un usuario
  de demostración `Demo`/`Demo1234` automáticamente (rol admin).

## Frontend — `public/`

**JavaScript vanilla, sin framework**, como aplicación **multipágina real**:
cada sección tiene su propia ruta, su propio HTML y su propio `.js` —
`public/pages/<sección>/<sección>.html` + `<sección>.js` — servidos por rutas
explícitas en `server.js` (`/`, `/clientes/:id`, `/oficina`, `/tickets`,
`/inventario`, `/envios`, `/licencias`, `/configuracion`, más `/login` y la
ficha pública `/equipo/:id`). Cada ruta protegida pasa primero por el
middleware `pageAuth`, que redirige a `/login` si no hay sesión — no hay
router del lado del cliente ni recarga parcial: navegar entre secciones es
una navegación de página real.

Cada página es **autocontenida**: incluye su propia copia de los helpers
comunes (`api()`, `confirmar()`/`avisar()`, la topbar con buscador global y
el menú de usuario, etc.) en vez de depender de un `common.js` compartido.
Es una decisión deliberada — ver
[05-historial-desarrollo.md](05-historial-desarrollo.md) — que prioriza que
cada página se pueda leer y romper de forma aislada, a costa de cierta
duplicación de código entre páginas.

- Cada página mantiene su propio objeto `state` local (`clientes`, `equipos`,
  `usuario`, etc.) y funciones `renderX()` que repintan el DOM a partir de
  ese estado cada vez que algo cambia — un patrón simple de "estado → render"
  hecho a mano, igual que antes, pero con alcance de página en vez de global.
- `api(path, opts)` envuelve `fetch`, añade cabeceras JSON, redirige a
  `/login` si la respuesta es 401, lanza una excepción si no es `ok`, y
  devuelve `null` en 204.
- La navegación entre secciones es con enlaces `<a href>` normales (p. ej. la
  lista de clientes o los botones de la topbar), y algunos flujos pasan
  contexto por query string o `location.hash` (`/inventario?cliente=5`,
  `/clientes/8#equipo-42` para abrir resaltado un equipo concreto desde la
  búsqueda global).
- Todos los diálogos/formularios usan el elemento nativo `<dialog>`.
- `escapeHtml()` se usa antes de insertar cualquier dato del usuario en
  `innerHTML`, como única medida contra XSS (no hay framework que lo haga
  automáticamente).
- `public/style.css` es una única hoja de estilos compartida por todas las
  páginas (no hay motivo para dividir el CSS: a diferencia del HTML/JS, una
  hoja de estilos común entre páginas es el patrón normal en cualquier sitio
  multipágina).

## Empaquetado como ejecutable — `@yao-pkg/pkg`

```bash
npm run build:exe
```

compila todo (Node + dependencias + `public/`) en un único
`ControlEquipos.exe` que no necesita Node instalado en la máquina destino.
Como el sistema de archivos empaquetado es de solo lectura, tanto `db.js`
como `server.js` detectan `process.pkg` y redirigen los archivos que sí
necesitan ser escribibles (`data.sqlite`, carpeta `uploads/`) a la carpeta
donde vive el `.exe` (`path.dirname(process.execPath)`), nunca al interior
del paquete. Cualquier nueva ruta de escritura que se añada en el futuro debe
seguir este mismo patrón.

## Dónde viven los datos

Un único archivo `data.sqlite` (más sus acompañantes `-wal`/`-shm` del modo
WAL), situado:

- junto a `server.js` cuando se ejecuta con `npm start` (código fuente), o
- junto al `.exe` cuando se ejecuta el ejecutable empaquetado.

Son dos ubicaciones completamente independientes — copiar uno no sincroniza
el otro. Los archivos subidos (fotos, adjuntos, logo) viven igual, en
`uploads/` junto al mismo punto de referencia.
