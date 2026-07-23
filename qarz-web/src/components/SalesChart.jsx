import { useState } from 'react';
import { grp, fmtDate } from '../lib/format.js';

/**
 * Minimal stacked bar chart (cash/card + debt) drawn as SVG.
 * No chart library — keeps the bundle small and the look precise.
 */
export default function SalesChart({ data }) {
  const [hover, setHover] = useState(null);

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="chart-empty muted">
        Hali savdo ma'lumoti yo'q. "Kunlik savdo" bo'limidan boshlang.
      </div>
    );
  }

  const W = 100, H = 42; // viewBox units (responsive)
  const max = Math.max(...data.map((d) => Number(d.total) || 0), 1);
  const n = data.length;
  const gap = 0.35;
  const bw = (W / n) - gap;

  return (
    <div className="chart-body">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="chart-svg">
        {/* baseline */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--line)" strokeWidth="0.2" />
        {data.map((d, i) => {
          const x = i * (W / n) + gap / 2;
          const cash = Number(d.cash_card) || 0;
          const debt = Number(d.debt_given) || 0;
          const total = cash + debt;
          const th = (total / max) * (H - 2);
          const ch = (cash / max) * (H - 2);
          const dh = (debt / max) * (H - 2);
          return (
            <g key={i}
              onMouseEnter={() => setHover({ i, d })}
              onMouseLeave={() => setHover(null)}>
              {/* invisible hit area */}
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {/* debt (top) */}
              <rect x={x} y={H - th} width={bw} height={dh}
                fill="var(--accent)" opacity={hover?.i === i ? 1 : 0.85} rx="0.3" />
              {/* cash (bottom) */}
              <rect x={x} y={H - ch} width={bw} height={ch}
                fill="#9aa4b8" opacity={hover?.i === i ? 1 : 0.85} rx="0.3" />
            </g>
          );
        })}
      </svg>

      {hover && (
        <div className="chart-tip">
          <div className="tip-date">{fmtDate(hover.d.sale_date)}</div>
          <div className="tip-row"><span className="dot dot-cash" />Naqd/karta<b className="num">{grp(hover.d.cash_card)}</b></div>
          <div className="tip-row"><span className="dot dot-debt" />Qarz<b className="num">{grp(hover.d.debt_given)}</b></div>
          <div className="tip-row tip-total">Jami<b className="num">{grp(hover.d.total)}</b></div>
        </div>
      )}
    </div>
  );
}
