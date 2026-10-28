import { useEffect, useRef, useState } from 'react';
import { subscribeActivities, subscribeUsers, subscribeTeams } from './db';
import type { Activity, User, Team } from './db';
import './App.css';
import { Icon, IconButton, Avatar, Segmented, PriorityFlag, TaskDates, Toast } from './ui';
import { useToast } from './useToast';
import ExportDialog from './ExportDialog';
import { todayString, isOverdue, daysOverdue } from './dates';
import { isLive } from './archive';
import {
  summarizeUser, sortUsers, closeStats, weeklyTrend, agingBuckets, matchesDrill, inPeriod, inScope, periodStart,
  STATUS_META, DONUT_ORDER,
} from './stats';
import type { DonutKey, SortKey, Period, Scope, DrillKey, AgingKey } from './stats';
import { Donut, TrendChart, CountUp } from './StatsCharts';
import { prefersReducedMotion } from './useCountUp';

const PERIODS: Period[] = ['7d', '30d', '90d', 'all'];
const SCOPES: Scope[] = ['personal', 'teams', 'all'];

// Remembered between visits; falls back silently when storage is unavailable.
function loadPref<T extends string>(key: string, allowed: T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* storage unavailable: just don't remember it */ }
}

const AGING: { key: AgingKey; label: string; alpha: number }[] = [
  { key: 'd1_3', label: '1–3 días', alpha: 0.4 },
  { key: 'd4_7', label: '4–7 días', alpha: 0.65 },
  { key: 'd8plus', label: 'Más de 7 días', alpha: 0.95 },
];

const PRIORITY_RANK: Record<Activity['priority'], number> = { alta: 0, media: 1, baja: 2 };

const drillMeta = (key: DrillKey): { title: string; icon: string; color: string } => {
  if (key === 'overdue') return { title: 'Tareas retrasadas', icon: 'alarm', color: '--color-danger' };
  if (key.startsWith('aging:')) {
    const a = AGING.find(x => `aging:${x.key}` === key);
    return { title: `Retrasadas · ${a?.label ?? ''}`, icon: 'hourglass_top', color: '--color-danger' };
  }
  const m = STATUS_META[key as DonutKey];
  return { title: m.full, icon: m.icon, color: m.color };
};

