import { useState } from 'react';
import { todayISO } from '../lib/format.js';

const iso = (d) => d.toISOString().slice(0, 10);
const daysAgo = (n) => iso(new Date(Date.now() - n * 864e5));
const monthStart = () => {
  const d = new Date();
  return iso(new Date(d.getFullYear(), d.getMonth(), 1));
};

export const PRESETS = {
  '7': { label: '7 kun', from: () => daysAgo(6), to: () => todayISO() },
  '30': { label: '30 kun', from: () => daysAgo(29), to: () => todayISO() },
  month: { label: 'Joriy oy', from: monthStart, to: () => todayISO() },
  custom: { label: 'Boshqa', from: null, to: null },
};

/** Human-readable description of the active range, for the chart subtitle. */
export const describeRange = (key, from, to) => {
  if (key === 'month') return 'Joriy oy';
  if (key === '7') return "So'nggi 7 kun";
  if (key === '30') return "So'nggi 30 kun";
  if (from && to) {
    const f = new Date(from), t = new Date(to);
    const fmt = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
    return `${fmt(f)} — ${fmt(t)}`;
  }
  return '';
};

export default function DateRangePicker({ value, onChange }) {
  const { key, from, to } = value;
  const [draft, setDraft] = useState({ from, to });

  const pick = (k) => {
    if (k === 'custom') {
      setDraft({ from, to });
      onChange({ key: 'custom', from, to });
      return;
    }
    const p = PRESETS[k];
    onChange({ key: k, from: p.from(), to: p.to() });
  };

  const applyCustom = (patch) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (next.from && next.to && next.from <= next.to) {
      onChange({ key: 'custom', from: next.from, to: next.to });
    }
  };

  return (
    <div className="range-picker">
      <div className="seg">
        {Object.entries(PRESETS).map(([k, p]) => (
          <button
            key={k}
            className={`seg-btn ${key === k ? 'active' : ''}`}
            onClick={() => pick(k)}
            type="button"
          >
            {p.label}
          </button>
        ))}
      </div>

      {key === 'custom' && (
        <div className="range-custom">
          <input
            type="date"
            className="input range-date"
            value={draft.from || ''}
            max={draft.to || todayISO()}
            onChange={(e) => applyCustom({ from: e.target.value })}
            aria-label="Boshlanish sanasi"
          />
          <span className="muted">—</span>
          <input
            type="date"
            className="input range-date"
            value={draft.to || ''}
            min={draft.from || undefined}
            max={todayISO()}
            onChange={(e) => applyCustom({ to: e.target.value })}
            aria-label="Tugash sanasi"
          />
        </div>
      )}
    </div>
  );
}
