# Renovación de interfaz "primero íconos" — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Presentar estados, prioridades, fechas y acciones con íconos, colores y números (conservando una etiqueta corta cuando haga falta) en todas las pantallas, y rediseñar la fila de usuario del panel de admin y sus botones de correo/borrar.

**Architecture:** Un archivo nuevo de primitivas presentacionales (`src/ui.tsx`: `Icon`, `IconButton`, `Avatar`, `PriorityFlag`, `Meta`, `TaskDates`, `FieldLabel`, `Segmented`, `TaskCardBody`, `MiniTaskCard`) más CSS con tokens. `App.tsx` conserva todo el estado y la lógica; solo se sustituye marcado por esas primitivas. Las tarjetas del tablero conservan su `<div draggable …>` y todos sus manejadores.

**Tech Stack:** React 19 + TypeScript + Vite, CSS con tokens, Material Symbols Rounded (ya cargado), `node:test` vía `tsx` solo para el helper de fecha corta.

**Spec:** `docs/superpowers/specs/2026-10-16-icon-first-ui-redesign-design.md`

## Global Constraints

- Solo presentación: no se tocan `server/`, el modelo de datos, eventos socket ni la lógica de negocio.
- Sin colores crudos en CSS ni en JSX: todo con tokens (`--color-*`, `--color-*-rgb`, `--bg-*`, `--text-*`, `--border-*`, `--overlay-rgb`). Los tokens existen en tema claro y oscuro (`src/index.css`).
- `App.tsx` no se divide en componentes de pantalla; las primitivas viven en `src/ui.tsx` y no tienen estado de negocio.
- No modificar `draggable`, `onDragStart/End/Over/Drop/Enter/Leave`, `isDraggingRef`, la zona de cancelar ni `handleDrag*`/`handleTrashDrop`. Todo hijo nuevo de `.trash-zone` lleva `pointer-events: none`.
- Íconos: Material Symbols Rounded vía `<span className="material-symbols-rounded">`; sin librerías nuevas.
- Textos en español, una línea, mayúscula inicial (no MAYÚSCULAS sostenidas). Todo ícono interactivo o informativo tiene `aria-label` y tooltip (`data-tip`).
- Los tooltips usan `data-tip` (CSS), no el atributo `title` nativo: al migrar un elemento se quita su `title`.
- Verificación de cada tarea: `npx tsc --noEmit -p tsconfig.app.json`, `npx oxlint src/`, `npm run build`, `npm run test:server` (38+ en verde) y capturas con Playwright en **tema claro y oscuro** sobre una copia de `kanban.db` **sin** `smtp_*` en `settings` (una copia con la configuración real de Gmail envía correos reales).
- Cada tarea termina en un commit. Mensajes en inglés con el trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- Nombres largos ("Ruben Alberto Hernández Zumuano") en la fila de usuario: caben en 2 líneas sin superponerse con los botones.
- Usuario sin correo, sin tareas, en línea / fuera de línea, con 0 y con varias retrasadas: la fila nunca muestra elementos encimados ni con sangrías distintas.
- Tooltips recortados por contenedores con `overflow: hidden` (tarjetas, columnas, filas): deben verse completos o abrirse hacia abajo.
- Arrastrar y soltar sigue funcionando tras cambiar el marcado de las tarjetas (incluida la zona de cancelar y su confirmación).
- Pantallas táctiles (`@media (hover: none)`): los tooltips no aparecen, así que los botones de acción siguen siendo visibles sin hover y las acciones principales tienen una palabra corta.
- Movimiento reducido: ninguna animación nueva se ejecuta con `prefers-reduced-motion: reduce`.
- Cambiar Estado a "En curso" en el modal sigue mostrando el control de avance, y guardar mantiene los mismos valores (`todo|doing|done`, `alta|media|baja`).

---

## File Structure

| Archivo | Responsabilidad |
|---|---|
| `src/ui.tsx` (nuevo) | Primitivas presentacionales sin estado de negocio |
| `src/dates.ts` | + `formatShortDate` |
| `server/dates.test.ts` | + pruebas de `formatShortDate` |
| `src/App.tsx` | Sustituye marcado por primitivas; estado/lógica intactos |
| `src/StatsPage.tsx` | Tarjetas y filas de Productividad con íconos |
| `src/App.css` | Estilos de primitivas y de las pantallas renovadas; se eliminan reglas huérfanas |

---

### Task 1: Base común (primitivas, tooltips, fecha corta) y arreglo del ícono negro

**Files:**
- Modify: `src/dates.ts`, `server/dates.test.ts`, `src/App.css`
- Create: `src/ui.tsx`

**Interfaces:**
- Produces (`src/dates.ts`): `formatShortDate(ymd: string, currentYear?: number): string` → `"12 oct"`, o `"1 dic 2025"` si el año no es el actual; devuelve la entrada tal cual si no es `YYYY-MM-DD`.
- Produces (`src/ui.tsx`):
  - `Icon({ name, size?, className?, style? })`
  - `IconButton({ icon, label, onClick?, variant?: 'ghost'|'tonal'|'danger', size?: number, className?, type?, disabled?, draggable? })` — `onClick: (e: React.MouseEvent<HTMLButtonElement>) => void`
  - `Avatar({ name, size?: number, online?: boolean })`
  - `PriorityFlag({ priority })` donde `priority: 'alta'|'media'|'baja'`
  - `Meta({ icon, tip, children, tone?: 'danger' })`
  - `TaskDates({ start, end, overdueDays? })`
  - `FieldLabel({ icon, children })`
  - `Segmented<T extends string>({ value, onChange, options, ariaLabel })` con `options: { value: T; label: string; icon: string; color: string }[]` (`color` es un nombre de token, p. ej. `'--color-todo'`)
  - `TaskCardBody({ act, today, overdue, showProgress?, onArchive? })`
  - `MiniTaskCard({ act, today, overdue, status })`

