import { useEffect, useState } from 'react';
import { initDB, subscribeActivities, subscribeUsers } from './db';
import type { Activity } from './db';
import './App.css';
import { Icon, IconButton, Avatar, Segmented } from './ui';
import { todayString } from './dates';
import { isLive } from './archive';
import { summarizeUser, sortUsers, donutArcs } from './stats';
import type { DonutKey, SortKey } from './stats';

// One color per status, shared by the donut, the bars and the legend. Cancelled is gray on
// purpose: red is reserved for "overdue", the thing that needs attention.
const STATUS: Record<DonutKey, { label: string; icon: string; color: string }> = {
  done: { label: 'Hechas', icon: 'check_circle', color: '--chart-done' },
  doing: { label: 'En curso', icon: 'schedule', color: '--chart-doing' },
  todo: { label: 'Por hacer', icon: 'assignment', color: '--chart-todo' },
  cancelled: { label: 'Canceladas', icon: 'cancel', color: '--color-secondary' },
};
const DONUT_ORDER: DonutKey[] = ['done', 'doing', 'todo', 'cancelled'];

const RADIUS = 70;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function StatsPage({ onBack }: { onBack: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [usersList, setUsersList] = useState<{ username: string; fullName?: string }[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>('rate');
  const [expanded, setExpanded] = useState<string | null>(null);
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
    void initDB();
    const unsubActivities = subscribeActivities(setActivities);
    const unsubUsers = subscribeUsers(users => {
      setUsersList(users.filter(u => u.username.toLowerCase() !== 'admin'));
    });
    return () => {
      unsubActivities();
      unsubUsers();
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle('dark-theme', theme === 'dark');
    document.body.classList.toggle('light-theme', theme === 'light');
  }, [theme]);

  // Matches the admin dashboard's stat cards, which count personal (non-team) live
  // activities only — team tasks are tracked per team, not folded into a person's numbers.
  const personalActivities = activities.filter(a => !a.teamId && isLive(a));

  const people = sortUsers(
    usersList.map(u => ({
      username: u.username,
      displayName: u.fullName || u.username,
      ...summarizeUser(personalActivities.filter(a => a.username.toLowerCase() === u.username.toLowerCase()), today),
    })),
    sortBy
  );

  const all = summarizeUser(personalActivities, today);
  const arcs = donutArcs(all);
  const needAttention = people.filter(p => p.overdue > 0).sort((a, b) => b.overdue - a.overdue);

  const openBoard = (username: string) => { window.location.hash = `user-${encodeURIComponent(username)}`; };

  return (
    <div className="stats-page">
      <div className="stats-header" style={{ gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <IconButton icon="arrow_back" label="Volver al tablero" onClick={onBack} size={40} />
          <div>
            <h1 style={{ margin: '0' }}>Productividad</h1>
            <p style={{ margin: '0.2rem 0 0 0' }}>
              <strong>Completado</strong> = tareas hechas ÷ todas sus tareas. <strong>Retrasadas</strong> = tareas abiertas con la fecha de fin vencida.
            </p>
          </div>
        </div>
        <IconButton
          icon={theme === 'dark' ? 'light_mode' : 'dark_mode'}
          label="Cambiar tema"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          size={40}
        />
      </div>

      <section className="glass-panel stats-summary">
        <div className="stats-donut" role="img" aria-label={`${all.rate}% completado de ${all.total} tareas`}>
          <svg viewBox="0 0 180 180" width="180" height="180">
            <circle cx="90" cy="90" r={RADIUS} className="stats-donut-track" />
            {arcs.map(a => (
              <circle
                key={a.key}
                cx="90"
                cy="90"
                r={RADIUS}
                className="stats-donut-arc"
                style={{ stroke: `var(${STATUS[a.key].color})` }}
                strokeDasharray={`${Math.max(a.fraction * CIRCUMFERENCE - 2, 0)} ${CIRCUMFERENCE}`}
                strokeDashoffset={-a.start * CIRCUMFERENCE}
              />
            ))}
          </svg>
          <div className="stats-donut-center">
            <span className="stats-donut-value">{all.rate}%</span>
            <span className="stats-donut-label">completado</span>
          </div>
        </div>

        <div className="stats-summary-side">
          <div className="stats-kpis">
            <div className={`stats-kpi ${all.overdue > 0 ? 'is-danger' : ''}`}>
              <Icon name="alarm" size={22} />
              <span className="stats-kpi-value">{all.overdue}</span>
              <span className="stats-kpi-label">Retrasadas</span>
              <span className="stats-kpi-sub">{all.open === 0 ? 'sin tareas abiertas' : `${all.overdueShare}% de ${all.open} abiertas`}</span>
            </div>
            <div className="stats-kpi">
              <Icon name="schedule" size={22} style={{ color: 'var(--chart-doing)' }} />
              <span className="stats-kpi-value">{all.doing}</span>
              <span className="stats-kpi-label">En curso</span>
              <span className="stats-kpi-sub">{all.todo} por hacer</span>
            </div>
            <div className="stats-kpi">
              <Icon name="check_circle" size={22} style={{ color: 'var(--chart-done)' }} />
              <span className="stats-kpi-value">{all.done}</span>
              <span className="stats-kpi-label">Hechas</span>
              <span className="stats-kpi-sub">de {all.total} tareas</span>
            </div>
          </div>
          <ul className="stats-key" aria-label="Leyenda de colores">
            {DONUT_ORDER.map(k => (
              <li key={k}>
                <span className="stats-dot" style={{ background: `var(${STATUS[k].color})` }} />
                {STATUS[k].label} <strong>{all[k]}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

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
                            style={{ width: `${(p[k] / p.total) * 100}%`, background: `var(${STATUS[k].color})` }}
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
                          <Icon name={STATUS[k].icon} size={16} style={{ color: `var(${STATUS[k].color})` }} />
                          <strong>{p[k]}</strong> {STATUS[k].label.toLowerCase()}
                        </span>
                      ))}
                      <span className={`stats-detail ${p.overdue > 0 ? 'is-danger' : ''}`}>
                        <Icon name="alarm" size={16} />
                        <strong>{p.overdue}</strong> retrasadas{p.open > 0 ? ` (${p.overdueShare}% de ${p.open} abiertas)` : ''}
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
    </div>
  );
}

export default StatsPage;
