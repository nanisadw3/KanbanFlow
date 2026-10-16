import type { KeyboardEvent } from 'react';
import { donutArcs, STATUS_META } from './stats';
import type { DonutKey, StatusCounts, WeekPoint } from './stats';
import { formatShortDate } from './dates';
import { useCountUp } from './useCountUp';

const RADIUS = 78;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

// Number that counts up from its previous value (see useCountUp).
export function CountUp({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const shown = useCountUp(value);
  return <>{shown.toFixed(decimals)}{suffix}</>;
}

// Interactive donut: each segment draws itself in turn on mount and can be clicked (or
// focused and activated with Enter/Space) to open the tasks behind it.
export function Donut({
  counts, rate, total, active, onSelect, ready,
}: {
  counts: StatusCounts;
  rate: number;
  total: number;
  active: DonutKey | null;
  onSelect: (key: DonutKey) => void;
  ready: boolean; // flips to true one frame after the data first arrives, so the segments draw in
}) {  const arcs = donutArcs(counts);
  const activate = (e: KeyboardEvent, key: DonutKey) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(key);
    }
  };

  return (
    <div className="stats-donut">
      <svg viewBox="0 0 200 200" width="200" height="200" role="group" aria-label={`${rate}% completado de ${total} tareas. Selecciona un segmento para ver sus tareas.`}>
        <g transform="rotate(-90 100 100)">
          <circle cx="100" cy="100" r={RADIUS} className="stats-donut-track" />
          {arcs.map((a, i) => {
            const len = Math.max(a.fraction * CIRCUMFERENCE - 2, 0);
            const meta = STATUS_META[a.key];
            const isActive = active === a.key;
            return (
              <circle
                key={a.key}
                cx="100"
                cy="100"
                r={RADIUS}
                className={`stats-donut-arc ${isActive ? 'is-active' : ''} ${active && !isActive ? 'is-dim' : ''}`}
                style={{
                  stroke: `var(${meta.color})`,
                  strokeDasharray: `${ready ? len : 0} ${CIRCUMFERENCE}`,
                  strokeDashoffset: -a.start * CIRCUMFERENCE,
                  transitionDelay: `${i * 0.22}s`,
                }}
                role="button"
                tabIndex={0}
                aria-pressed={isActive}
                aria-label={`${meta.label}: ${counts[a.key]} de ${total} tareas. Ver detalle`}
                onClick={() => onSelect(a.key)}
                onKeyDown={(e) => activate(e, a.key)}
              >
                <title>{`${meta.label}: ${counts[a.key]} (${Math.round(a.fraction * 100)}%)`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
      <div className="stats-donut-center" aria-hidden="true">
        {total === 0 ? (
          <span className="stats-donut-label">Sin tareas</span>
        ) : (
          <>
            <span className="stats-donut-value"><CountUp value={rate} suffix="%" /></span>
            <span className="stats-donut-label">completado</span>
          </>
        )}
      </div>
    </div>
  );
}

// Created vs completed per week (grouped bars). Bars grow from the baseline on mount.
export function TrendChart({ weeks, ready }: { weeks: WeekPoint[]; ready: boolean }) {
  const W = 600;
  const H = 220;
  const pad = { l: 34, r: 8, t: 20, b: 30 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = Math.max(1, ...weeks.flatMap(w => [w.created, w.completed]));
  const ticks = Array.from(new Set([0, Math.ceil(max / 2), max]));
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const group = innerW / weeks.length;
  const barW = Math.min(18, group / 3);
  const totalCreated = weeks.reduce((n, w) => n + w.created, 0);
  const totalCompleted = weeks.reduce((n, w) => n + w.completed, 0);

  return (
    <div className="stats-trend">
      <div className="stats-trend-legend">
        <span><i className="stats-dot" style={{ background: 'var(--color-primary)' }} /> Creadas <strong>{totalCreated}</strong></span>
        <span><i className="stats-dot" style={{ background: 'var(--chart-done)' }} /> Completadas <strong>{totalCompleted}</strong></span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="stats-trend-svg" role="img" aria-label={`Tareas creadas y completadas por semana, últimas ${weeks.length} semanas: ${totalCreated} creadas y ${totalCompleted} completadas`}>
        {ticks.map(t => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="stats-grid-line" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="stats-axis-text">{t}</text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const cx = pad.l + group * i + group / 2;
          const bars = [
            { v: w.created, x: cx - barW - 1.5, color: 'var(--color-primary)', label: 'creadas' },
            { v: w.completed, x: cx + 1.5, color: 'var(--chart-done)', label: 'completadas' },
          ];
          return (
            <g key={w.start}>
              {bars.map((b, j) => (
                <g key={b.label}>
                  <rect
                    x={b.x}
                    y={y(b.v)}
                    width={barW}
                    height={Math.max(innerH - (y(b.v) - pad.t), b.v > 0 ? 2 : 0)}
                    rx={3}
                    className={`stats-trend-bar ${ready ? 'is-ready' : ''}`}
                    style={{ fill: b.color, transitionDelay: `${(i * 2 + j) * 0.04}s` }}
                  >
                    <title>{`Semana del ${formatShortDate(w.start)}: ${b.v} ${b.label}`}</title>
                  </rect>
                  {b.v > 0 && (
                    <text x={b.x + barW / 2} y={y(b.v) - 4} textAnchor="middle" className="stats-bar-value">{b.v}</text>
                  )}
                </g>
              ))}
              <text x={cx} y={H - 9} textAnchor="middle" className="stats-axis-text">{formatShortDate(w.start)}</text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>Tareas creadas y completadas por semana</caption>
        <thead><tr><th>Semana del</th><th>Creadas</th><th>Completadas</th></tr></thead>
        <tbody>
          {weeks.map(w => <tr key={w.start}><td>{formatShortDate(w.start)}</td><td>{w.created}</td><td>{w.completed}</td></tr>)}
        </tbody>
      </table>
    </div>
  );
}
