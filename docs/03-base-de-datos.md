# Base de datos

Todo vive en un único archivo **SQLite** (`data.sqlite`, modo WAL), definido
en `db.js`. No hay ORM: las consultas en `server.js` son SQL directo vía
`better-sqlite3` (`db.prepare(...).run()/.get()/.all()`).

## Cómo evoluciona el esquema

`db.js` crea las tablas con `CREATE TABLE IF NOT EXISTS` y luego aplica una
serie de **migraciones inline**: antes de cada campo nuevo comprueba con
`PRAGMA table_info(tabla)` si la columna ya existe, y si no, ejecuta
`ALTER TABLE ... ADD COLUMN`. Esto significa que:

- No hay carpeta `migrations/` ni versión de esquema explícita.
- Una base de datos antigua se pone al día sola la primera vez que arranca
  con una versión más nueva del código — no requiere ningún paso manual.
- Para añadir un campo nuevo a una tabla existente, el patrón a seguir es
  siempre el mismo: comprobar con `table_info` + `ALTER TABLE` al final de
  `db.js`, nunca editar la sentencia `CREATE TABLE` original (eso solo
  afecta a bases de datos nuevas).
- Dos tablas (`equipos`, `tickets`) tuvieron cambios que SQLite no permite
  con un simple `ALTER TABLE` (quitar un `NOT NULL`), así que para esas se
  ve el patrón "crear tabla `_nueva`, copiar datos, `DROP` + `RENAME`".

## Tablas principales

```
clientes 1───* equipos 1───* componentes
                  │  │
                  │  └──────* fotos
                  │  └──────* archivos
                  │  └──────* historial (intervenciones)
                  │  └──────* credenciales / licencias
                  │
clientes 1───* tickets *───1 equipos (opcional)
                  └──────* ticket_log

inventario_articulos 1───* inventario_movimientos
                      *───* inventario_salidas (vía inventario_salida_lineas)
                                    └── cliente (opcional)

usuarios 1───* sesiones
         1───* reset_tokens
```

| Tabla | Para qué | Notas |
|---|---|---|
| `clientes` | Empresas/personas a las que se les repara equipos | `cliente_id = NULL` en `equipos` = "Oficina Megas" |
| `equipos` | Cada aparato (PC, Portátil, Tablet…) | `tiene_cargador`/`tiene_teclado` solo tienen sentido si `tipo = 'Tablet'`; campos `bateria_*` (tipo, capacidad origen/actual en mWh, `bateria_vida_pct`, descarga, ciclos) |
| `componentes` | Piezas internas de un equipo (con su propio nº de serie) | Cascada al borrar el equipo |
| `fotos` / `archivos` | Imágenes y adjuntos de un equipo | `archivos` guarda también `categoria` (Factura, Garantía…) y metadatos del fichero |
| `historial` | Intervenciones/reparaciones realizadas sobre un equipo | `proxima_revision` alimenta el aviso "Revisar" en la ficha |
| `credenciales` / `licencias` | Accesos remotos y claves de software por equipo | Pensado para AnyDesk/Megas/usuario-contraseña |
| `tickets` | El flujo de reparación en curso | `equipo_id` y `cliente_id` son ambos opcionales (puede ser un ticket "general" de cliente); `estado` es texto libre configurable |
| `ticket_log` | Auditoría de cambios de un ticket | Quién cambió qué campo y cuándo |
| `plantillas` | Textos reutilizables para rellenar intervenciones | |
| `inventario_articulos` | Catálogo de piezas/consumibles del taller | `stock` vs `stock_minimo` → KPI "bajo mínimo" |
| `inventario_movimientos` | Auditoría de cada entrada/salida/ajuste de stock | Guarda `stock_anterior`/`stock_nuevo`, nunca se pierde el histórico |
| `inventario_salidas` + `inventario_salida_lineas` | Salidas de material agrupadas (p. ej. a un cliente) | `facturado` marca si ya se facturó |
| `licencias_clientes` | Licencias de software por cliente (no ligadas a un equipo concreto) | Distinta de la tabla `licencias` por equipo; pensada para software con varios puestos |
| `usuarios` | Cuentas de acceso a la app | `rol` ('admin' | 'tecnico'); se crea un usuario `Demo`/`Demo1234` automático si la tabla está vacía |
| `sesiones` / `reset_tokens` | Cookies de sesión y enlaces de recuperación de contraseña | Caducan por fecha; se limpian al arrancar |
| `configuracion` | Pares clave/valor (JSON) | Todas las "listas" configurables desde Configuración viven aquí |

## Integridad

- `PRAGMA foreign_keys = ON`: los `ON DELETE CASCADE` de las claves foráneas
  son los que realmente garantizan que, por ejemplo, al borrar un cliente
  desaparezcan también sus equipos, componentes y fotos — no hay lógica
  manual de borrado en cascada en `server.js`.
- `PRAGMA journal_mode = WAL`: permite lecturas mientras hay una escritura en
  curso; por eso verás `data.sqlite-wal` y `data.sqlite-shm` junto al
  `.sqlite` principal — son parte de la misma base de datos, no se pueden
  copiar/borrar por separado sin arriesgarse a perder cambios recientes.
