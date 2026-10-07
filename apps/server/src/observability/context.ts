import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** Har bir so'rov/update uchun log maydonlari (TT §40). Maxfiy ma'lumot bu yerga yozilmaydi. */
export interface LogContext {
  requestId: string;
  updateId?: number;
  businessId?: string;
  userId?: string;
  ledgerEntryId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

export const newRequestId = (): string => randomUUID();

export function runWithContext<T>(context: Partial<LogContext>, fn: () => T): T {
  return storage.run({ requestId: newRequestId(), ...context }, fn);
}

export const getContext = (): LogContext | undefined => storage.getStore();

/** Joriy kontekstga maydon qo'shadi (masalan, autentifikatsiyadan keyin businessId). */
export function setContext(patch: Partial<Omit<LogContext, 'requestId'>>): void {
  const current = storage.getStore();
  if (current) Object.assign(current, patch);
}
