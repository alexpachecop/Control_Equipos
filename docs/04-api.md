# API

Todas las rutas viven en `server.js`, bajo `/api/` (salvo un puñado de rutas
públicas como `/equipo/:id` o `/reset/:token`, pensadas para abrirse desde un
enlace sin iniciar sesión). No hay versión en la URL (`/api/v1/...`) ni
documentación OpenAPI — esta tabla es la referencia.

La mayoría de rutas requieren sesión iniciada (middleware `requireAuth`,
aplicado globalmente salvo en las rutas de login/reset); las marcadas *admin*
además requieren `requireAdmin`.

## Autenticación y usuarios

| Método y ruta | Qué hace |
|---|---|
| `POST /api/login` | Inicia sesión, crea cookie de sesión |
| `POST /api/logout` | Cierra la sesión actual |
| `GET /api/me` | Usuario autenticado actual (para recuperar sesión al recargar) |
| `POST /api/solicitar-reset` | Envía email con enlace de recuperación de contraseña |
| `GET/POST /reset/:token` | Formulario público para establecer nueva contraseña |
| `GET /api/usuarios` *(admin)* | Lista de usuarios |
| `POST /api/usuarios` *(admin)* | Crear usuario |
| `PUT /api/usuarios/:id/password` | Cambiar contraseña propia |
| `PUT /api/usuarios/:id/perfil` | Editar nombre/email propio |
| `DELETE /api/usuarios/:id` *(admin)* | Eliminar usuario |

## Clientes

| Método y ruta | Qué hace |
|---|---|
| `GET /api/clientes` | Listado (con contador de equipos/tickets) |
| `GET /api/clientes/:id` | Ficha de un cliente |
| `POST /api/clientes` | Crear cliente |
| `PUT /api/clientes/:id` | Editar cliente |
| `DELETE /api/clientes/:id` | Eliminar cliente (cascada a sus equipos) |
| `GET /api/clientes/:id/equipos` | Equipos de un cliente |
| `GET /api/clientes/:id/etiqueta-envio` | Etiqueta de envío en PDF |
| `GET /api/clientes/:id/exportar/{pdf,excel,csv}` | Ficha completa exportada |

## Equipos, componentes, fotos, archivos, historial

| Método y ruta | Qué hace |
|---|---|
| `GET /api/equipos/:id` | Ficha de un equipo |
| `POST /api/clientes/:id/equipos` | Crear equipo para un cliente |
| `PUT /api/equipos/:id` | Editar equipo (tipo, garantía, batería…) |
| `DELETE /api/equipos/:id` | Eliminar equipo |
| `GET /api/equipos/sin-asignar` / `.../count` | Equipos de "Oficina Megas" (sin cliente) |
| `POST /api/equipos/sin-asignar` | Crear equipo sin cliente |
| `PUT /api/equipos/:id/asignar-cliente` | Asignar/reasignar un equipo a un cliente |
| `POST /api/equipos/:id/componentes` · `PUT/DELETE /api/componentes/:id` | Piezas internas del equipo |
| `POST /api/equipos/:id/fotos` · `DELETE /api/fotos/:id` | Fotos (multipart, hasta 10 por subida) |
| `POST /api/historial/:id/fotos` | Fotos asociadas a una intervención |
| `POST /api/equipos/:id/archivos` · `GET .../descargar` · `GET .../ver` · `DELETE /api/archivos/:id` | Adjuntos (facturas, garantías…) |
| `POST /api/equipos/:id/historial` · `PUT/DELETE /api/historial/:id` | Intervenciones/reparaciones |
| `PUT /api/equipos/:id/accesos` | Credenciales AnyDesk/Megas |
| `PUT /api/equipos/:id/credenciales-bulk` · `.../licencias-bulk` | Guardar todas las credenciales/licencias de golpe |
| `GET /api/equipos/:id/etiqueta` | Etiqueta con QR del equipo |
| `GET /api/equipos/:id/informe-dispositivo` | Informe/ficha técnica imprimible |
| `GET /equipo/:id` | Ficha pública minimalista (a la que apunta el QR) |

