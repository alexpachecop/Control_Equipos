# Cómo se ha desarrollado

Este proyecto no tiene historial de Git (no es, todavía, un repositorio),
así que esta página reconstruye su evolución de dos formas honestas:

1. **A partir del propio código**: las migraciones de `db.js` se van
   añadiendo al final del archivo según se necesitan, así que su orden es un
   buen indicador aproximado de en qué momento se incorporó cada
   funcionalidad.
2. **Documentando, con detalle real, el trabajo hecho en la sesión que generó
   esta documentación** — eso sí se puede contar con precisión porque es
   trabajo verificado y probado en vivo.

## Orden aproximado de aparición de las funcionalidades

Leyendo `db.js` de arriba a abajo:

1. **Núcleo**: `clientes`, `equipos`, `componentes`, `fotos`, `archivos`,
   `historial` — la base: dar de alta clientes, sus equipos, y llevar un
   historial de reparaciones con fotos y documentos adjuntos.
2. **Accesos remotos**: `credenciales`, `licencias` — para anotar cómo
   conectarse a cada equipo (AnyDesk, usuario de Windows…) y qué licencias de
   software tiene instaladas.
3. **Tickets**: tabla `tickets` con estados configurables, más tarde
   `ticket_log` para auditar cambios, y campos añadidos progresivamente
   (`solucion`, `asignado_por`, transporte, `horas_trabajadas`) — el flujo de
   reparación se fue haciendo más rico con el tiempo, campo a campo.
4. **Cuentas de usuario**: `usuarios`, `sesiones`, `reset_tokens` — paso de
   una app sin login a una con autenticación y roles (admin/técnico).
5. **Plantillas** de intervención, para no escribir lo mismo cada vez.
6. **Inventario**: el bloque más grande y más tardío del esquema
   (`inventario_articulos`, `inventario_movimientos`, `inventario_salidas` +
   líneas) — convierte la app de "solo fichas de cliente" a también llevar el
   almacén del taller, con trazabilidad completa de entradas y salidas.
7. **Batería** (`bateria_tipo`, `bateria_cap_origen`, `bateria_cap_actual`,
   `bateria_vida_pct`, `bateria_descarga_mw`, `bateria_ciclos`) y
   **cargador/teclado** en tablets — campos pensados específicamente para el
   parque de tablets del taller.
8. **Dashboard de Inicio** y mejoras de navegación — lo más reciente, resumido
   abajo.

## Trabajo reciente (esta sesión): la pantalla de Inicio

Antes de esto, al entrar en la app se mostraba directamente el panel de
"Oficina Megas" o una pantalla vacía de "selecciona un cliente". Se diseñó y
construyó una pantalla de Inicio real:

