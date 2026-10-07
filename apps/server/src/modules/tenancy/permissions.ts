/**
 * RBAC (ADR-0006 §4). Rol → permission to'plami kodda; keyinchalik DB'ga ko'chirilishi mumkin.
 * Hamma tekshiruvlar server tomonida; klient yuborgan rolga ishonilmaydi.
 */

export const ROLES = ['OWNER', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'customer.create',
  'customer.update',
  'customer.view',
  'ledger.debt',
  'ledger.payment',
  'ledger.history.view',
  'ledger.entry.delete',
  'ledger.adjustment',
  'customer.archive',
  'customer.unarchive',
  'staff.manage',
  'business.settings',
  'billing.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const STAFF_PERMISSIONS: readonly Permission[] = [
  'customer.create',
  'customer.update',
  'customer.view',
  'ledger.debt',
  'ledger.payment',
  'ledger.history.view',
  'ledger.entry.delete', // Q2: staff yozuvni o'chira oladi (storno)
];

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  OWNER: new Set(PERMISSIONS),
  STAFF: new Set(STAFF_PERMISSIONS),
};

export const can = (role: Role, permission: Permission): boolean =>
  ROLE_PERMISSIONS[role].has(permission);
