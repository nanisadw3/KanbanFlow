import { useEffect, useState } from 'react';
import { initDB, subscribeActivities, subscribeUsers } from './db';
import type { Activity } from './db';
import './App.css';
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
            title="Volver al Tablero"
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
          title="Cambiar Tema"
        >
          <span className="material-symbols-rounded">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-todo)' }}>
          <span className="stats-hero-value" style={{ color: 'var(--color-todo)' }}>{overallTodoRate}%</span>
          <span className="stats-hero-label">Tasa de Por Realizar</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-doing)' }}>
          <span className="stats-hero-value" style={{ color: 'var(--color-doing)' }}>{overallDoingRate}%</span>
          <span className="stats-hero-label">Tasa En Proceso</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-done)' }}>
          <span className="stats-hero-value" style={{ color: 'var(--color-done)' }}>{overallRate}%</span>
          <span className="stats-hero-label">Tasa de Finalización</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-danger)' }}>
          <span className="stats-hero-value" style={{ color: 'var(--color-danger)' }}>{overallCancelRate}%</span>
          <span className="stats-hero-label">Tasa de Cancelación</span>
        </div>
        <div className="glass-panel stats-hero" style={{ margin: '0', borderLeft: '4px solid var(--color-danger)' }}>
          <span className="stats-hero-value" style={{ color: 'var(--color-danger)' }}>
            {overall.overdue} <span style={{ fontSize: '1.1rem', fontWeight: 600 }}>({overallOverdueShare}%)</span>
          </span>
          <span className="stats-hero-label">Retrasadas · % de las abiertas</span>
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
              <span className="stats-legend-swatch" style={{ background: 'var(--chart-todo)' }} />
              Por Realizar
            </span>
            <span className="stats-legend-item">
              <span className="stats-legend-swatch" style={{ background: 'var(--chart-doing)' }} />
              En Proceso
            </span>
            <span className="stats-legend-item">
              <span className="stats-legend-swatch" style={{ background: 'var(--chart-done)' }} />
              Completadas
            </span>
            <span className="stats-legend-item">
              <span className="stats-legend-swatch" style={{ background: 'var(--color-danger)' }} />
              Canceladas
            </span>
          </div>

          <div className="stats-rows">
            {rows.map(r => (
              <div className={`glass-panel stats-row ${r.overdue > 0 ? 'has-overdue' : ''}`} key={r.username}>
                <div className="stats-row-head">
                  <span className="stats-row-name">{r.displayName} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 'normal' }}>({r.username})</span>
                    {r.overdue > 0 && (
                      <span className="overdue-user-badge" style={{ display: 'flex', width: 'fit-content', marginLeft: 0, marginTop: '0.25rem' }} title="Tareas abiertas con la fecha de fin vencida">
                        <span className="material-symbols-rounded" style={{ fontSize: '14px' }}>alarm</span>
                        {r.overdue} {r.overdue === 1 ? 'retrasada' : 'retrasadas'} · {r.overdueShare}% de las abiertas
                      </span>
                    )}
                  </span>
                  <span className="stats-row-rate" style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ color: 'var(--color-todo)', fontWeight: '600' }}>{r.todoRate}% por realizar</span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--color-doing)', fontWeight: '600' }}>{r.doingRate}% en proceso</span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--color-done)', fontWeight: '600' }}>{r.rate}% completado</span>
                    <span style={{ color: 'var(--text-muted)' }}>•</span>
                    <span style={{ color: 'var(--color-danger)', fontWeight: '600' }}>{r.cancelRate}% cancelado</span>
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
                  <span>Por Realizar: {r.todo}</span>
                  <span>En Proceso: {r.doing}</span>
                  <span>Completadas: {r.done}</span>
                  <span>Canceladas: {r.cancelled}</span>
                  <span style={r.overdue > 0 ? { color: 'var(--color-danger)', fontWeight: 700 } : undefined}>Retrasadas: {r.overdue}</span>
                  <span>Total: {r.total}</span>
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