- [ ] **Step 1: Escribir las pruebas que fallan (`formatShortDate`)**

Agregar al final de `server/dates.test.ts` y añadir `formatShortDate` al import de `'../src/dates.ts'`:

```ts
test('formatShortDate: día y mes cortos; año solo si no es el actual', () => {
  assert.equal(formatShortDate('2026-10-12', 2026), '12 oct');
  assert.equal(formatShortDate('2026-01-05', 2026), '5 ene');
  assert.equal(formatShortDate('2025-12-01', 2026), '1 dic 2025');
  assert.equal(formatShortDate('', 2026), '');
  assert.equal(formatShortDate('no-es-fecha', 2026), 'no-es-fecha');
});
```

- [ ] **Step 2: Ejecutar y ver que falla**

Run: `npm run test:server`
Expected: FAIL (`formatShortDate` no está exportado de `../src/dates.ts`).

- [ ] **Step 3: Implementar `formatShortDate`**

Agregar a `src/dates.ts`:

```ts
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const formatShortDate = (ymd: string, currentYear: number = new Date().getFullYear()): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return ymd;
  return `${d} ${MONTHS[m - 1]}${y === currentYear ? '' : ` ${y}`}`;
};
```

- [ ] **Step 4: Ejecutar y ver que pasa**

Run: `npm run test:server`
Expected: PASS (todas, 39+).

- [ ] **Step 5: Crear `src/ui.tsx`**

```tsx
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { Activity } from './db';
import { daysOverdue, formatShortDate } from './dates';

// Presentational primitives for the icon-first UI. No business state lives here.

export function Icon({ name, size, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  return (
    <span
      className={`material-symbols-rounded ${className ?? ''}`}
      style={size ? { fontSize: size, ...style } : style}
      aria-hidden="true"
    >
      {name}
    </span>
  );
}

export function IconButton({
  icon, label, onClick, variant = 'ghost', size = 36, className, type = 'button', disabled, draggable,
}: {
  icon: string;
  label: string;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  variant?: 'ghost' | 'tonal' | 'danger';
  size?: number;
  className?: string;
  type?: 'button' | 'submit';
  disabled?: boolean;
  draggable?: boolean;
}) {
  return (
    <button
      type={type}
      className={`icon-btn icon-btn-${variant} ${className ?? ''}`}
      style={{ ['--ib' as string]: `${size}px` }}
      data-tip={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      draggable={draggable}
    >
      <Icon name={icon} size={Math.round(size * 0.5)} />
    </button>
  );
}

// Stable color per person, taken from existing theme tokens.
const AVATAR_TOKENS = ['--color-primary', '--color-done', '--color-todo', '--color-secondary', '--color-accent'];

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

export function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const token = AVATAR_TOKENS[h % AVATAR_TOKENS.length];
  return (
    <span
      className="avatar"
      style={{ ['--sz' as string]: `${size}px`, ['--av' as string]: `var(${token})`, ['--av-rgb' as string]: `var(${token}-rgb)` }}
      data-tip={online === undefined ? undefined : (online ? `${name} · en línea` : name)}
    >
      {initialsOf(name)}
      {online && <span className="avatar-online" />}
    </span>
  );
}

const PRIORITY_TIP = { alta: 'Prioridad alta', media: 'Prioridad media', baja: 'Prioridad baja' } as const;

export function PriorityFlag({ priority }: { priority?: Activity['priority'] }) {
  const p = priority || 'media';
  return (
    <span className={`prio-flag prio-flag-${p}`} data-tip={PRIORITY_TIP[p]} role="img" aria-label={PRIORITY_TIP[p]}>
      <Icon name="flag" size={16} />
    </span>
  );
}

export function Meta({ icon, tip, children, tone }: { icon: string; tip: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <span className={`meta ${tone === 'danger' ? 'meta-danger' : ''}`} data-tip={tip}>
      <Icon name={icon} size={14} />
      {children}
    </span>
  );
}

export function TaskDates({ start, end, overdueDays }: { start: string; end: string; overdueDays?: number }) {
  return (
    <>
      <Meta icon="calendar_month" tip={`Del ${start} al ${end}`}>
        {formatShortDate(start)} <Icon name="arrow_right_alt" size={14} /> {formatShortDate(end)}
      </Meta>
      {overdueDays !== undefined && overdueDays > 0 && (
        <Meta icon="alarm" tip={overdueDays === 1 ? 'Retrasada: venció ayer' : `Retrasada: venció hace ${overdueDays} días`} tone="danger">
          {overdueDays} d
        </Meta>
      )}
    </>
  );
}

export function FieldLabel({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <label className="form-label field-label">
      <Icon name={icon} size={16} />
      {children}
    </label>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: string; color: string }[];
  ariaLabel: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`segmented-option ${value === o.value ? 'is-selected' : ''}`}
          style={{ ['--seg' as string]: `var(${o.color})`, ['--seg-rgb' as string]: `var(${o.color}-rgb)` }}
          onClick={() => onChange(o.value)}
        >
          <Icon name={o.icon} size={18} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

// Body of a board card (title, flags, progress, expandable details, footer). The wrapper
// <div draggable …> with every drag handler stays in App.tsx.
export function TaskCardBody({
  act, today, overdue, showProgress, onArchive,
}: {
  act: Activity;
  today: string;
  overdue: boolean;
  showProgress?: boolean;
  onArchive?: () => void;
}) {
  return (
    <>
      <div className="task-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          <h4 className="task-title">{act.title}</h4>
          <Icon name="edit" size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
        </div>
        <div className="task-badges">
          <PriorityFlag priority={act.priority} />
          {showProgress && (
            <Meta icon="donut_small" tip="Avance">{act.progress ?? 50}%</Meta>
          )}
          {overdue && (
            <Meta icon="alarm" tip={`Retrasada: debía terminar el ${act.endDate}`} tone="danger">Retrasada</Meta>
          )}
          {onArchive && (
            <IconButton
              icon="inventory_2"
              label="Archivar: sale del tablero y queda en el Historial"
              size={28}
              className="task-archive"
              draggable={false}
              onClick={(e) => { e.stopPropagation(); onArchive(); }}
            />
          )}
        </div>
        {showProgress && (
          <div className="task-progress" role="progressbar" aria-valuenow={act.progress ?? 50} aria-valuemin={0} aria-valuemax={100}>
            <div className="task-progress-fill" style={{ width: `${act.progress ?? 50}%` }} />
          </div>
        )}
      </div>
      <div className="task-expand">
        <p className="task-desc">{act.description || 'Sin descripción.'}</p>
        {act.assignedBy && (
          <div className="task-assigned-by">
            <Icon name="star" size={12} /> Asignada por {act.assignedBy}
          </div>
        )}
      </div>
      <div className="task-footer">
        <div className="task-dates">
          <TaskDates start={act.startDate} end={act.endDate} overdueDays={overdue ? daysOverdue(act.endDate, today) : undefined} />
        </div>
        <Avatar name={act.username} size={24} />
      </div>
    </>
  );
}

// Compact card used in the admin dashboard's per-user map.
export function MiniTaskCard({
  act, today, overdue, status,
}: {
  act: Activity;
  today: string;
  overdue: boolean;
  status: 'todo' | 'doing' | 'done' | 'cancelled';
}) {
  return (
    <div className={`admin-mini-card mini-${status} ${overdue ? 'overdue' : ''}`}>
      <div className="mini-card-top">
        <div className="admin-mini-card-title">{act.title}</div>
        <div className="mini-card-flags">
          {status === 'doing' && <Meta icon="donut_small" tip="Avance">{act.progress ?? 50}%</Meta>}
          <PriorityFlag priority={act.priority} />
        </div>
      </div>
      {act.assignedBy && (
        <div className="admin-mini-card-by"><Icon name="star" size={11} /> {act.assignedBy}</div>
      )}
      <div className="mini-card-meta">
        <TaskDates start={act.startDate} end={act.endDate} overdueDays={overdue ? daysOverdue(act.endDate, today) : undefined} />
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Agregar el CSS base y arreglar el ícono negro**

Agregar al final de `src/App.css`:

```css
/* ───────── Icon-first foundation ───────── */

