import { describe, it, expect } from 'vitest';
import {
  som,
  grp,
  fmtDate,
  formatInputAmount,
  parseInputAmount,
  caretAfterFormat,
  dueLabel,
  statusMeta,
} from './format.js';

// These helpers sit under every amount the user types and every figure they
// read back. They are small enough to look obviously correct and subtle enough
// to have been wrong: grouping, caret placement while editing mid-number, and
// what happens to empty or malformed input.

describe('amount input round-trip', () => {
  it('groups digits as they are typed', () => {
    expect(formatInputAmount('4500000')).toBe('4 500 000');
  });

  it('keeps only digits — a pasted "50 000 so\'m" is still 50000', () => {
    expect(parseInputAmount("50 000 so'm")).toBe(50000);
  });

  it('survives the round trip it is actually used for', () => {
    const typed = '1234567';
    expect(parseInputAmount(formatInputAmount(typed))).toBe(1234567);
  });

  it('treats an empty field as empty, not as zero', () => {
    // Returning 0 here would let a blank amount pass an `amount > 0` check the
    // moment anyone wrote `>= 0`, and would render "0" in the input.
    expect(formatInputAmount('')).toBe('');
    expect(parseInputAmount('')).toBeNaN();
    expect(parseInputAmount('abc')).toBeNaN();
  });

  it('does not silently accept a negative amount', () => {
    // The minus is stripped rather than honoured: a debt of -5000 is not a
    // thing, and the caller validates > 0.
    expect(parseInputAmount('-5000')).toBe(5000);
  });
});

describe('caret position after reformatting', () => {
  // Without this, typing a digit in the middle of "4 500 000" jumped the cursor
  // to the end on every keystroke.
  it('stays after the digit just typed', () => {
    // "45|00000" -> formatted "4 500 000": two digits precede the caret, so it
    // belongs after the "5".
    expect(caretAfterFormat('4500000', 2, '4 500 000')).toBe(3);
  });

  it('is 0 when nothing precedes it', () => {
    expect(caretAfterFormat('4500000', 0, '4 500 000')).toBe(0);
  });

  it('clamps to the end rather than overshooting', () => {
    expect(caretAfterFormat('4500000', 99, '4 500 000')).toBe('4 500 000'.length);
  });
});

describe('display formatting', () => {
  it('renders an amount with spaces and a suffix', () => {
    expect(som(50000)).toBe("50 000 so'm");
  });

  it('never renders a non-breaking space', () => {
    // toLocaleString('ru-RU') emits U+00A0, which looked fine in the browser and
    // wrong everywhere else the string was reused.
    expect(som(1234567)).not.toMatch(/ /);
    expect(grp(1234567)).not.toMatch(/ /);
  });

  it('treats null/undefined as zero rather than NaN', () => {
    expect(grp(null)).toBe('0');
    expect(grp(undefined)).toBe('0');
    expect(som(null)).toBe("0 so'm");
  });

  it('formats an ISO date as DD.MM.YYYY', () => {
    expect(fmtDate('2026-08-05')).toBe('05.08.2026');
  });

  it('shows a dash for a missing date instead of "Invalid Date"', () => {
    expect(fmtDate(null)).toBe('—');
    expect(fmtDate('')).toBe('—');
  });

  it('returns unparseable input unchanged rather than NaN', () => {
    expect(fmtDate('not-a-date')).toBe('not-a-date');
  });
});

describe('due-date badge', () => {
  // The debtors list is sorted on the same signed number this reads, so the
  // badge and the row order can never disagree.
  it('counts days past a missed deadline', () => {
    expect(dueLabel(-12)).toEqual({ text: '12 kun kechikdi', cls: 'due-over' });
    expect(dueLabel(-1)).toEqual({ text: '1 kun kechikdi', cls: 'due-over' });
  });

  it('calls today "Bugun" rather than "0 kun qoldi"', () => {
    expect(dueLabel(0)).toEqual({ text: 'Bugun', cls: 'due-today' });
  });

  it('marks the next three days as urgent', () => {
    expect(dueLabel(1).cls).toBe('due-soon');
    expect(dueLabel(3).cls).toBe('due-soon');
    // The boundary is the whole point of the rule — 4 days is not a task yet.
    expect(dueLabel(4).cls).toBe('due-far');
    expect(dueLabel(30).cls).toBe('due-far');
  });

  it('renders nothing for a debt with no deadline', () => {
    // A debtor with no due date must not be shown as "0 kun qoldi", which is
    // what any implementation that coerced null to a number would produce.
    expect(dueLabel(null)).toBeNull();
    expect(dueLabel(undefined)).toBeNull();
    expect(dueLabel('')).toBeNull();
    expect(dueLabel('abc')).toBeNull();
  });

  it('accepts the string form Postgres sends over JSON', () => {
    expect(dueLabel('-5')).toEqual({ text: '5 kun kechikdi', cls: 'due-over' });
    expect(dueLabel('0').cls).toBe('due-today');
  });
});

describe('status metadata', () => {
  it('covers every status the API can return', () => {
    // A missing entry renders an empty badge with no label — the UI falls back
    // to `open`, so a new status would be shown as "Ochiq" and read as fine.
    for (const s of ['open', 'partial', 'overdue', 'paid']) {
      expect(statusMeta[s]).toBeDefined();
      expect(statusMeta[s].label).toBeTruthy();
      expect(statusMeta[s].cls).toBeTruthy();
    }
  });
});
