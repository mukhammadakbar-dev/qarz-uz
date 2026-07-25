import { useRef, useLayoutEffect, useState } from 'react';
import { formatInputAmount, caretAfterFormat } from '../lib/format.js';

/**
 * Controlled amount input that displays grouped digits ("4 500 000") while
 * reporting a clean number upward.
 *
 * `value` is the numeric string (digits only, or ''), `onChange` receives the
 * digits-only string so callers never have to strip separators themselves.
 *
 * The caret is restored after each reformat, otherwise typing in the middle of
 * a number would push the cursor to the end on every keystroke.
 */
export default function AmountInput({
  value,
  onChange,
  suffix = "so'm",
  className = 'input',
  ...rest
}) {
  const ref = useRef(null);
  const [caret, setCaret] = useState(null);

  const display = formatInputAmount(value);

  useLayoutEffect(() => {
    if (caret != null && ref.current) {
      ref.current.setSelectionRange(caret, caret);
      setCaret(null);
    }
  }, [caret, display]);

  const handleChange = (e) => {
    const el = e.target;
    const rawTyped = el.value;
    const pos = el.selectionStart ?? rawTyped.length;
    const digits = rawTyped.replace(/\D/g, '');
    const formatted = formatInputAmount(digits);
    setCaret(caretAfterFormat(rawTyped, pos, formatted));
    onChange(digits);
  };

  return (
    <div className="amount-wrap">
      <input
        ref={ref}
        className={className}
        value={display}
        onChange={handleChange}
        inputMode="numeric"
        autoComplete="off"
        {...rest}
      />
      {suffix && <span className="amount-suffix">{suffix}</span>}
    </div>
  );
}
