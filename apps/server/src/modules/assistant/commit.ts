import type { DraftSpec } from '@nasiya/nlp';
import type { Pool } from 'pg';
import { DomainError, NotFoundError } from '../../errors/index.js';
import { createCustomer, getCustomer } from '../customers/index.js';
import { attachCustomer, loadDraft, transitionDraft, type Draft } from '../conversation/drafts.js';
import {
  findEntryByIdempotencyKey,
  getBalance,
  postDebt,
  postPayment,
  type PostResult,
} from '../ledger/index.js';
import type { BusinessAccess } from '../tenancy/index.js';

/**
 * Tasdiqlash oqimi (ADR-0003): qoralama → LedgerService(idempotency_key = qoralama ID si) → COMMITTED.
 *
 * Ikkita tranzaksiya (ledger yozuvi va qoralama holati) orasida jarayon uzilsa ham xavfsiz: qayta bosilganda
 * `findEntryByIdempotencyKey` yozuvni topadi va faqat holat yangilanadi (ikkinchi yozuv yaratilmaydi).
 */

export interface SavedCustomer {
  readonly id: string;
  readonly name: string;
  readonly label: string | null;
}

export type CommitOutcome =
  | {
      readonly kind: 'saved';
      readonly draft: Draft;
      readonly result: PostResult;
      readonly customer: SavedCustomer;
      readonly createdCustomer: boolean;
      /** Bu bosish yangi yozuv yaratdimi (false — avval saqlangan edi). */
      readonly fresh: boolean;
    }
  | { readonly kind: 'stale'; readonly draft: Draft; readonly currentBalance: number }
  | { readonly kind: 'expired' }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_owner' }
  | { readonly kind: 'rejected'; readonly error: DomainError; readonly draft: Draft };

export async function commitDraft(
  pool: Pool,
  access: BusinessAccess,
  draftId: string,
): Promise<CommitOutcome> {
  const draft = await loadDraft(pool, access, draftId);
  if (!draft) return { kind: 'not_found' };
  // Faqat qoralamani yaratgan foydalanuvchi tasdiqlay oladi
  if (draft.userId !== access.userId) return { kind: 'not_owner' };

  if (draft.status === 'CANCELLED' || draft.status === 'SUPERSEDED') return { kind: 'cancelled' };
  if (draft.status === 'EXPIRED') return { kind: 'expired' };
  if (draft.status === 'PENDING' && draft.expired) {
    await transitionDraft(pool, access, draft.id, 'EXPIRED');
    return { kind: 'expired' };
  }

  try {
    let spec: DraftSpec = draft.spec;

    // Yangi mijoz: avval yaratiladi, ID qoralamaga yoziladi (qayta urinishda ikkinchi mijoz yaratilmasligi uchun)
    let createdCustomer = false;
    if (!spec.customerId) {
      const created = await createCustomer(pool, access, { name: spec.newCustomerName ?? '' });
      await attachCustomer(pool, access, draft.id, created.id);
      spec = { ...spec, customerId: created.id };
      createdCustomer = true;
    }
    const customerId = spec.customerId!;

    const key = draft.id;
    const existing = await findEntryByIdempotencyKey(pool, access, key);
    if (!existing) {
      // Qoldiq qaror paytidan beri o'zgargan bo'lsa yozilmaydi: tasdiq oynasidagi "Qoldiq" eskirgan (ADR-0003)
      const balance = await getBalance(pool, access, customerId);
      if (balance !== spec.expectedBalance) {
        return { kind: 'stale', draft, currentBalance: balance };
      }
    }

    const input = {
      customerId,
      amount: spec.amount,
      idempotencyKey: key,
      dateOffsetDays: spec.dateOffsetDays,
      source: 'BOT' as const,
      metadata: { draftId: draft.id, kind: spec.kind, interpretationId: draft.interpretationId },
    };
    const result = existing
      ? ({
          entry: existing,
          balance: await getBalance(pool, access, customerId),
          replayed: true,
        } satisfies PostResult)
      : spec.type === 'DEBT'
        ? await postDebt(pool, access, input)
        : await postPayment(pool, access, input);

    const transitioned = await transitionDraft(
      pool,
      access,
      draft.id,
      'COMMITTED',
      result.entry.id,
    );
    const customer = await getCustomer(pool, access, customerId).catch((e: unknown) => {
      if (e instanceof NotFoundError) return null;
      throw e;
    });
    return {
      kind: 'saved',
      draft,
      result,
      customer: customer
        ? { id: customer.id, name: customer.name, label: customer.label }
        : { id: customerId, name: spec.newCustomerName ?? '', label: null },
      createdCustomer,
      fresh: !result.replayed && transitioned,
    };
  } catch (error) {
    if (error instanceof DomainError) return { kind: 'rejected', error, draft };
    throw error;
  }
}