[data-tip] {
  position: relative;
}

[data-tip]::after {
  content: attr(data-tip);
  position: absolute;
  left: 50%;
  bottom: calc(100% + 8px);
  transform: translate(-50%, 4px);
  padding: 0.3rem 0.55rem;
  border-radius: 6px;
  background: var(--text-main);
  color: var(--bg-main);
  font-size: 0.72rem;
  font-weight: 600;
  line-height: 1.2;
  white-space: nowrap;
  text-transform: none;
  letter-spacing: 0;
  pointer-events: none;
  opacity: 0;
  z-index: 80;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

[data-tip]:hover::after,
[data-tip]:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0);
  transition-delay: 0.35s;
}

/* No hover on touch screens: tooltips would never close */
@media (hover: none) {
  [data-tip]::after {
    display: none;
  }
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--ib, 36px);
  height: var(--ib, 36px);
  padding: 0;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  flex-shrink: 0;
  background: rgba(var(--overlay-rgb), 0.06);
  color: var(--text-muted);
  transition: var(--transition-smooth);
}

.icon-btn:hover {
  background: rgba(var(--overlay-rgb), 0.12);
  color: var(--text-main);
}

.icon-btn:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.icon-btn-tonal {
  background: rgba(var(--color-primary-rgb), 0.14);
  color: var(--color-primary);
}

.icon-btn-tonal:hover {
  background: rgba(var(--color-primary-rgb), 0.26);
  color: var(--color-primary);
}

.icon-btn-danger {
  background: rgba(var(--color-danger-rgb), 0.12);
  color: var(--color-danger);
}

.icon-btn-danger:hover {
  background: rgba(var(--color-danger-rgb), 0.24);
  color: var(--color-danger);
}

.avatar {
  position: relative;
  width: var(--sz, 36px);
  height: var(--sz, 36px);
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  font-size: calc(var(--sz, 36px) * 0.38);
  font-weight: 700;
  font-family: var(--font-display);
  color: var(--av, var(--color-primary));
  background: rgba(var(--av-rgb, var(--color-primary-rgb)), 0.18);
}

.avatar-online {
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--color-done);
  border: 2px solid var(--bg-main);
}

.prio-flag {
  display: inline-flex;
  align-items: center;
}

.prio-flag-alta { color: var(--color-danger); }
.prio-flag-media { color: var(--color-todo); }
.prio-flag-baja { color: var(--color-done); }

.meta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
}

