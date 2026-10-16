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
      data-tip={online ? `${name} · en línea` : name}
      role="img"
      aria-label={online ? `${name} · en línea` : name}
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
