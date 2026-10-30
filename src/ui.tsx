import { useEffect, useRef, useState, useMemo } from 'react';
import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import type { ToastState } from './useToast';
import type { Activity, User } from './db';
import { subscribeUsers } from './db';
import { AvatarPhotosContext, buildPersonLookup, useAvatarPerson } from './avatarContext';
import { daysOverdue, formatShortDate } from './dates';
import { describeRepeat, kindClass } from './taskKinds';
import type { SharedStats } from './taskKinds';

// Presentational primitives for the icon-first UI. No business state lives here.

// The single tooltip for every [data-tip] in the app. It follows the INNERMOST hovered element (so a
// parent's tip never shows under a child's), is positioned in the viewport (so overflow containers
// like modals can't clip it), flips below the element when there is no room above, and is clamped
// to the window's edges. Keyboard focus shows it too. Rendered once, in main.tsx.
export function TooltipLayer() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tip = ref.current;
    // No hover on touch screens: a tooltip would never close.
    if (!tip || (window.matchMedia && window.matchMedia('(hover: none)').matches)) return;

    const MARGIN = 8;
    let target: HTMLElement | null = null;
    let timer = 0;
    let raf = 0;

    const hide = () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(raf);
      target = null;
      tip.classList.remove('is-visible');
    };

    // Re-positions every frame while visible: the element may move, change its text or disappear
    // (a live update can remove the card under the cursor).
    const place = () => {
      if (!target || !target.isConnected) return hide();
      const text = target.getAttribute('data-tip');
      if (!text) return hide();
      if (tip.textContent !== text) tip.textContent = text;
      const r = target.getBoundingClientRect();
      const t = tip.getBoundingClientRect();
      const above = r.top - t.height - MARGIN;
      const top = above >= MARGIN ? above : r.bottom + MARGIN;
      // The bounce grows out of the side that touches the element.
      const side = above >= MARGIN ? 'above' : 'below';
      if (tip.dataset.side !== side) tip.dataset.side = side;
      const left = Math.min(Math.max(MARGIN, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - MARGIN);
      tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      raf = requestAnimationFrame(place);
    };

    const show = (el: HTMLElement) => {
      target = el;
      tip.classList.add('is-visible');
      place();
    };

    const tipOf = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>('[data-tip]') : null);

    const onOver = (e: PointerEvent) => {
      const el = tipOf(e.target);
      if (el && el === target) return;
      hide();
      if (el) timer = window.setTimeout(() => show(el), 350);
    };
    const onLeaveWindow = (e: PointerEvent) => { if (!e.relatedTarget) hide(); };
    const onFocusIn = (e: FocusEvent) => {
      const el = tipOf(e.target);
      hide();
      if (el && el.matches(':focus-visible')) show(el);
    };

    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onLeaveWindow);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('dragstart', hide, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onLeaveWindow);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('dragstart', hide, true);
      document.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  return <div ref={ref} className="tip-layer" role="tooltip" aria-hidden="true" />;
}

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

const initialsOf = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
};

// Supplies each person's photo and display name to every <Avatar> below it (subscribes to the live users list itself).
export function PhotoProvider({ children }: { children: ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => subscribeUsers(setUsers), []);
  const lookup = useMemo(() => buildPersonLookup(users), [users]);
  return <AvatarPhotosContext.Provider value={lookup}>{children}</AvatarPhotosContext.Provider>;
}

// Color = presence, not identity: green when online, gray otherwise. `online` is
// undefined where presence isn't known; that renders like offline (gray) with no status text.
// Shows the person's profile photo when they have one, their initials otherwise.
export function Avatar({ name, size = 36, online }: { name: string; size?: number; online?: boolean }) {
  const on = online === true;
  const token = on ? '--color-done' : '--color-secondary';
  // Whatever name the screen passed (username or full name), the avatar shows the same person the same way.
  const person = useAvatarPerson(name);
  const label = person?.label ?? name;
  const photo = person?.photo;
  const tip = online === undefined ? label : `${label} · ${on ? 'en línea' : 'desconectado'}`;
  const [failed, setFailed] = useState<string | null>(null);
  return (
    <span
      className="avatar"
      style={{ ['--sz' as string]: `${size}px`, ['--av' as string]: `var(${token})`, ['--av-rgb' as string]: `var(${token}-rgb)` }}
      data-tip={tip}
      role="img"
      aria-label={tip}
    >
      {photo && failed !== photo
        ? <img className="avatar-img" src={photo} alt="" draggable={false} onError={() => setFailed(photo)} />
        : initialsOf(label)}
      {on && <span className="avatar-online" />}
    </span>
  );
}

