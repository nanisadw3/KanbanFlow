# Notificaciones por correo y tareas retrasadas — Diseño

Fecha: 2026-10-16

## Objetivo

Que cada usuario tenga un correo registrado y reciba un aviso por correo cuando:

1. Un administrador le crea/asigna una tarea nueva.
2. Una tarea suya se retrasa (pasa su fecha de fin sin completarse).

Además, en la interfaz las tareas retrasadas deben distinguirse visualmente.

## Decisiones tomadas con el usuario

- El correo del usuario es **obligatorio**.
- Los avisos salen de **una sola cuenta de correo** configurada en el servidor (no de la cuenta de cada admin).
- El aviso de retraso se envía **una sola vez** por tarea, cuando se vence.
- Las tareas retrasadas se marcan **visualmente** en el tablero (color/etiqueta).
- El aviso de tarea nueva se envía solo al **crear**, no al editar.

## Fuera de alcance

- Autenticación real, recuperación de contraseña o login con correo.
- Recordatorios repetidos de retraso.
- Avisos al editar, reasignar o completar tareas.
- Envío desde la cuenta personal de cada admin.

## Datos

Todas las migraciones siguen el patrón existente en `server/index.ts` (`ALTER TABLE ... ADD COLUMN`, nullable o con default) para que las bases ya existentes (otras computadoras) se migren solas al reiniciar el servidor sin perder datos.

- `users.email TEXT` — correo del usuario. Nullable en la base (los usuarios existentes quedan vacíos); obligatorio a nivel de aplicación.
- `activities.overdueNotifiedAt TEXT` — ISO timestamp del aviso de retraso ya enviado; `NULL` si no se ha enviado.

El tipo `User` y `Activity` en `src/db.ts` incluyen los campos nuevos (siguiendo el patrón `undefined → null` ya usado en el proyecto).

## Componentes

### 1. Correo del usuario

- **Crear usuario (`user:create`)**: `email` requerido y validado con una expresión simple de formato. Se rechaza si falta o es inválido.
- **Usuarios existentes sin correo**: al iniciar sesión, si `email` está vacío, el cliente muestra un diálogo bloqueante (sin botón de cerrar) que pide el correo. Se guarda con un evento nuevo `user:setEmail`.
- **Edición por el admin**: el panel de gestión de usuarios muestra el correo y permite cambiarlo con el mismo evento `user:setEmail`.
- Los correos se emiten junto con la lista de usuarios existente (`users` broadcast), por lo que la UI no necesita una consulta aparte.

### 2. Envío (`server/mailer.ts`, nuevo)

- Usa `nodemailer`.
- Configuración por variables de entorno: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`. Nunca se guardan en la base ni en git.
- Si faltan, el módulo queda deshabilitado: registra un aviso en consola una vez y las funciones de envío son no-ops. El servidor sigue funcionando.
- Los errores de envío se capturan y se registran; nunca interrumpen la creación de tareas ni el revisor.
- Expone dos funciones: `sendNewTaskEmail(to, task, assignedByName)` y `sendOverdueEmail(to, task)`. Los correos están en español.
- El `Dockerfile` y el README documentan las variables nuevas.

### 3. Aviso de tarea nueva

En el handler `activity:add`, tras insertar la tarea, si:
- `assignedBy` corresponde a un usuario con rol `admin`, y
- el destinatario (`username`) es otro usuario distinto y tiene `email`,

se llama a `sendNewTaskEmail` sin esperar su resultado (fire-and-forget con captura de errores).

### 4. Aviso de retraso (revisor periódico)

- Un `setInterval` en el servidor (cada 5 minutos, y una vez al arrancar) busca actividades con:
  `endDate < fecha de hoy` (local del servidor, formato `YYYY-MM-DD`), `status NOT IN ('done','cancelled')`, `overdueNotifiedAt IS NULL`.
- Para cada una: si el usuario asignado tiene `email`, envía el correo y marca `overdueNotifiedAt`. Si no tiene correo, no marca (se reintentará cuando lo tenga).
- Si el envío falla, no se marca, y se reintenta en la siguiente vuelta.
- Si el mailer está deshabilitado, el revisor no marca nada.
- Una tarea cuenta como retrasada a partir del día siguiente a su `endDate`.
- **Reinicio de la marca**: en `activity:update`, si cambia `endDate`, o en `activity:updateStatus` si la tarea sale de `done`/`cancelled`, se pone `overdueNotifiedAt = NULL` para que pueda volver a avisar.

### 5. Indicador visual (cliente)

- Helper `isOverdue(a)` en `App.tsx`: `endDate < hoy` y `status` distinto de `done` y `cancelled`. Se calcula en cliente, sin tocar la base.
- Las tarjetas retrasadas reciben una clase `overdue` (borde y fondo rojizos) y una etiqueta "Retrasada".
- Los colores se definen como tokens CSS en `:root` para el tema oscuro y el claro; no se usan colores crudos en `App.css`.
- Como `hoy` cambia con el tiempo, el cliente refresca su valor de "hoy" periódicamente (cada minuto) para que las tarjetas cambien de color sin recargar.
- Se aplica en las tres columnas del tablero y en las mini-tarjetas del panel de admin.

## Manejo de errores

| Situación | Comportamiento |
|---|---|
| SMTP sin configurar | Mailer deshabilitado; aviso en consola; app normal |
| Falla el envío | Se registra; la tarea se crea igual; el revisor reintenta el aviso de retraso |
| Usuario sin correo | No se envía; el diálogo bloqueante lo pide al iniciar sesión |
| Correo inválido | El servidor lo rechaza con mensaje de error al cliente |

## Verificación

No hay suite de tests (ver `CLAUDE.md`). Se verificará con:

- `tsc --noEmit`, `npm run build`, `npx oxlint src/`.
- Servidor SMTP falso local (captura de mensajes) para comprobar: correo de tarea nueva, correo de retraso una sola vez, reintento tras fallo, reinicio de la marca al cambiar `endDate`.
- Migración sobre una copia de una base existente: los datos previos se conservan y las columnas nuevas aparecen.
- Playwright para el diálogo de correo obligatorio y el color de tarjetas retrasadas en ambos temas, con captura de pantalla.

## Riesgos

- La zona horaria del servidor determina cuándo "es hoy"; se documenta en el README.
- Gmail y similares exigen una contraseña de aplicación para SMTP; el README lo indica.
- `App.tsx` es un solo componente grande; los cambios de UI se limitan a un helper, una clase CSS y un diálogo, sin refactorizar.
