/** API javoblari (apps/server/src/api/routes.ts bilan mos). Sanalar ISO satr. */

export type Role = 'OWNER' | 'STAFF';
export type Locale = 'uz-Latn' | 'uz-Cyrl';

export interface Me {
  user: { id: string; firstName: string | null; username: string | null; locale: Locale };
  activeBusinessId: string | null;
  businesses: { id: string; name: string; role: Role }[];
  /** Superadmin paneli ochiqmi (himoya serverda; bu faqat bo'limni ko'rsatish uchun). */
  isSuperadmin?: boolean;
}

export interface Subscription {
  state: 'TRIAL' | 'ACTIVE' | 'EXPIRED';
  until: string;
  daysLeft: number;
}

export interface Dashboard {
  business: { id: string; name: string; suspended?: boolean };
  role: Role;
  summary: { totalDebt: number; debtorsCount: number; todayOperations: number };
  subscription: Subscription;
}

export interface Customer {
  id: string;
  name: string;
  label: string | null;
  phone: string | null;
  notes: string | null;
  status: 'ACTIVE' | 'ARCHIVED';
  balance: number;
  createdAt: string;
  updatedAt: string;
  /** Oxirgi yozuv (yoki yaratilish) vaqti. */
  lastActivityAt: string;
}

export interface CustomerPage {
  items: Customer[];
  nextCursor: string | null;
}

export interface HistoryItem {
  id: string;
  seq: number;
  type: 'DEBT' | 'PAYMENT' | 'ADJUSTMENT';
  amount: number;
  delta: number;
  description: string | null;
  occurredAt: string;
  createdAt: string;
  runningBalance: number;
  reversedBy: string | null;
  isReversal: boolean;
  createdByName: string | null;
}

export interface HistoryPage {
  items: HistoryItem[];
  nextCursor: string | null;
}

export interface Preview {
  type: 'debt' | 'payment';
  balance: number;
  balanceAfter: number | null;
  allowed: boolean;
  maxPayable?: number;
}

export interface PostResult {
  entry: HistoryItem;
  balance: number;
  replayed: boolean;
}

export interface StaffMember {
  userId: string;
  name: string;
  username: string | null;
  role: Role;
  status: 'ACTIVE' | 'REVOKED';
  joinedAt: string;
  revokedAt: string | null;
}

export interface BusinessSettings {
  id: string;
  name: string;
  shortCode: string;
  currency: string;
  timezone: string;
  notifyOwnerOnDelete: boolean;
}

export interface Billing {
  status: Subscription;
  trialEndsAt: string | null;
  paidUntil: string | null;
  shortCode: string;
  priceUzs: number;
  supportPhone: string | null;
}

export type SortKey = 'debt' | 'newest' | 'name' | 'recent';

// ───────── Superadmin ─────────

export type SegmentState = 'TRIAL' | 'ACTIVE' | 'EXPIRED';
export type AdminFilter = SegmentState | 'SUSPENDED';

export interface AdminStats {
  businesses: number;
  trial: number;
  active: number;
  expired: number;
  suspended: number;
  expiringSoon: number;
  newThisWeek: number;
  users: number;
  customers: number;
  totalDebt: number;
  entriesToday: number;
  revenueThisMonth: number;
}

export interface AdminPerson {
  userId: string;
  telegramUserId: number;
  username: string | null;
  name: string;
}

export interface AdminBusiness {
  id: string;
  name: string;
  shortCode: string;
  createdAt: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  owner: AdminPerson;
  subscription: Subscription;
  customers: number;
  totalDebt: number;
  staff: number;
  lastEntryAt: string | null;
}

export interface AdminBusinessDetail extends AdminBusiness {
  entries: number;
  priceUzs: number;
  members: (AdminPerson & { role: Role; status: 'ACTIVE' | 'REVOKED'; joinedAt: string })[];
  payments: {
    id: string;
    amount: number;
    months: number;
    periodFrom: string;
    periodTo: string;
    note: string | null;
    createdAt: string;
    recordedBy: string;
  }[];
}

export interface Broadcast {
  id: string;
  text: string;
  segments: SegmentState[];
  includeStaff: boolean;
  status: 'SENDING' | 'DONE';
  total: number;
  sent: number;
  failed: number;
  blocked: number;
  createdAt: string;
  finishedAt: string | null;
  createdBy: string;
}
