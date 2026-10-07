import { describe, expect, it } from 'vitest';
import { can, PERMISSIONS, type Permission } from './permissions.js';

// ADR-0006 §4 jadvali: har bir permission uchun [OWNER, STAFF]
const MATRIX: Record<Permission, [boolean, boolean]> = {
  'customer.create': [true, true],
  'customer.update': [true, true],
  'customer.view': [true, true],
  'ledger.debt': [true, true],
  'ledger.payment': [true, true],
  'ledger.history.view': [true, true],
  'ledger.entry.delete': [true, true],
  'ledger.adjustment': [true, false],
  'customer.archive': [true, false],
  'customer.unarchive': [true, false],
  'staff.manage': [true, false],
  'business.settings': [true, false],
  'billing.view': [true, false],
};

describe('RBAC matritsasi (ADR-0006)', () => {
  it('jadval hamma permission ni qamrab oladi', () => {
    expect(Object.keys(MATRIX).toSorted()).toEqual([...PERMISSIONS].toSorted());
  });

  for (const permission of PERMISSIONS) {
    it(`${permission}`, () => {
      const [owner, staff] = MATRIX[permission];
      expect(can('OWNER', permission)).toBe(owner);
      expect(can('STAFF', permission)).toBe(staff);
    });
  }

  it('OWNER hamma permission ga ega', () => {
    expect(PERMISSIONS.every((p) => can('OWNER', p))).toBe(true);
  });
});