## Tickets

| Método y ruta | Qué hace |
|---|---|
| `GET /api/tickets` | Listado con filtros (estado, técnico, fechas, texto) |
| `GET /api/equipos/:id/tickets` · `POST` | Tickets de un equipo / crear uno |
| `GET /api/clientes/:id/tickets` · `POST` | Tickets de un cliente / crear uno |
| `PUT /api/tickets/:id` | Editar ticket (estado, coste, horas, solución…) |
| `DELETE /api/tickets/:id` | Eliminar ticket |
| `GET /api/tickets/:id/log` | Auditoría de cambios del ticket |
| `POST /api/tickets/:id/nota` | Añadir nota interna |
| `POST /api/tickets/:id/notificar` | Avisar al cliente por email (p. ej. "listo para recoger") |
| `POST /api/tickets/enviar-informe` | Enviar resumen de tickets por email |

## Inventario

| Método y ruta | Qué hace |
|---|---|
| `GET /api/inventario/articulos` | Catálogo |
| `POST /api/inventario/articulos` · `PUT .../:id` · `POST .../eliminar` | Crear/editar/eliminar artículos |
| `GET /api/inventario/buscar-ean/:ean` | Buscar artículo por código de barras |
| `POST /api/inventario/importar` | Importación masiva |
| `GET /api/inventario/dashboard` | Resumen (stock total, bajo mínimo, movimientos de hoy…) |
| `GET/POST /api/inventario/movimientos` | Histórico de entradas/ajustes/salidas |
| `POST /api/inventario/salidas` · `GET /api/inventario/salidas` | Registrar/listar salidas agrupadas (p. ej. a un cliente) |
| `GET /api/inventario/salidas/:id` · `PUT .../:id` · `DELETE .../:id` | Ver/editar/eliminar una salida ya registrada |
| `PUT /api/inventario/salidas/:id/facturado` | Marcar/desmarcar una salida como facturada |
| `GET /api/inventario/informe` · `.../informe/csv` | Informe filtrable de movimientos |
| `GET /api/inventario/facturacion/pdf` | Informe de salidas en PDF (vista de impresión), con lista "Pedir" |
| `POST /api/inventario/informe/email` | Envía el mismo informe por correo (logo incrustado como `cid`) |
| `GET /api/inventario/exportar/excel` | Exporta el catálogo de artículos a Excel |

## Licencias

| Método y ruta | Qué hace |
|---|---|
| `GET /api/licencias` | Listado de licencias de software, agrupado por cliente |
| `POST /api/licencias` | Registrar una licencia |
| `PUT /api/licencias/:id` · `DELETE /api/licencias/:id` | Editar/eliminar una licencia |

## Configuración, búsqueda y utilidades

| Método y ruta | Qué hace |
|---|---|
| `GET/PUT /api/config` | Listas configurables (tipos de equipo, estados de ticket…) — `PUT` es *admin* |
| `GET /api/dashboard` | Datos de la pantalla de Inicio (ver [02-pantallas.md](02-pantallas.md)) |
| `GET /api/buscar` | Búsqueda global (clientes, equipos, nº de serie) |
| `GET /api/buscar-serie?q=` | Búsqueda específica por número de serie |
| `GET /api/generar-serie` | Sugerir un número de serie |
| `GET /api/plantillas` · `POST` · `PUT/DELETE /:id` | Plantillas de intervención reutilizables |
| `GET /api/impresoras` · `POST /api/imprimir-envio` | Impresión directa de etiquetas sin diálogo del sistema |
| `GET /api/sw-icons` | Catálogo de iconos de software conocido (para los badges de "Software:") |
| `GET /api/etiquetas` | Generación de hojas de etiquetas QR |
| `POST /api/email/test` | Probar la configuración SMTP |
| `GET /api/ping` | Comprobación de versión/estado del servidor |
