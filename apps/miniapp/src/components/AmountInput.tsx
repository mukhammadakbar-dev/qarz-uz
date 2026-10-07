import { formatGrouped } from '@nasiya/shared';
import { parseDigits } from '../lib/format';

const QUICK = [10_000, 50_000, 100_000, 500_000];

/**
 * Summa kiritish: faqat raqamlar, mingliklar bo'shliq bilan ko'rsatiladi. Qiymat — butun so'm (number).
 * Tezkor tugmalar summaga QO'SHADI (yig'indi 10 mlrd dan oshmaydi).
 */
export function AmountInput({
  value,
  onChange,
  label,
  autoFocus,
}: {
  value: number;
  onChange: (n: number) => void;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor="amount">{label}</label>
      <input
        id="amount"
        className="input amount"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder="0"
        value={value ? formatGrouped(value) : ''}
        onChange={(e) => onChange(parseDigits(e.target.value))}
      />
      <div className="chips" role="group">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            className="chip"
            onClick={() => onChange(Math.min(value + q, 10_000_000_000))}
          >
            +{formatGrouped(q)}
          </button>
        ))}
      </div>
    </div>
  );
}