function StatsPage({ onBack }: { onBack: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [usersList, setUsersList] = useState<User[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const { toast, show: showToast } = useToast();
  const [sortBy, setSortBy] = useState<SortKey>('rate');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>(() => loadPref('statsPeriod', PERIODS, 'all'));
  const [scope, setScope] = useState<Scope>(() => loadPref('statsScope', SCOPES, 'personal'));
  const [drill, setDrill] = useState<DrillKey | null>(null);
  const [drillPerson, setDrillPerson] = useState('');
  const [drillSort, setDrillSort] = useState<'end' | 'priority'>('end');
  const drillRef = useRef<HTMLElement | null>(null);
  // The entrance animations (donut, bars) start one frame AFTER the data first arrives, so the
  // elements are first drawn empty and then transition to their real size.
  const [ready, setReady] = useState(prefersReducedMotion);
  // Refreshed every minute so "overdue" updates while the page stays open.
  const [today, setToday] = useState(todayString);
  useEffect(() => {
    const t = setInterval(() => setToday(todayString()), 60_000);
    return () => clearInterval(t);
  }, []);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('theme') as 'dark' | 'light') || 'dark';
  });

  useEffect(() => {
    const unsubActivities = subscribeActivities(setActivities);
    const unsubUsers = subscribeUsers(users => {
      setUsersList(users.filter(u => u.username.toLowerCase() !== 'admin'));
    });
    const unsubTeams = subscribeTeams(setTeams);
    return () => {
      unsubActivities();
      unsubUsers();
      unsubTeams();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-theme', theme === 'dark');
    document.body.classList.toggle('light-theme', theme === 'light');
  }, [theme]);

  // Esc closes the task panel; opening it brings it into view.
  useEffect(() => {
    if (!drill) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrill(null); };
    window.addEventListener('keydown', onKey);
    drillRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
    return () => window.removeEventListener('keydown', onKey);
  }, [drill]);

  const hasData = activities.length > 0;
  useEffect(() => {
    if (!hasData || ready) return;
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, [hasData, ready]);

  const changePeriod = (p: Period) => { setPeriod(p); savePref('statsPeriod', p); };
  const changeScope = (s: Scope) => { setScope(s); savePref('statsScope', s); setDrill(null); };
  const selectDrill = (key: DrillKey) => {
    setDrill(d => (d === key ? null : key));
    setDrillPerson('');
  };

  // Live (non-archived-open) tasks in the chosen scope and period. Team tasks are tracked
  // separately from personal ones, so the default scope matches the admin dashboard.
  const scoped = activities.filter(a => isLive(a) && inScope(a, scope) && inPeriod(a, periodStart(period, new Date())));

  const people = sortUsers(
    usersList.map(u => {
      const mine = scoped.filter(a => a.username.toLowerCase() === u.username.toLowerCase());
      return { username: u.username, displayName: u.fullName || u.username, close: closeStats(mine), ...summarizeUser(mine, today) };
    }),
    sortBy
  );

  const all = summarizeUser(scoped, today);
  const close = closeStats(scoped);
  const trend = weeklyTrend(activities.filter(a => inScope(a, scope)), new Date(), 8);
  const aging = agingBuckets(scoped, today);
  const needAttention = people.filter(p => p.overdue > 0).sort((a, b) => b.overdue - a.overdue);
  const donutActive = drill && DONUT_ORDER.includes(drill as DonutKey) ? (drill as DonutKey) : null;

  const drillTasks = drill ? scoped.filter(a => matchesDrill(a, drill, today)) : [];
  const drillPeople = Array.from(new Set(drillTasks.map(a => a.username)));
  const drillRows = drillTasks
    .filter(a => !drillPerson || a.username === drillPerson)
    .sort((a, b) => drillSort === 'priority'
      ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.endDate.localeCompare(b.endDate)
      : a.endDate.localeCompare(b.endDate));
  const displayName = (username: string) => usersList.find(u => u.username.toLowerCase() === username.toLowerCase())?.fullName || username;

  const openBoard = (username: string) => { window.location.hash = `user-${encodeURIComponent(username)}`; };
  const openTask = (a: Activity) => { window.location.hash = a.teamId ? `team-${a.teamId}` : `user-${encodeURIComponent(a.username)}`; };

  return (
    <div className="stats-page">
      <div className="stats-header" style={{ gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <IconButton icon="arrow_back" label="Volver al tablero" onClick={onBack} size={40} />
          <div>
            <h1 style={{ margin: '0' }}>Productividad</h1>
            <p style={{ margin: '0.2rem 0 0 0' }}>
              <strong>Completado</strong> = hechas ÷ todas sus tareas. <strong>A tiempo</strong> = hechas antes de su fecha de fin. <strong>Retrasadas</strong> = abiertas con la fecha de fin vencida.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <IconButton icon="download" label="Exportar a Excel" onClick={() => setIsExportOpen(true)} size={40} />
          <IconButton
            icon={theme === 'dark' ? 'light_mode' : 'dark_mode'}
            label="Cambiar tema"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            size={40}
          />
        </div>
      </div>

      <div className="stats-filters">
        <Segmented
          ariaLabel="Periodo"
          value={period}
          onChange={changePeriod}
          options={[
            { value: '7d', label: '7 días', icon: 'date_range', color: '--color-primary' },
            { value: '30d', label: '30 días', icon: 'date_range', color: '--color-primary' },
            { value: '90d', label: '90 días', icon: 'date_range', color: '--color-primary' },
            { value: 'all', label: 'Todo', icon: 'all_inclusive', color: '--color-primary' },
          ]}
        />
        <Segmented
          ariaLabel="Alcance"
          value={scope}
          onChange={changeScope}
          options={[
            { value: 'personal', label: 'Personales', icon: 'person', color: '--color-primary' },
            { value: 'teams', label: 'Equipos', icon: 'groups', color: '--color-primary' },
            { value: 'all', label: 'Todas', icon: 'apps', color: '--color-primary' },
          ]}
        />
      </div>
      <p className="stats-filter-note">
        <Icon name="info" size={14} /> El periodo no oculta las tareas abiertas (siempre cuentan); las hechas y canceladas se filtran por su fecha de cierre.
      </p>

      <section className="glass-panel stats-summary">
        <Donut counts={all} rate={all.rate} total={all.total} active={donutActive} onSelect={selectDrill} ready={ready} />

        <div className="stats-summary-side">
          <div className="stats-kpis">
            <button
              type="button"
              className={`stats-kpi is-click ${all.overdue > 0 ? 'is-danger' : ''} ${drill === 'overdue' ? 'is-active' : ''}`}
              onClick={() => selectDrill('overdue')}
              aria-pressed={drill === 'overdue'}
              data-tip="Ver las tareas retrasadas"
            >
              <Icon name="alarm" size={22} />
              <span className="stats-kpi-value"><CountUp value={all.overdue} /></span>
              <span className="stats-kpi-label">Retrasadas</span>
              <span className="stats-kpi-sub">{all.open === 0 ? 'sin tareas abiertas' : `${all.overdueShare}% de ${all.open} abiertas`}</span>
            </button>
            <button
              type="button"
              className={`stats-kpi is-click ${drill === 'doing' ? 'is-active' : ''}`}
              onClick={() => selectDrill('doing')}
              aria-pressed={drill === 'doing'}
              data-tip="Ver las tareas en curso"
            >
              <Icon name="schedule" size={22} style={{ color: 'var(--chart-doing)' }} />
              <span className="stats-kpi-value"><CountUp value={all.doing} /></span>
              <span className="stats-kpi-label">En curso</span>
              <span className="stats-kpi-sub">{all.todo} por hacer</span>
            </button>
            <button
              type="button"
              className={`stats-kpi is-click ${drill === 'done' ? 'is-active' : ''}`}
              onClick={() => selectDrill('done')}
              aria-pressed={drill === 'done'}
              data-tip="Ver las tareas hechas"
            >
              <Icon name="check_circle" size={22} style={{ color: 'var(--chart-done)' }} />
              <span className="stats-kpi-value"><CountUp value={all.done} /></span>
              <span className="stats-kpi-label">Hechas</span>
              <span className="stats-kpi-sub">de {all.total} tareas</span>
            </button>
          </div>

          <div className="stats-kpis stats-kpis-2">
            <div className="stats-kpi" data-tip="Hechas en o antes de su fecha de fin. Solo cuentan las que tienen fecha de completado.">
              <Icon name="verified" size={22} style={{ color: 'var(--chart-done)' }} />
              <span className="stats-kpi-value">
                {close.onTimeRate === null ? '—' : <CountUp value={close.onTimeRate} suffix="%" />}
              </span>
              <span className="stats-kpi-label">A tiempo</span>
              <span className="stats-kpi-sub">{close.withDate === 0 ? 'sin datos de cierre' : `${close.onTime} de ${close.withDate} entregadas`}</span>
            </div>
            <div className="stats-kpi" data-tip="Días promedio desde que se crea una tarea hasta que se completa.">
              <Icon name="timer" size={22} style={{ color: 'var(--chart-doing)' }} />
              <span className="stats-kpi-value">
                {close.avgCloseDays === null ? '—' : <CountUp value={close.avgCloseDays} decimals={1} />}
              </span>
              <span className="stats-kpi-label">Cierre medio</span>
              <span className="stats-kpi-sub">{close.avgCloseDays === null ? 'sin datos de cierre' : 'días por tarea'}</span>
            </div>
          </div>

          <ul className="stats-key" aria-label="Leyenda de colores">
            {DONUT_ORDER.map(k => (
              <li key={k}>
                <button
                  type="button"
                  className={`stats-key-item ${drill === k ? 'is-active' : ''}`}
                  onClick={() => selectDrill(k)}
                  aria-pressed={drill === k}
                  data-tip={`Ver ${STATUS_META[k].full.toLowerCase()}`}
                >
                  <span className="stats-dot" style={{ background: `var(${STATUS_META[k].color})` }} />
                  {STATUS_META[k].label} <strong>{all[k]}</strong>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {drill && (() => {
        const meta = drillMeta(drill);
        return (
          <section className="glass-panel stats-drill animate-fade-in" ref={drillRef} aria-label={meta.title}>
            <div className="stats-drill-head">
              <h2 className="stats-section-title" style={{ color: `var(${meta.color})` }}>
                <Icon name={meta.icon} size={22} /> {meta.title}
                <span className="stats-drill-count">{drillRows.length}</span>
              </h2>
              <div className="stats-drill-tools">
                {drillPeople.length > 1 && (
                  <select
                    className="form-input stats-drill-select"
                    value={drillPerson}
                    onChange={(e) => setDrillPerson(e.target.value)}
                    aria-label="Filtrar por persona"
                  >
                    <option value="">Todas las personas</option>
                    {drillPeople.map(u => <option key={u} value={u}>{displayName(u)}</option>)}
                  </select>
                )}
                <Segmented
                  ariaLabel="Ordenar tareas"
                  value={drillSort}
                  onChange={setDrillSort}
                  options={[
                    { value: 'end', label: 'Fecha fin', icon: 'event', color: '--color-primary' },
                    { value: 'priority', label: 'Prioridad', icon: 'flag', color: '--color-primary' },
                  ]}
                />
                <IconButton icon="close" label="Cerrar (Esc)" onClick={() => setDrill(null)} size={36} />
              </div>
            </div>

            {drillRows.length === 0 ? (
              <p className="stats-empty-note">No hay tareas para mostrar con este filtro.</p>
            ) : (
              <ul className="stats-task-list">
                {drillRows.map(a => (
                  <li key={a.id}>
                    <button type="button" className="stats-task" onClick={() => openTask(a)} data-tip="Abrir el tablero">
                      <Icon name={STATUS_META[a.status as DonutKey].icon} size={20} style={{ color: `var(${STATUS_META[a.status as DonutKey].color})` }} />
                      <span className="stats-task-title">
                        <strong>{a.title}</strong>
                        <small>{a.teamId ? 'Equipo' : 'Personal'} · asignada a {displayName(a.username)}</small>
                      </span>
                      <Avatar name={displayName(a.username)} size={26} />
                      <PriorityFlag priority={a.priority} />
                      <span className="stats-task-dates">
                        <TaskDates start={a.startDate} end={a.endDate} overdueDays={isOverdue(a, today) ? daysOverdue(a.endDate, today) : undefined} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })()}

      <div className="stats-grid-2">
        <section className="glass-panel stats-card">
          <h2 className="stats-section-title"><Icon name="stacked_bar_chart" size={20} /> Tendencia semanal</h2>
          <p className="stats-card-sub">Últimas 8 semanas, con el alcance elegido. Las canceladas no guardan fecha y no aparecen aquí.</p>
          <TrendChart weeks={trend} ready={ready} />
        </section>

        <section className="glass-panel stats-card">
          <h2 className="stats-section-title"><Icon name="hourglass_top" size={20} /> Antigüedad de retrasos</h2>
          <p className="stats-card-sub">Cuántos días llevan vencidas las tareas abiertas.</p>
          {aging.total === 0 ? (
            <p className="stats-empty-note"><Icon name="task_alt" size={18} /> No hay tareas retrasadas.</p>
          ) : (
            <div className="stats-aging">
              {AGING.map(b => {
                const n = aging[b.key];
                return (
                  <button
                    key={b.key}
                    type="button"
                    className={`stats-aging-row ${drill === `aging:${b.key}` ? 'is-active' : ''}`}
                    onClick={() => selectDrill(`aging:${b.key}`)}
                    disabled={n === 0}
                    aria-pressed={drill === `aging:${b.key}`}
                    data-tip={n === 0 ? 'Ninguna en este tramo' : 'Ver estas tareas'}
                  >
                    <span className="stats-aging-label">{b.label}</span>
                    <span className="stats-aging-track">
                      <span
                        className="stats-aging-fill"
                        style={{ width: ready ? `${(n / aging.total) * 100}%` : '0%', background: `rgba(var(--color-danger-rgb), ${b.alpha})` }}
                      />
                    </span>
                    <strong className="stats-aging-n">{n}</strong>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {needAttention.length > 0 && (
        <section className="glass-panel stats-attention">
          <h2 className="stats-section-title">
            <Icon name="notification_important" size={20} /> Necesitan atención
          </h2>
          <div className="stats-attention-list">
            {needAttention.map(p => (
              <button
                key={p.username}
                type="button"
                className="stats-attention-chip"
                onClick={() => openBoard(p.username)}
                data-tip="Abrir su tablero"
              >
                <Avatar name={p.displayName} size={28} />
                <span className="stats-attention-name">{p.displayName}</span>
                <span className="stats-attention-count">
                  <Icon name="alarm" size={14} /> {p.overdue} {p.overdue === 1 ? 'retrasada' : 'retrasadas'}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {people.length === 0 ? (
        <div className="glass-panel stats-empty">
          <p>Todavía no hay usuarios con actividades registradas.</p>
        </div>
      ) : (
        <section>
          <div className="stats-toolbar">
            <h2 className="stats-section-title">Por persona</h2>
            <Segmented
              ariaLabel="Ordenar por"
              value={sortBy}
              onChange={setSortBy}
              options={[
                { value: 'rate', label: 'Completado', icon: 'check_circle', color: '--color-primary' },
                { value: 'overdue', label: 'Retrasadas', icon: 'alarm', color: '--color-danger' },
                { value: 'total', label: 'Total', icon: 'functions', color: '--color-primary' },
              ]}
            />
          </div>

          <div className="stats-people">
            {people.map(p => {
              const isOpen = expanded === p.username;
              return (
                <div className={`glass-panel stats-person ${p.overdue > 0 ? 'has-overdue' : ''}`} key={p.username}>
                  <div className="stats-person-row">
                    <button
                      type="button"
                      className="stats-person-main"
                      onClick={() => setExpanded(isOpen ? null : p.username)}
                      aria-expanded={isOpen}
                    >
                      <Avatar name={p.displayName} size={40} />
                      <span className="stats-person-name">
                        <strong>{p.displayName}</strong>
                        <small>@{p.username}</small>
                      </span>
                      <span className="stats-bar" aria-hidden="true">
                        {DONUT_ORDER.map(k => p[k] > 0 && (
                          <span
                            key={k}
                            className="stats-bar-segment"
                            style={{ width: ready ? `${(p[k] / p.total) * 100}%` : '0%', background: `var(${STATUS_META[k].color})` }}
                          />
                        ))}
                      </span>
                      <span className="stats-person-rate">
                        <strong>{p.total === 0 ? '—' : `${p.rate}%`}</strong>
                        <small>completado</small>
                      </span>
                      <span className={`stats-person-overdue ${p.overdue > 0 ? '' : 'is-empty'}`} data-tip={p.overdue > 0 ? `${p.overdue} retrasadas · ${p.overdueShare}% de las abiertas` : 'Sin retrasadas'}>
                        <Icon name="alarm" size={16} /> {p.overdue}
                      </span>
                      <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={22} className="stats-person-chevron" />
                    </button>
                    <IconButton icon="open_in_new" label="Abrir su tablero" variant="tonal" size={34} onClick={() => openBoard(p.username)} />
                  </div>

                  {isOpen && (
                    <div className="stats-details animate-fade-in">
                      {DONUT_ORDER.map(k => (
                        <span className="stats-detail" key={k}>
                          <Icon name={STATUS_META[k].icon} size={16} style={{ color: `var(${STATUS_META[k].color})` }} />
                          <strong>{p[k]}</strong> {STATUS_META[k].label.toLowerCase()}
                        </span>
                      ))}
                      <span className={`stats-detail ${p.overdue > 0 ? 'is-danger' : ''}`}>
                        <Icon name="alarm" size={16} />
                        <strong>{p.overdue}</strong> retrasadas{p.open > 0 ? ` (${p.overdueShare}% de ${p.open} abiertas)` : ''}
                      </span>
                      <span className="stats-detail">
                        <Icon name="verified" size={16} />
                        <strong>{p.close.onTimeRate === null ? '—' : `${p.close.onTimeRate}%`}</strong> a tiempo
                      </span>
                      <span className="stats-detail">
                        <Icon name="timer" size={16} />
                        <strong>{p.close.avgCloseDays === null ? '—' : p.close.avgCloseDays.toFixed(1)}</strong> días de cierre medio
                      </span>
                      <span className="stats-detail">
                        <Icon name="functions" size={16} /> <strong>{p.total}</strong> en total
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {isExportOpen && (
        <ExportDialog
          activities={activities}
          users={usersList}
          teams={teams}
          today={today}
          onClose={() => setIsExportOpen(false)}
          onDone={(result) => showToast(result.message, result.ok)}
        />
      )}

      <Toast toast={toast} />
    </div>
  );
}

export default StatsPage;
