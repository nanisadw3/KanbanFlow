# Renovación de interfaz "primero íconos" — Diseño

Fecha: 2026-10-16

## Objetivo

Que la interfaz se vea más moderna, intuitiva y con menos texto: información que hoy se lee en palabras (estados, prioridades, fechas, acciones) pasa a íconos, colores y números, conservando una etiqueta corta donde un ícono solo no basta.

## Decisiones tomadas con el usuario

- Alcance: **todas las pantallas** (login, tablero personal, panel de admin, Equipos, modales, Productividad).
- Nivel de texto: **ícono + etiqueta corta**. El resto del texto pasa a tooltip y a etiquetas de accesibilidad.
- Es un cambio de **presentación**: no se toca el servidor, el modelo de datos ni la lógica de negocio.
- Solicitud adicional: la **fila de usuario del panel de admin** se ve "encimada" (elementos con distinta sangría, punto de presencia flotando sobre el nombre, etiqueta corrida) y sus botones de **correo y borrar** se ven anticuados; se rediseñan (ver §6).

## Fuera de alcance

- Cambiar la paleta de colores o la identidad de marca.
- Reorganizar el diseño general de las pantallas (qué va dónde) más allá de lo descrito.
- Vista móvil dedicada y animaciones nuevas más allá de transiciones sutiles.
- Cualquier cambio de comportamiento. El arrastrar y soltar (incluida la zona de cancelar) no se modifica; ver Restricciones.

## Restricciones (de CLAUDE.md)

- `App.tsx` no se divide en componentes de pantalla. Se permite un archivo nuevo de **primitivas de presentación** pequeñas y reutilizables (`src/ui.tsx`); la lógica y el estado siguen en `App.tsx`.
- Sin colores crudos en CSS: todo con tokens (`--color-*`, `--bg-*`, `--border-*`), válido en tema claro y oscuro.
- Tocar drag-and-drop solo en marcado visual de las tarjetas: `draggable`, `onDragStart/End/Over/Drop/Enter/Leave`, `isDraggingRef` y la zona de cancelar no se modifican. Todo hijo nuevo dentro de `.trash-zone` debe llevar `pointer-events: none`.
- No hay pruebas automáticas del cliente: se verifica con `tsc`, `oxlint`, `npm run build` y revisión en el navegador con capturas.
- Íconos: se usa Material Symbols Rounded, que el proyecto ya carga; no se añaden librerías.

## 1. Base común

Archivo nuevo `src/ui.tsx` con primitivas presentacionales:

- `IconButton`: botón cuadrado de ícono con `aria-label`, tooltip y variantes (`ghost`, `tonal`, `danger`, `primary`). Mínimo 36 px de área táctil.
- `Tip`/tooltip CSS (`[data-tip]`): aparece al pasar el cursor **y** al enfocar con teclado; no usa el `title` nativo (que tarda y no es estilizable).
- `StatusIcon`: ícono + color por estado (por hacer, en curso, hecha, cancelada, retrasada).
- `PriorityFlag`: bandera de color por prioridad (alta, media, baja) con tooltip.
- `Meta`: dato corto con ícono (`ícono + valor`), con tooltip del valor completo.
- `Avatar`: iniciales en círculo con color estable por usuario y punto de presencia opcional.

Formato de texto: etiquetas cortas, una línea, con mayúscula inicial (no TODO EN MAYÚSCULAS). Fechas cortas ("12 oct"); el año solo si no es el actual.

## 2. Panel de admin

- **Tarjetas de resumen:** ícono grande en círculo tonal, número protagonista y una palabra corta (Usuarios, Por hacer, En curso, Hechas, Canceladas, Retrasadas). Más compactas que hoy. El ícono de Canceladas deja de ser negro sobre fondo oscuro (usa el token de color de la tarjeta). Se mantiene el estado "activo" y el latido de Retrasadas.
- **Cabecera:** tema, contraseña, correo de avisos y nuevo usuario como `IconButton` con tooltip; la acción principal queda como "Nueva tarea" con ícono "+".
- **Equipos:** tarjetas y franja minimizada con íconos; el botón de borrar equipo usa el mismo `IconButton` que el borrar usuario (§6).
- **Mini-tarjetas de tareas:** prioridad como `PriorityFlag`; fechas "📅 12 oct → 20 oct"; si está retrasada, alarma roja con "6 d" (el texto largo en tooltip).

## 3. Tablero personal

- **Tarjetas:** prioridad como `PriorityFlag`; avance como barra/anillo con solo el porcentaje; fechas con `Meta` (sin las palabras "Inicio:"/"Fin:"); responsable como `Avatar`; retrasada con alarma roja y "N d". El botón de archivar es un `IconButton`.
- **Columnas:** ícono + nombre corto + contador.
- **Cabecera del tablero:** Historial y Limpiar como `IconButton` con tooltip; "Nueva" con ícono "+" como acción principal.
- Las tarjetas conservan `draggable` y todos sus manejadores sin cambios.

