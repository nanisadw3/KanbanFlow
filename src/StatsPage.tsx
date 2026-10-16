import { useEffect, useState } from 'react';
import { initDB, subscribeActivities, subscribeUsers } from './db';
import type { Activity } from './db';
import './App.css';
import { Icon, Meta } from './ui';
import { todayString, countOpenAndOverdue, overdueRate } from './dates';

function StatsPage({ onBack }: { onBack: () => void }) {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [usersList, setUsersList] = useState<{ username: string; fullName?: string }[]>([]);
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

  // Matches the admin dashboard's stat cards, which count personal (non-team)
  // activities only — team tasks are tracked separately per team, not folded
  // into an individual's completion rate here.
  const personalActivities = activities.filter(a => !a.teamId);

  const rows = usersList
    .map(u => {
      const username = u.username;
      const displayName = u.fullName || u.username;
      const acts = personalActivities.filter(a => a.username.toLowerCase() === username.toLowerCase());
      const todo = acts.filter(a => a.status === 'todo').length;
      const doing = acts.filter(a => a.status === 'doing').length;
      const done = acts.filter(a => a.status === 'done').length;
      const cancelled = acts.filter(a => a.status === 'cancelled').length;
      const total = acts.length;
      const todoRate = total === 0 ? 0 : Math.round((todo / total) * 100);
      const doingRate = total === 0 ? 0 : Math.round((doing / total) * 100);
      const rate = total === 0 ? 0 : Math.round((done / total) * 100);
      const cancelRate = total === 0 ? 0 : Math.round((cancelled / total) * 100);
      const openAndOverdue = countOpenAndOverdue(acts, today);
      const overdue = openAndOverdue.overdue;
      const overdueShare = overdueRate(openAndOverdue);
      return { username, displayName, todo, doing, done, cancelled, total, rate, todoRate, doingRate, cancelRate, overdue, overdueShare };
    })
    .sort((a, b) => b.rate - a.rate || b.total - a.total);

  const totalAll = personalActivities.length;
  const totalTodo = personalActivities.filter(a => a.status === 'todo').length;
  const totalDoing = personalActivities.filter(a => a.status === 'doing').length;
  const totalDone = personalActivities.filter(a => a.status === 'done').length;
  const totalCancelled = personalActivities.filter(a => a.status === 'cancelled').length;

  const overall = countOpenAndOverdue(personalActivities, today);
  const overallOverdueShare = overdueRate(overall);

  const overallTodoRate = totalAll === 0 ? 0 : Math.round((totalTodo / totalAll) * 100);
  const overallDoingRate = totalAll === 0 ? 0 : Math.round((totalDoing / totalAll) * 100);
  const overallRate = totalAll === 0 ? 0 : Math.round((totalDone / totalAll) * 100);
  const overallCancelRate = totalAll === 0 ? 0 : Math.round((totalCancelled / totalAll) * 100);

  return (
    <div className="stats-page">
      <div className="stats-header" style={{ gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <button
            className="btn btn-secondary btn-icon-only"
            onClick={onBack}
            data-tip="Volver al Tablero"
            style={{ width: '40px', height: '40px', padding: '0', borderRadius: '50%' }}
          >
            <span className="material-symbols-rounded">arrow_back</span>
          </button>
          <div>
            <h1 style={{ margin: '0' }}>Productividad del Equipo</h1>
            <p style={{ margin: '0.2rem 0 0 0' }}>Actividades por estado y tasa de finalización por persona</p>
          </div>
        </div>
        <button
          className="btn btn-secondary btn-icon-only"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          data-tip="Cambiar Tema"
        >
          <span className="material-symbols-rounded">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-todo)' }} data-tip="Tasa de Por Realizar">
          <div className="stats-hero-top">
            <Icon name="assignment" size={22} style={{ color: 'var(--color-todo)' }} />
            <span className="stats-hero-label">Por hacer</span>
          </div>
          <span className="stats-hero-value" style={{ color: 'var(--color-todo)' }}>{overallTodoRate}%</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-doing)' }} data-tip="Tasa En Proceso">
          <div className="stats-hero-top">
            <Icon name="schedule" size={22} style={{ color: 'var(--color-doing)' }} />
            <span className="stats-hero-label">En curso</span>
          </div>
          <span className="stats-hero-value" style={{ color: 'var(--color-doing)' }}>{overallDoingRate}%</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-done)' }} data-tip="Tasa de Finalización">
          <div className="stats-hero-top">
            <Icon name="check_circle" size={22} style={{ color: 'var(--color-done)' }} />
            <span className="stats-hero-label">Hechas</span>
          </div>
          <span className="stats-hero-value" style={{ color: 'var(--color-done)' }}>{overallRate}%</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-danger)' }} data-tip="Tasa de Cancelación">
          <div className="stats-hero-top">
            <Icon name="cancel" size={22} style={{ color: 'var(--color-danger)' }} />
            <span className="stats-hero-label">Canceladas</span>
          </div>
          <span className="stats-hero-value" style={{ color: 'var(--color-danger)' }}>{overallCancelRate}%</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-danger)' }} data-tip="Retrasadas · % de las abiertas">
          <div className="stats-hero-top">
            <Icon name="alarm" size={22} style={{ color: 'var(--color-danger)' }} />
            <span className="stats-hero-label">Retrasadas</span>
          </div>
          <span className="stats-hero-value" style={{ color: 'var(--color-danger)' }}>
            {overall.overdue} <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>({overallOverdueShare}%)</span>
          </span>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass-panel stats-empty">
          <p>Todavía no hay usuarios con actividades registradas.</p>
        </div>
      ) : (
        <>
          <div className="stats-legend">
            <span className="stats-legend-item">
              <Icon name="assignment" size={16} style={{ color: 'var(--chart-todo)' }} />
              Por Realizar
            </span>
            <span className="stats-legend-item">
              <Icon name="schedule" size={16} style={{ color: 'var(--chart-doing)' }} />
              En Proceso
            </span>
            <span className="stats-legend-item">
              <Icon name="check_circle" size={16} style={{ color: 'var(--chart-done)' }} />
              Completadas
            </span>
            <span className="stats-legend-item">
              <Icon name="cancel" size={16} style={{ color: 'var(--color-danger)' }} />
              Canceladas
            </span>
          </div>

          <div className="stats-rows">
            {rows.map(r => (
              <div className={`glass-panel stats-row ${r.overdue > 0 ? 'has-overdue' : ''}`} key={r.username}>
                <div className="stats-row-head">
                  <span className="stats-row-name">{r.displayName} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>({r.username})</span>
                    {r.overdue > 0 && (
                      <Meta icon="alarm" tip={`${r.overdue} retrasadas · ${r.overdueShare}% de las abiertas`} tone="danger">{r.overdue} · {r.overdueShare}%</Meta>
                    )}
                  </span>
                  <span className="stats-row-rate">
                    <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-todo)' }} data-tip="Por realizar"><Icon name="assignment" size={14} />{r.todoRate}%</span>
                    <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-doing)' }} data-tip="En proceso"><Icon name="schedule" size={14} />{r.doingRate}%</span>
                    <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-done)' }} data-tip="Completado"><Icon name="check_circle" size={14} />{r.rate}%</span>
                    <span className="rate-chip" style={{ ['--c' as string]: 'var(--color-danger)' }} data-tip="Cancelado"><Icon name="cancel" size={14} />{r.cancelRate}%</span>
                  </span>
                </div>
                {r.total === 0 ? (
                  <div className="stats-bar" />
                ) : (
                  <div className="stats-bar" role="img" aria-label={`${r.username}: ${r.todo} por realizar, ${r.doing} en proceso, ${r.done} completadas, ${r.cancelled} canceladas`}>
                    {r.todo > 0 && (
                      <div
                        className="stats-bar-segment"
                        style={{ width: `${(r.todo / r.total) * 100}%`, background: 'var(--chart-todo)' }}
                        title={`Por Realizar: ${r.todo}`}
                      />
                    )}
                    {r.doing > 0 && (
                      <div
                        className="stats-bar-segment"
                        style={{ width: `${(r.doing / r.total) * 100}%`, background: 'var(--chart-doing)' }}
                        title={`En Proceso: ${r.doing}`}
                      />
                    )}
                    {r.done > 0 && (
                      <div
                        className="stats-bar-segment"
                        style={{ width: `${(r.done / r.total) * 100}%`, background: 'var(--chart-done)' }}
                        title={`Completadas: ${r.done}`}
                      />
                    )}
                    {r.cancelled > 0 && (
                      <div
                        className="stats-bar-segment"
                        style={{ width: `${(r.cancelled / r.total) * 100}%`, background: 'var(--color-danger)' }}
                        title={`Canceladas: ${r.cancelled}`}
                      />
                    )}
                  </div>
                )}
                <div className="stats-row-counts">
                  <Meta icon="assignment" tip="Por realizar">{r.todo}</Meta>
                  <Meta icon="schedule" tip="En proceso">{r.doing}</Meta>
                  <Meta icon="check_circle" tip="Completadas">{r.done}</Meta>
                  <Meta icon="cancel" tip="Canceladas">{r.cancelled}</Meta>
                  <Meta icon="alarm" tip="Retrasadas" tone={r.overdue > 0 ? 'danger' : undefined}>{r.overdue}</Meta>
                  <Meta icon="functions" tip="Total">{r.total}</Meta>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default StatsPage;