// Everyone who has a copy of a shared task, overlapping like a group of faces.
export function AvatarStack({ members, max = 4, size = 24 }: { members: { name: string; online?: boolean }[]; max?: number; size?: number }) {
  const shown = members.slice(0, max);
  const extra = members.length - shown.length;
  const tip = `Participan: ${members.map(m => m.name).join(', ')}`;
  return (
    <span className="avatar-stack" data-tip={tip} role="img" aria-label={tip}>
      {shown.map(m => <Avatar key={m.name} name={m.name} size={size} online={m.online} />)}
      {extra > 0 && <span className="avatar-stack-more" style={{ ['--sz' as string]: `${size}px` }}>+{extra}</span>}
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

export function Meta({ icon, tip, children, tone }: { icon: string; tip: string; children: ReactNode; tone?: 'danger' | 'shared' | 'recurring' | 'unread' }) {
  return (
    <span className={`meta ${tone ? `meta-${tone}` : ''}`} data-tip={tip}>
      <Icon name={icon} size={14} />
      <span className="sr-only">{tip}: </span>
      {children}
    </span>
  );
}

// What sets a shared or repeating task apart: its own icon and color. Nothing for a normal task.
export function KindBadge({ act, sharedStats }: { act: Activity; sharedStats?: SharedStats }) {
  if (act.kind === 'shared') {
    const avg = sharedStats?.average;
    const tip = `Tarea compartida${sharedStats ? ` · ${sharedStats.people} ${sharedStats.people === 1 ? 'persona' : 'personas'}` : ''}${avg != null ? ` · avance del equipo ${avg}%` : ''}`;
    return <Meta icon="groups" tip={tip} tone="shared">{avg != null ? `${avg}%` : 'Compartida'}</Meta>;
  }
  if (act.kind === 'recurring') {
    const rule = describeRepeat(act);
    return <Meta icon="event_repeat" tip={`Tarea repetitiva · ${rule.label.toLowerCase()}`} tone="recurring">{rule.short}</Meta>;
  }
  return null;
}

export function TaskDates({ start, end, overdueDays }: { start: string; end: string; overdueDays?: number }) {
  // A repeating task has no end date: show only the day this one was generated.
  if (!end) {
    return <Meta icon="calendar_month" tip={`Generada el ${start}`}>{formatShortDate(start)}</Meta>;
  }
  return (
    <>
      <Meta icon="calendar_month" tip={`Del ${start} al ${end}`}>
        {formatShortDate(start)} <Icon name="arrow_right_alt" size={14} /> {formatShortDate(end)}
      </Meta>
      {overdueDays !== undefined && overdueDays > 0 && (
        <Meta icon="alarm" tip={overdueDays === 1 ? `Retrasada: venció ayer (debía terminar el ${end})` : `Retrasada: venció hace ${overdueDays} días (debía terminar el ${end})`} tone="danger">
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

// Options can carry a `count` (a number shown next to the icon). With `iconOnly` the text label is
// not drawn: it stays as the accessible name and the tooltip.
export function Segmented<T extends string>({
  value, onChange, options, ariaLabel, iconOnly,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon: string; color: string; count?: number }[];
  ariaLabel: string;
  iconOnly?: boolean;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel}>
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          aria-label={iconOnly ? `${o.label}${o.count !== undefined ? ` (${o.count})` : ''}` : undefined}
          data-tip={iconOnly ? o.label : undefined}
          className={`segmented-option ${value === o.value ? 'is-selected' : ''}`}
          style={{ ['--seg' as string]: `var(${o.color})`, ['--seg-rgb' as string]: `var(${o.color}-rgb)` }}
          onClick={() => onChange(o.value)}
        >
          <Icon name={o.icon} size={iconOnly ? 22 : 18} />
          {!iconOnly && o.label}
          {o.count !== undefined && <span className="segmented-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Body of a board card (title, flags, progress, expandable details, footer). The wrapper
// <div draggable …> with every drag handler stays in App.tsx.
export function TaskCardBody({
  act, today, overdue, showProgress, onArchive, onEdit, ownerOnline, sharedStats, selectMode, selected,
}: {
  act: Activity;
  today: string;
  overdue: boolean;
  showProgress?: boolean;
  onArchive?: () => void;
  onEdit?: () => void;
  ownerOnline?: boolean;
  sharedStats?: SharedStats;
  // "Seleccionar para archivar": the card shows a checkbox and its edit/archive buttons are hidden.
  selectMode?: boolean;
  selected?: boolean;
}) {
  // A shared task shows the TEAM's progress (the average), in every column, never one person's own.
  const teamProgress = act.kind === 'shared' && sharedStats !== undefined;
  const barValue = teamProgress ? sharedStats.average : showProgress ? (act.progress ?? 50) : null;
  return (
    <>
      <div className="task-header" style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', alignItems: 'stretch' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}>
          {selectMode && (
            <Icon name={selected ? 'check_box' : 'check_box_outline_blank'} size={22} className={`select-box ${selected ? 'is-on' : ''}`} />
          )}
          <h4 className="task-title" style={selectMode ? { flex: 1 } : undefined}>{act.title}</h4>
          {!onEdit && !selectMode && <Icon name="edit" size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        </div>
        <div className="task-badges">
          <PriorityFlag priority={act.priority} />
          <KindBadge act={act} sharedStats={sharedStats} />
          {teamProgress && (sharedStats.unread ?? 0) > 0 && (
            <Meta icon="mark_chat_unread" tip={`${sharedStats.unread} ${sharedStats.unread === 1 ? 'comentario nuevo' : 'comentarios nuevos'}`} tone="unread">
              {sharedStats.unread}
            </Meta>
          )}
          {showProgress && !teamProgress && (
            <Meta icon="donut_small" tip="Avance">{act.progress ?? 50}%</Meta>
          )}
          {(onEdit || onArchive) && (
            <div className="task-actions">
              {onArchive && (
                <IconButton
                  icon="inventory_2"
                  label="Archivar"
                  size={28}
                  draggable={false}
                  onClick={(e) => { e.stopPropagation(); onArchive(); }}
                />
              )}
              {onEdit && (
                <IconButton
                  icon="edit"
                  label="Editar tarea"
                  size={28}
                  draggable={false}
                  onClick={(e) => { e.stopPropagation(); onEdit(); }}
                />
              )}
            </div>
          )}
        </div>
        {barValue !== null && (
          <div className="task-progress" role="progressbar" aria-label={teamProgress ? 'Avance del equipo' : 'Avance'} aria-valuenow={barValue} aria-valuemin={0} aria-valuemax={100}>
            <div className={`task-progress-fill ${teamProgress ? 'is-team' : ''}`} style={{ width: `${barValue}%` }} />
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
        {act.kind === 'shared' && sharedStats?.members && sharedStats.members.length > 0
          ? <AvatarStack members={sharedStats.members} />
          : <Avatar name={act.username} size={24} online={ownerOnline} />}
      </div>
    </>
  );
}

// Compact card used in the admin dashboard's per-user map.
export function MiniTaskCard({
  act, today, overdue, status, sharedStats,
}: {
  act: Activity;
  today: string;
  overdue: boolean;
  status: 'todo' | 'doing' | 'done' | 'cancelled';
  sharedStats?: SharedStats;
}) {
  return (
    <div className={`admin-mini-card mini-${status} ${overdue ? 'overdue' : ''} ${kindClass(act)}`}>
      <div className="mini-card-top">
        <div className="admin-mini-card-title">{act.title}</div>
        <div className="mini-card-flags">
          {status === 'doing' && act.kind !== 'shared' && <Meta icon="donut_small" tip="Avance">{act.progress ?? 50}%</Meta>}
          {act.archived && <span className="meta" data-tip="Archivada" role="img" aria-label="Archivada"><Icon name="inventory_2" size={14} /></span>}
          <KindBadge act={act} sharedStats={sharedStats} />
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

// Brief status message (e.g. "Archivo exportado"), announced to screen readers.
export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {toast && (
        <div className={`toast ${toast.ok ? 'is-ok' : 'is-error'}`}>
          <Icon name={toast.ok ? 'check_circle' : 'error'} size={20} />
          {toast.text}
        </div>
      )}
    </div>
  );
}