1. **Exploración de diseño**: se probaron varias opciones de boceto (logo de
   fondo, buscador protagonista, reloj/saludo…) en un lienzo de diseño
   compartido, hasta llegar a un dashboard profesional con KPIs, gráfico de
   movimientos de inventario, actividad reciente y garantías por vencer.
   Variantes adicionales de gráfica (donut, mapa de calor, medidor de
   stock…) se exploraron como boceto aparte — ver
   [02-pantallas.md](02-pantallas.md#2-inicio-dashboard).
2. **Implementación real**: nuevo endpoint `GET /api/dashboard` (ver
   [04-api.md](04-api.md)) con datos honestos — ningún porcentaje o
   tendencia se inventó; donde no había forma barata de calcular una métrica
   real, simplemente no se mostró badge.
3. **Corrección de un bug de navegación**: el login manual (escribir
   usuario/contraseña y pulsar "Entrar") no llamaba a la función que pinta
   Inicio — por eso, tras iniciar sesión, el panel se quedaba en blanco hasta
   recargar la página. Se corrigió para que Inicio aparezca al instante.
4. **"Volver" respeta dónde estabas**: cerrar los paneles de Tickets o
   Inventario llevaba siempre a Inicio, perdiendo el cliente que se estuviera
   viendo. Ahora se vuelve exactamente a la vista anterior (un cliente,
   Oficina Megas, o Inicio si no había nada abierto).
5. **Batería a simple vista**: badge de color bajo "Software:" en la ficha de
   cada equipo, si tiene el porcentaje de vida de batería registrado.
6. **Login**: el logo de megasOS se movió fuera de la caja de inicio de
   sesión, y dentro de la caja el logo se sustituyó por un saludo
   "Bienvenido/a".

Todo lo anterior se probó en una copia aislada de la app con datos de
prueba, sin tocar nunca la base de datos real de producción — el mismo
método que se siguió para generar las capturas de pantalla de esta
documentación.

## Trabajo reciente (sesión de noviembre 2026): salidas de inventario y licencias

Segunda ronda de trabajo, centrada en el módulo de Inventario y en varios
bugs de formularios detectados en uso real:

1. **Editar y facturar salidas**: antes una salida de stock era de solo
   lectura una vez creada. Se añadió `PUT/DELETE /api/inventario/salidas/:id`
   y la posibilidad de editar sus líneas, además de una casilla "Facturado"
   que mueve la salida de la lista "Pendientes de facturar" a "Facturadas"
   (ver pantalla [Inventario](02-pantallas.md#5-inventario)).
2. **Filas expandibles**: cada fila de salida se puede desplegar para ver qué
   artículos y cantidades contenía, sin abrir un modal aparte.
3. **Informe de salidas en PDF/email con lista de "Pedir"**: un botón genera
   un PDF (o lo envía por correo con el logo incrustado) con los movimientos
   de un rango de fechas, y permite además seleccionar manualmente, con
   casillas, qué artículos bajo stock mínimo incluir en un apartado "Pedir"
   — más una caja de texto libre y un buscador para añadir cualquier otro
   artículo a mano. Construido en `construirInformeSalidas()` (server.js),
   compartido entre la vista de impresión y el envío por correo.
4. **Bug de búsqueda que limitaba otras pantallas**: el cuadro de búsqueda de
   la pestaña "Artículos" filtraba una lista en memoria (`_invArticulos`) que
   también usaban, por error, los buscadores de "Nueva salida", "Entrada/
   ajuste" y "Pedir" — así que si quedaba un término de búsqueda puesto, esas
   pantallas dejaban de encontrar artículos que sí existían. Se separó en dos
   listas: `_invArticulos` (filtrada, solo para la pestaña Artículos) y
   `_invArticulosTodos` (siempre el catálogo completo).
5. **Bug de "página en blanco" al guardar**: varios formularios en `<dialog>`
   (equipo, cliente, accesos, componente, fotos, archivo, historial) cerraban
   el modal con su comportamiento nativo antes de que terminara el guardado
   asíncrono, dejando la página en blanco. Se corrigió añadiendo
   `e.preventDefault()` y cerrando el modal solo tras confirmar que el
   guardado tuvo éxito.
6. **Configuración de correo SMTP**: el botón "Enviar prueba" probaba
   siempre la última configuración guardada, no la que hubiera en el
   formulario sin guardar todavía — se extrajo `guardarConfigSmtp()` para que
   "Enviar prueba" guarde primero y pruebe después.
7. **Varios ajustes de interfaz**: anchura de modales que no coincidía con el
   formulario interior, icono de lupa que se apilaba encima del campo de
   búsqueda en vez de al lado, cálculo automático del % de batería a partir
   de capacidad de origen/actual.

Mismo método que en la ronda anterior: todo probado primero en una copia
aislada de la app con datos de prueba, nunca contra la base de datos real.

## Qué falta por documentar aquí

Si en algún momento este proyecto pasa a tener control de versiones (Git),
esta página debería sustituirse por, o complementarse con, el propio
`git log` — mucho más fiable que una reconstrucción manual como esta.
