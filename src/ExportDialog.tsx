import { useEffect, useRef, useState } from 'react';
import type { Activity, User, Team } from './db';
import { buildExportData } from './export';
import { exportAllTasks } from './exportExcel';
import { Icon } from './ui';

type ExportResult = Awaited<ReturnType<typeof exportAllTasks>>;

// Asked every time someone exports: only the current tasks, or the archived ones too. Used by the
// admin header and the Productividad page, so both behave the same.
export default function ExportDialog({ activities, users, teams, today, onClose, onDone }: {
  activities: Activity[];
  users: User[];
  teams: Team[];
  today: string;
  onClose: () => void;
  onDone: (result: ExportResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const firstOption = useRef<HTMLButtonElement>(null);

  const current = buildExportData({ activities, users, teams, today }).tasks.length;
  const withArchived = buildExportData({ activities, users, teams, today, includeArchived: true }).tasks.length;
  const archived = withArchived - current;

  useEffect(() => {
    firstOption.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const choose = async (includeArchived: boolean) => {
    if (busy) return;
    setBusy(true);
    const result = await exportAllTasks({ activities, users, teams, today, includeArchived });
    setBusy(false);
    onDone(result);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={() => { if (!busy) onClose(); }}>
      <div className="glass-panel modal-content animate-scale-in" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '460px' }} role="dialog" aria-label="Exportar a Excel">
        <div className="modal-header">
          <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Icon name="download" style={{ color: 'var(--color-primary)' }} />
            Exportar a Excel
          </h3>
          <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </div>

        <p className="field-hint" style={{ margin: '0.25rem 0 1rem', fontSize: '0.9rem' }}>¿Qué tareas quieres exportar?</p>

        <div className="export-options">
          <button ref={firstOption} type="button" className="export-option" onClick={() => void choose(false)} disabled={busy}>
            <Icon name="task_alt" size={26} className="export-option-icon" />
            <span className="export-option-text">
              <strong>Solo las actuales</strong>
              <small>Las tareas sin archivar, de cualquier estado.</small>
            </span>
            <span className="export-option-count">{current}</span>
          </button>

          <button type="button" className="export-option" onClick={() => void choose(true)} disabled={busy || archived === 0}>
            <Icon name="inventory_2" size={26} className="export-option-icon" />
            <span className="export-option-text">
              <strong>Actuales y archivadas</strong>
              <small>
                {archived === 0
                  ? 'No hay tareas archivadas por ahora.'
                  : `Suma ${archived === 1 ? 'la tarea archivada' : `las ${archived} archivadas`}, marcada${archived === 1 ? '' : 's'} en una columna "Archivada".`}
              </small>
            </span>
            <span className="export-option-count">{withArchived}</span>
          </button>
        </div>

        <div className="modal-footer" style={{ marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" style={{ width: 'auto' }} onClick={onClose} disabled={busy}>
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