## 4. Modales (tarea, equipo, usuario, correo, contraseña, historial, confirmación)

- Cada campo con ícono al inicio de su etiqueta.
- **Estado** y **Prioridad** del modal de tarea pasan de listas desplegables a grupos de botones de selección con ícono y color (selección única), manteniendo los mismos valores y la misma lógica.
- Fechas con ícono de calendario.
- Cancelar como `IconButton` con "X"; Guardar conserva su palabra.
- Los modales conservan sus reglas (diálogo de correo obligatorio sin cierre, validaciones, contraseña de admin).

## 5. Productividad y login

- **Productividad:** tarjetas de resumen con ícono; en cada fila, la línea larga de porcentajes se reemplaza por chips compactos (ícono + %), y los conteos por ícono + número, incluida la insignia de retrasadas.
- **Login:** logo, un campo con ícono de persona, y un botón "Entrar" con ícono; el campo de contraseña de admin aparece igual que hoy.

## 6. Fila de usuario del panel de admin (solicitud adicional)

Problemas actuales (captura del usuario): el punto de presencia flota sobre el nombre; el nombre, "@usuario", "Última sesión", el correo y el contador tienen sangrías distintas; la etiqueta "1 retrasada" queda corrida (tiene `margin-left` propio); los botones de correo y borrar son círculos con borde y están ocultos hasta pasar el cursor 600 ms.

Rediseño:

- **Estructura en rejilla de dos columnas** con un único borde izquierdo común: columna de `Avatar` (con el punto de presencia como insignia en su esquina, no como elemento aparte) y columna de contenido.
- **Contenido, de arriba abajo:** nombre (hasta 2 líneas, alineado con el borde del contenido) → "@usuario" en tono apagado → una fila de **chips con ícono** que se reparte en varias líneas si hace falta:
  - 🕒 última sesión (fecha corta; fecha y hora completas en tooltip);
  - ✉ correo, truncado con puntos suspensivos (completo en tooltip); si falta, un chip punteado de advertencia "Sin correo";
  - ☑ N actividades;
  - ⏰ N retrasadas, en rojo, solo si hay.
- **Acciones a la derecha, arriba:** `IconButton` de **correo** y **borrar**, cuadrados redondeados de 36 px, estilo **tonal** (relleno suave del color, sin borde grueso): correo en tono primario, borrar en tono de peligro. Siempre visibles pero atenuados (opacidad reducida) y a plena intensidad al pasar el cursor o enfocar; así también existen en pantallas táctiles. Borrar sigue pidiendo confirmación.
- El mismo `IconButton` reemplaza al botón de borrar de las tarjetas de equipo y a la "x" de borrar de los chips de usuario.
- Se eliminan los desbordes (`overflow: hidden` con márgenes negativos) que recortan la sombra de la fila.

## Etapas

Cada etapa se implementa, se verifica con capturas en tema claro y oscuro y se commitea por separado:

1. Base común (`ui.tsx`, tooltips, tokens auxiliares) y arreglo del ícono negro de Canceladas.
2. Panel de admin: tarjetas, cabecera, **fila de usuario (§6)**, Equipos, mini-tarjetas.
3. Tablero personal: cabecera, columnas y tarjetas.
4. Modales.
5. Productividad y login.

## Criterios de aceptación

- Ninguna pantalla muestra etiquetas en mayúsculas sostenidas ni líneas de texto largas donde un ícono, color o número comunica lo mismo; todo ícono tiene tooltip y `aria-label`.
- En la fila de usuario, todos los elementos comparten un solo borde izquierdo y nada se superpone (comprobado con nombres largos, sin correo, con y sin retrasos, en línea y fuera de línea).
- Los botones de correo y borrar son visibles sin pasar el cursor, tienen foco visible y siguen confirmando el borrado.
- Funcionan igual que antes: arrastrar y soltar (incluida la zona de cancelar y su confirmación), filtros del admin, Equipos minimizado, modales y validaciones, diálogo de correo obligatorio, panel de correo de avisos.
- Todo se ve correcto en tema claro y oscuro; `tsc`, `oxlint` y `npm run build` limpios; `npm run test:server` sin cambios en verde.

## Riesgos

- `App.tsx` es un archivo muy grande y muy iterado; los cambios de marcado son muchos. Se mitiga con etapas pequeñas y revisión visual en cada una.
- Sin pruebas automáticas del cliente: una regresión de comportamiento solo se detecta en el navegador. Se mitiga ejecutando una lista de comprobaciones manuales por etapa (arrastrar, filtros, modales).
- Los tooltips no aparecen en pantallas táctiles; por eso las acciones principales conservan una palabra corta.
- El rediseño cambia mucho CSS; hay que cuidar que los estilos antiguos (`.delete-user-btn`, `.edit-email-btn`, `.user-chip-delete`) se eliminen al migrarlos, sin dejar reglas huérfanas.