.meta-danger {
  color: var(--color-danger);
  font-weight: 700;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.segmented {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.segmented-option {
  flex: 1 1 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.6rem 0.5rem;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  transition: var(--transition-smooth);
}

.segmented-option:hover {
  border-color: var(--border-color-hover);
}

.segmented-option.is-selected {
  color: var(--seg);
  border-color: var(--seg);
  background: rgba(var(--seg-rgb), 0.14);
}

.segmented-option:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* The "Canceladas" stat icon had no rule and fell back to black on the dark theme */
.stat-icon-cancelled {
  background: rgba(var(--color-danger-rgb), 0.18);
  color: var(--color-danger);
}
```

- [ ] **Step 7: Verificar**

Run: `npm run test:server && npx tsc --noEmit -p tsconfig.app.json && npx oxlint src/ && npm run build`
Expected: todo en verde. (`ui.tsx` aún no se importa en `App.tsx`; `oxlint` no debe marcar errores en él.)

Abrir el panel de admin en el navegador (tema oscuro): el ícono de Canceladas ya se ve en rojo. Capturar.

- [ ] **Step 8: Commit**

```bash
git add src/dates.ts server/dates.test.ts src/ui.tsx src/App.css
git commit -m "feat(ui): icon-first primitives, tooltips, short dates; fix black cancelled icon"
```

---

### Task 2: Panel de admin (tarjetas, cabecera, fila de usuario, Equipos, mini-tarjetas)

**Files:**
- Modify: `src/App.tsx`, `src/App.css`

**Interfaces:**
- Consumes: todo lo de Task 1.
- Produces: nada nuevo; elimina reglas CSS `.delete-user-btn`, `.edit-email-btn`, `.team-card-delete` (y su uso), `.user-chip-delete`, `.overdue-user-badge` (se reemplaza por `Meta`).

- [ ] **Step 1: Importar las primitivas**

En `src/App.tsx`, junto a los demás imports:

```tsx
import { Icon, IconButton, Avatar, Meta, MiniTaskCard } from './ui';
```
y ampliar `import { todayString, isOverdue as isOverdueOn, overdueLabel } from './dates';` a `import { todayString, isOverdue as isOverdueOn } from './dates';` (si `overdueLabel` deja de usarse tras el Step 6, quitarlo para que `oxlint` no marque import sin uso).

- [ ] **Step 2: Tarjetas de resumen**

En el arreglo `cfg` de las tarjetas de estado, cambiar las etiquetas y conservar el título completo en el tooltip:

```tsx
{ key: 'todo', icon: 'assignment', label: 'Por hacer', full: 'Por Realizar', varColor: '--color-todo', varRgb: '--color-todo-rgb' },
{ key: 'doing', icon: 'schedule', label: 'En curso', full: 'En Proceso', varColor: '--color-doing', varRgb: '--color-doing-rgb' },
{ key: 'done', icon: 'check_circle', label: 'Hechas', full: 'Completadas', varColor: '--color-done', varRgb: '--color-done-rgb' },
{ key: 'cancelled', icon: 'cancel', label: 'Canceladas', full: 'Canceladas', varColor: '--color-danger', varRgb: '--color-danger-rgb' },
```
En cada botón de esas tarjetas, reemplazar `title={`Filtrar por: ${cfg.label}`}` por `data-tip={`Filtrar por: ${cfg.full}`}` y `aria-label={`Filtrar por: ${cfg.full}`}`. En la tarjeta "Retrasadas" reemplazar `title="Filtrar por: Retrasadas"` por `data-tip="Filtrar por: Retrasadas" aria-label="Filtrar por: Retrasadas"`. En la tarjeta de Usuarios, cambiar el texto de `stat-label` a `Usuarios` (ya lo es) y su `title`, si lo tiene, a `data-tip`. Cambiar el `<span className="stat-icon-box …">` de tamaño `fontSize: '24px'` a `26px`.

CSS en `src/App.css`: reemplazar las reglas existentes `.stat-card`, `.stat-icon-box`, `.stat-label` por:

```css
.stat-card {
  padding: 1rem 1.25rem;
  border-radius: 16px;
  display: flex;
  align-items: center;
  gap: 0.9rem;
}

.stat-icon-box {
  width: 46px;
  height: 46px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: var(--transition-smooth);
}

.stat-label {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--text-muted);
}
```
(Mantener `.stat-info`, `.stat-value` tal cual. Si `.stat-label` se usa fuera de las tarjetas, comprobar con `grep -n "stat-label" src/*.tsx` que el cambio de mayúsculas es aceptable allí.)

- [ ] **Step 3: Cabecera**

Reemplazar el contenido de `<div className="header-actions">` (desde el bloque `online-now` hasta el botón de logout) por:

```tsx
<div className="header-actions">
  {onlineNow.length > 0 && (
    <div className="online-now" data-tip={`En línea: ${onlineNow.map(p => p.username).join(', ')}`}>
      <span className="online-now-dot" />
      <div className="online-now-avatars">
        {onlineNow.slice(0, 4).map(p => <Avatar key={p.username} name={p.username} size={24} />)}
        {onlineNow.length > 4 && <span className="team-member-avatar team-member-avatar-more">+{onlineNow.length - 4}</span>}
      </div>
    </div>
  )}
  <IconButton icon={theme === 'dark' ? 'light_mode' : 'dark_mode'} label="Cambiar tema" onClick={toggleTheme} />
  {(!isAdmin || viewingUserAsAdmin || viewingTeam) && (
    <IconButton icon="history" label="Historial" onClick={() => setIsHistoryModalOpen(true)} />
  )}
  {(!isAdmin || viewingUserAsAdmin || viewingTeam) && (
    <IconButton icon="delete_sweep" label="Limpiar tablero" variant="danger" onClick={handleClearBoard} />
  )}
  {isAdmin && !viewingTeam && (
    <>
      <IconButton icon="key" label="Cambiar mi contraseña" onClick={openPasswordModal} />
      <IconButton icon="forward_to_inbox" label="Correo de avisos" onClick={() => void openMailModal()} />
      <IconButton icon="person_add" label="Nuevo usuario" onClick={openCreateUserModal} />
    </>
  )}
  <button className="btn btn-primary" onClick={() => openCreateModal()} style={{ gap: '0.4rem', whiteSpace: 'nowrap' }}>
    <span className="material-symbols-rounded">add</span> Nueva tarea
  </button>
  <IconButton icon="logout" label="Cerrar sesión" onClick={handleLogout} />
</div>
```

- [ ] **Step 4: Fila de usuario (§6 del spec)**

Reemplazar el bloque `<div className="admin-user-info"> … </div>` (todo el contenido de la columna izquierda de `admin-user-row`, hasta justo antes de `<div className="user-status-columns" …>`) por:

```tsx
<div className="admin-user-info">
  <div className="user-card">
    <Avatar name={displayName} size={44} online={userIsOnline} />
    <div className="user-card-body">
      <div className="user-card-top">
        <div className="user-card-names">
          <span className="admin-username">{displayName}</span>
          <span className="admin-user-handle">@{u.username}</span>
        </div>
        <div className="user-card-actions">
          <IconButton icon="mail" label="Editar correo" variant="tonal" size={32} onClick={(e) => openEmailEditor(u, e)} />
          <IconButton icon="delete" label="Eliminar usuario" variant="danger" size={32} onClick={(e) => handleDeleteUser(u.username, e)} />
        </div>
      </div>
      <div className="user-card-chips">
        <Meta icon="schedule" tip={`Última sesión: ${new Date(u.lastLogin).toLocaleString()}`}>
          {new Date(u.lastLogin).toLocaleDateString()}
        </Meta>
        {u.email ? (
          <Meta icon="mail" tip={u.email}><span className="chip-ellipsis">{u.email}</span></Meta>
        ) : (
          <span className="chip-missing" data-tip="Este usuario no recibirá avisos hasta registrar un correo">
            <Icon name="warning" size={14} /> Sin correo
          </span>
        )}
        <Meta icon="task_alt" tip={`${userActs.length} ${userActs.length === 1 ? 'actividad' : 'actividades'}`}>
          {userActs.length}
        </Meta>
        {overdueTotal > 0 && (
          <Meta icon="alarm" tip={`${overdueTotal} ${overdueTotal === 1 ? 'tarea retrasada' : 'tareas retrasadas'}`} tone="danger">
            {overdueTotal}
          </Meta>
        )}
      </div>
    </div>
  </div>
</div>
```

CSS: **eliminar** las reglas `.admin-user-head`, `.admin-user-names`, `.admin-user-head .delete-user-btn`, `.delete-user-btn*`, `.edit-email-btn*`, `.overdue-user-badge`, y en `.admin-user-row` **quitar `overflow: hidden`**. Agregar:

```css
.user-card {
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 0.85rem;
  align-items: start;
}

.user-card-body {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  min-width: 0;
}

.user-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.5rem;
}

.user-card-names {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.admin-username {
  font-weight: 700;
  font-size: 1.05rem;
  line-height: 1.25;
}

.admin-user-handle {
  font-size: 0.78rem;
  color: var(--text-muted);
}

.user-card-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
  opacity: 0.65;
  transition: opacity 0.2s ease;
}

.admin-user-row:hover .user-card-actions,
.user-card-actions:focus-within {
  opacity: 1;
}

.user-card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem 0.9rem;
  align-items: center;
}

.chip-ellipsis {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.chip-missing {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.05rem 0.5rem;
  border-radius: 999px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-todo);
  border: 1px dashed rgba(var(--color-todo-rgb), 0.6);
}
```

- [ ] **Step 5: Equipos y chips de usuario**

- En la tarjeta de equipo, reemplazar el `<button … className="btn btn-secondary btn-icon-only delete-user-btn team-card-delete" …>` por:

```tsx
<IconButton icon="delete" label="Eliminar equipo" variant="danger" size={30} className="team-card-delete" onClick={(e) => handleDeleteTeam(t.id, t.name, e)} />
```
- En los chips del panel de usuarios, reemplazar el `<button … className="user-chip-delete" …>` por:

```tsx
<IconButton icon="close" label={`Eliminar a ${displayName}`} variant="danger" size={22} className="user-chip-delete" onClick={(e) => handleDeleteUser(u.username, e)} />
```
- CSS: dejar `.team-card-delete { position: absolute; top: 0.6rem; right: 0.6rem; opacity: 0.65; }` con `.team-card:hover .team-card-delete { opacity: 1; }` (revisar la regla actual de `.team-card-delete` y quitar lo que dependa de `.delete-user-btn`); `.user-chip-delete` conserva solo su posición absoluta, sin colores crudos.
- Reemplazar en las etiquetas de Equipos (`team-chip`, `teams-collapsed`) los textos "Mostrar todos" / "Minimizar" por botones con ícono + etiqueta corta: `expand_more` "Todos" / `expand_less` "Minimizar" (el tooltip lleva la frase completa "Mostrar todos los equipos").

- [ ] **Step 6: Mini-tarjetas del mapa de actividades**

En los cuatro bloques `Todo/Doing/Done/Cancelled mini list`, reemplazar el `userActs.filter(a => a.status === '<s>').map(a => { … return ( <div key={a.id} className="admin-mini-card …"> … </div> ); })` por:

```tsx
{userActs.filter(a => a.status === 'todo').map(a => (
  <MiniTaskCard key={a.id} act={a} today={today} overdue={isOverdue(a)} status="todo" />
))}
```
(análogo para `doing`, `done`, `cancelled`). Cambiar las etiquetas de columna a íconos + nombres cortos: `● Por Realizar (n)` → `<Icon name="assignment" size={14} /> Por hacer (n)`, `● En Realización` → `schedule` "En curso", `● Realizado` → `check_circle` "Hecho", `● Cancelado` → `cancel` "Cancelado"; y reemplazar el color crudo `#d93025` del rótulo de Cancelado por `var(--color-danger)`.

CSS: agregar

```css
.mini-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 0.4rem;
  margin-bottom: 0.2rem;
}

.mini-card-flags {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-shrink: 0;
}

.mini-card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.2rem 0.7rem;
  margin-top: 0.25rem;
}
```
y eliminar `.overdue-mini-note`, `.overdue-date` (ya no se usan; la fecha vencida se comunica con el `Meta` rojo de `TaskDates`). Eliminar `overdueLabel` del import si quedó sin uso.

- [ ] **Step 7: Verificar**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx oxlint src/ && npm run build`
Expected: limpio.

Navegador (copia sin `smtp_*`, 1440 px, claro y oscuro), como admin:
1. Tarjetas: ícono en círculo, número y etiqueta corta de una línea; Canceladas en rojo; el filtro y el estado activo siguen funcionando.
2. Fila de usuario: con nombre largo (Ruben Alberto Hernández Zumuano), usuario sin correo (chip punteado), con retrasos (ícono rojo), en línea (punto en el avatar). Todo con el mismo borde izquierdo, sin superposiciones. Botones de correo y borrar visibles, atenuados; al pasar el cursor se intensifican y muestran tooltip.
3. Clic en "Eliminar usuario" abre el diálogo de confirmación (cancelar sin borrar). Clic en correo abre el editor.
4. Mini-tarjetas: bandera de prioridad, fechas "12 oct → 20 oct", `⏰ N d` en rojo si está retrasada.
5. Filtros y panel de Equipos minimizado siguen funcionando (activar "Retrasadas").
Capturas en ambos temas.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ui): icon-first admin dashboard, user row redesign, tonal icon buttons"
```

---

### Task 3: Tablero personal (cabecera, columnas, tarjetas)

**Files:**
- Modify: `src/App.tsx`, `src/App.css`

**Interfaces:**
- Consumes: `TaskCardBody`, `Icon` de `src/ui.tsx`.

- [ ] **Step 1: Importar `TaskCardBody`**

Ampliar el import: `import { Icon, IconButton, Avatar, Meta, MiniTaskCard, TaskCardBody } from './ui';`

- [ ] **Step 2: Cabeceras de columna**

Reemplazar los tres `<span className="column-title" style={{ color: 'var(--color-…)' }}>● … </span>` por:

```tsx
<span className="column-title" style={{ color: 'var(--color-todo)' }}><Icon name="assignment" size={20} /> Por hacer</span>
<span className="column-title" style={{ color: 'var(--color-doing)' }}><Icon name="schedule" size={20} /> En curso</span>
<span className="column-title" style={{ color: 'var(--color-done)' }}><Icon name="check_circle" size={20} /> Hecho</span>
```
(`Por hacer`, `En curso`, `Hecho` sustituyen a "Por Realizar", "En Realización", "Realizado".)

- [ ] **Step 3: Cuerpo de las tarjetas**

En las tres columnas (`todo`, `doing`, `done`), conservar **sin cambios** el `<div key={act.id} className=… draggable onDragStart onDragEnd onClick>` y reemplazar **todo su contenido** (desde `<div className="task-header" …>` hasta el último `</div>` del `task-footer`) por una sola línea:

```tsx
<TaskCardBody act={act} today={today} overdue={isOverdue(act)} />
```
- Columna `doing`: `<TaskCardBody act={act} today={today} overdue={isOverdue(act)} showProgress />`
- Columna `done`: `<TaskCardBody act={act} today={today} overdue={false} onArchive={() => void setActivityArchived(act.id, true)} />`

- [ ] **Step 4: CSS de tarjetas**

Reemplazar `.priority-badge`, `.archive-btn`, `.task-dates`, `.task-owner` por estas reglas y eliminar `.overdue-badge`:

```css
.task-badges {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.task-archive {
  margin-left: auto;
}

.task-progress {
  width: 100%;
  height: 6px;
  background: rgba(var(--overlay-rgb), 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.task-progress-fill {
  height: 100%;
  background: var(--color-doing);
  transition: width 0.3s ease;
}

.task-dates {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.2rem 0.7rem;
}

.task-assigned-by {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.72rem;
  color: var(--text-muted);
}
```
Comprobar con `grep -n "priority-badge\|archive-btn\|task-owner\|overdue-badge" src/*.tsx src/App.css`; si `priority-badge`/`prio-*` siguen usándose (p. ej. en `StatsPage`/historial), dejar esas reglas y borrar solo las huérfanas.

- [ ] **Step 5: Botones de la cabecera del tablero y "Mis equipos"**

Ya migrados en Task 2 (Step 3). Verificar que "Mis equipos:" y los `team-pill` conserven su comportamiento; reemplazar el texto "Mis equipos:" por el ícono `groups` con tooltip "Mis equipos".

- [ ] **Step 6: Verificar (incluye arrastrar y soltar)**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx oxlint src/ && npm run build`
Expected: limpio.

Navegador (copia sin `smtp_*`, login como un usuario con tareas): claro y oscuro.
1. Tarjetas con bandera de prioridad, fechas cortas, avatar, `⏰ N d` si está retrasada; la zona expandible al pasar el cursor sigue funcionando (`.task-expand`).
2. Doing: barra y porcentaje; Done: botón de archivar con ícono (clic archiva y la tarjeta sale al Historial; no abre el modal).
3. **DnD:** disparar `DragEvent` reales con `javascript_tool` (el `left_click_drag` no sirve, ver CLAUDE.md): arrastrar una tarjeta de "Por hacer" a "En curso" y comprobar que cambia de columna; soltar sobre la zona de cancelar tras >550 ms y comprobar que aparece el diálogo de confirmación y que, al soltar rápido en una columna, la zona de cancelar NO queda visible.
4. Los tooltips de las banderas y fechas no quedan recortados por la tarjeta (si lo están, añadir `overflow: visible` a `.task-card` o `data-tip-pos` hacia abajo y ledgerarlo).
Capturas en ambos temas.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ui): icon-first board cards and column headers"
```

---

### Task 4: Modales

**Files:**
- Modify: `src/App.tsx`, `src/App.css`

**Interfaces:**
- Consumes: `FieldLabel`, `Segmented`, `Icon`, `IconButton`.

- [ ] **Step 1: Importar**

`import { Icon, IconButton, Avatar, Meta, MiniTaskCard, TaskCardBody, FieldLabel, Segmented } from './ui';`

- [ ] **Step 2: Etiquetas con ícono (script)**

Ejecutar este script desde la raíz del repo; reemplaza cada `<label className="form-label">TEXTO</label>` conocido por `<FieldLabel icon="…">TEXTO</FieldLabel>` y **lista** las etiquetas no mapeadas para revisarlas a mano:

```bash
python3 - <<'EOF'
import re
p='src/App.tsx'
s=open(p).read()
icons={
 'Asignar A':'person','Título':'title','Descripción':'notes','Fecha Inicio':'event','Fecha Fin':'event_available',
 'Porcentaje de Avance':'donut_small','Nombre de Usuario (Username)':'badge','Nombre y Apellido':'person',
 'Correo electrónico':'mail','Tipo de Usuario':'shield_person','Contraseña del Administrador':'lock',
 'Tu contraseña de administrador':'admin_panel_settings','Contraseña actual':'lock','Nueva contraseña':'lock_reset',
 'Confirmar nueva contraseña':'lock_reset','Servidor SMTP':'dns','Puerto':'tag',
 'Usuario (cuenta de inicio de sesión)':'account_circle','Contraseña de aplicación':'key','Remitente (De)':'forward_to_inbox',
 'Contraseña de Admin':'lock',
}
unmapped=set()
def sub(m):
    t=m.group(1)
    if t in icons: return f'<FieldLabel icon="{icons[t]}">{t}</FieldLabel>'
    unmapped.add(t); return m.group(0)
s=re.sub(r'<label className="form-label">([^<{]+)</label>',sub,s)
open(p,'w').write(s)
print('sin mapear:',sorted(unmapped))
EOF
```
Para cada etiqueta sin mapear (p. ej. las del modal de equipo), elegir un ícono coherente y repetir el reemplazo a mano. Quedan sin cambiar las etiquetas con expresiones (`{…}`), que se editan manualmente si las hay.

- [ ] **Step 3: Estado y Prioridad como botones de selección**

En el modal de tarea, reemplazar el `<div className="form-group">` del **Estado** (con su `<select>`) por:

```tsx
<div className="form-group">
  <FieldLabel icon="flag_circle">Estado</FieldLabel>
  <Segmented
    ariaLabel="Estado"
    value={status as 'todo' | 'doing' | 'done'}
    onChange={(v) => setStatus(v)}
    options={[
      { value: 'todo', label: 'Por hacer', icon: 'assignment', color: '--color-todo' },
      { value: 'doing', label: 'En curso', icon: 'schedule', color: '--color-doing' },
      { value: 'done', label: 'Hecho', icon: 'check_circle', color: '--color-done' },
    ]}
  />
</div>
```
y el de **Prioridad** (con su `<select>`) por:

```tsx
<div className="form-group">
  <FieldLabel icon="flag">Prioridad</FieldLabel>
  <Segmented
    ariaLabel="Prioridad"
    value={priority}
    onChange={(v) => setPriority(v)}
    options={[
      { value: 'alta', label: 'Alta', icon: 'flag', color: '--color-danger' },
      { value: 'media', label: 'Media', icon: 'flag', color: '--color-todo' },
      { value: 'baja', label: 'Baja', icon: 'flag', color: '--color-done' },
    ]}
  />
</div>
```
(El estado `status` del componente incluye `'cancelled'` en su tipo; el modal nunca lo ofrece, como hoy. Si `tsc` se queja del `as`, ajustar el tipo del `onChange` a `(v) => setStatus(v)` sin cast.)

- [ ] **Step 4: Cabeceras de modal con ícono y pies sin duplicados**

- Títulos con ícono delante (`<Icon name="…" />`): Nueva/Editar Actividad `add_task`/`edit_note`, Nuevo equipo `group_add`, Historial `history`, Confirmación `help` (los de usuario, contraseña, correo y diálogo de correo ya tienen ícono).
- En los modales con botón **X** en la cabecera, quitar el botón "Cancelar" duplicado del pie. **Se conserva** "Cancelar" + "Confirmar" en el diálogo de confirmación (necesitan palabras explícitas).
- En el pie del modal de tarea, el botón "Eliminar" pasa a `<IconButton icon="delete" label="Eliminar actividad" variant="danger" … />` con `marginRight: 'auto'` (queda a la izquierda); "Guardar" conserva su palabra con ícono `check`.

- [ ] **Step 5: Verificar**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx oxlint src/ && npm run build`
Expected: limpio.

Navegador (claro y oscuro): abrir Nueva Actividad, Editar actividad, Nuevo equipo, Nuevo usuario, Cambiar contraseña, Correo de avisos, Historial y el diálogo de confirmación; comprobar:
1. Estado/Prioridad se eligen con los botones; elegir "En curso" muestra el control de avance; guardar crea la tarea con los valores correctos (comprobar en el tablero).
2. Etiquetas con ícono, alineadas; sin etiquetas sin mapear.
3. El diálogo de correo obligatorio sigue sin botón de cierre; el de edición se cierra con X o clic fuera.
4. Confirmación de borrado sigue mostrando Cancelar/Confirmar.
Capturas en ambos temas.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat(ui): icon labels and selection buttons in modals"
```

---

### Task 5: Productividad y login

**Files:**
- Modify: `src/StatsPage.tsx`, `src/App.tsx` (login), `src/App.css`

- [ ] **Step 1: Productividad — tarjetas de resumen**

En `src/StatsPage.tsx` importar `import { Icon, Meta } from './ui';` y reemplazar cada `<div className="glass-panel stats-hero" …>` por una versión con ícono y etiqueta corta, p. ej.:

```tsx
<div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-todo)' }}>
  <div className="stats-hero-top">
    <Icon name="assignment" size={22} style={{ color: 'var(--color-todo)' }} />
    <span className="stats-hero-label">Por hacer</span>
  </div>
  <span className="stats-hero-value" style={{ color: 'var(--color-todo)' }}>{overallTodoRate}%</span>
</div>
```
con los pares (ícono, etiqueta, token): `assignment`/"Por hacer"/`--color-todo`; `schedule`/"En curso"/`--color-doing`; `check_circle`/"Hechas"/`--color-done`; `cancel`/"Canceladas"/`--color-danger`; `alarm`/"Retrasadas"/`--color-danger` (esta última conserva `{overall.overdue} ({overallOverdueShare}%)`), y `data-tip` con la frase completa ("Tasa de finalización", etc.). CSS: `.stats-hero-top { display: flex; align-items: center; gap: 0.4rem; }`.

- [ ] **Step 2: Productividad — leyenda y filas**

- Leyenda: cada `stats-legend-item` pasa a ícono + etiqueta corta (mismos pares).
- Fila de usuario: reemplazar el bloque `stats-row-rate` por chips compactos:

```tsx
<span className="stats-row-rate">
  <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-todo)' }} data-tip="Por realizar"><Icon name="assignment" size={14} />{r.todoRate}%</span>
  <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-doing)' }} data-tip="En proceso"><Icon name="schedule" size={14} />{r.doingRate}%</span>
  <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-done)' }} data-tip="Completado"><Icon name="check_circle" size={14} />{r.rate}%</span>
  <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-danger)' }} data-tip="Cancelado"><Icon name="cancel" size={14} />{r.cancelRate}%</span>
</span>
```
y el bloque `stats-row-counts` por:

```tsx
<div className="stats-row-counts">
  <Meta icon="assignment" tip="Por realizar">{r.todo}</Meta>
  <Meta icon="schedule" tip="En proceso">{r.doing}</Meta>
  <Meta icon="check_circle" tip="Completadas">{r.done}</Meta>
  <Meta icon="cancel" tip="Canceladas">{r.cancelled}</Meta>
  <Meta icon="alarm" tip="Retrasadas" tone={r.overdue > 0 ? 'danger' : undefined}>{r.overdue}</Meta>
  <Meta icon="functions" tip="Total">{r.total}</Meta>
</div>
```
En el nombre, la etiqueta de retrasadas pasa a `Meta`: `<Meta icon="alarm" tip={`${r.overdue} retrasadas · ${r.overdueShare}% de las abiertas`} tone="danger">{r.overdue} · {r.overdueShare}%</Meta>`. CSS:

```css
.rate-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--c);
  background: rgba(var(--overlay-rgb), 0.06);
}
```
Verificar que `.stats-row-counts` use `display:flex; gap` para los `Meta` (ajustar si hoy usa `justify-content: space-between` con spans de texto).

- [ ] **Step 3: Login**

En `src/App.tsx` (pantalla de login): quitar el subtítulo largo si ocupa más de una línea corta (conservar "Gestiona tus tareas" como máximo), añadir ícono de persona al campo de usuario con el mismo patrón de posición absoluta que usaba el campo de contraseña de admin (`<span className="material-symbols-rounded" style={{ position:'absolute', left:'1rem', top:'50%', transform:'translateY(-50%)', color:'var(--text-muted)', fontSize:'20px' }}>person</span>`, con `paddingLeft: '2.5rem'` en el input), cambiar la etiqueta "Nombre de Usuario" por `FieldLabel icon="person"`, la de "Contraseña de Admin" por `FieldLabel icon="lock"`, y el botón a:

```tsx
<button type="submit" className="btn btn-primary" style={{ gap: '0.5rem' }}>
  <span className="material-symbols-rounded">login</span> Entrar
</button>
```

- [ ] **Step 4: Verificar**

Run: `npx tsc --noEmit -p tsconfig.app.json && npx oxlint src/ && npm run build && npm run test:server`
Expected: todo en verde.

Navegador (claro y oscuro): `#stats` (tarjetas con ícono, filas con chips, un usuario con retrasos y otro sin tareas) y login (campo con ícono, "Entrar", error "Ese usuario no existe…" sigue visible, campo de contraseña de admin aparece para admins). Capturas.

- [ ] **Step 5: Verificación final y documentación**

- `grep -n "title=\"" src/App.tsx src/StatsPage.tsx` y confirmar que los `title` restantes son solo los que no pertenecen a íconos migrados.
- `grep -n "#[0-9a-fA-F]\{3,6\}\b\|rgba(255" src/App.css` y comprobar que no se introdujeron colores crudos nuevos (los preexistentes se dejan; si quedan reglas huérfanas `.delete-user-btn`, `.edit-email-btn`, `.overdue-*` antiguas, eliminarlas).
- Actualizar `CLAUDE.md`: sección corta "UI primitives" que diga que `src/ui.tsx` contiene las primitivas presentacionales (`IconButton`, `Avatar`, `Meta`, `TaskCardBody`, `MiniTaskCard`, `Segmented`…), que los tooltips son `data-tip` (no `title`), que las tarjetas del tablero conservan su `<div draggable>` en `App.tsx`, y que la fecha corta vive en `src/dates.ts`.
- `README.md`: una línea en Features sobre la interfaz "primero íconos".

- [ ] **Step 6: Commit**

```bash
git add src CLAUDE.md README.md
git commit -m "feat(ui): icon-first productivity page and login; docs"
```
