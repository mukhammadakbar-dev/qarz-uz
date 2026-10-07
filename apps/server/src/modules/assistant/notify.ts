import { formatSigned, formatUzs, type Locale } from '@nasiya/shared';
import { displayName } from '@nasiya/nlp';
import type { Pool } from 'pg';
import { t as translate, type MessageKey } from '../../i18n/index.js';
import type { Logger } from '../../observability/logger.js';
import { withBusiness, type BusinessAccess } from '../tenancy/index.js';
import type { EntryDetail } from '../ledger/index.js';

/**
 * Xodim yozuvni o'chirganda egasiga Telegram xabari (D-b). Bot va Mini App uchun umumiy.
 * Xato asosiy amalni buzmasligi uchun xatolar yutiladi (log'ga yoziladi).
 */
export async function notifyOwnerOfDeletion(
  deps: { pool: Pool; logger: Logger; send: (chatId: number, text: string) => Promise<unknown> },
  access: BusinessAccess,
  actor: { name: string; telegramUserId: number },
  detail: EntryDetail,
  balance: number,
): Promise<void> {
  try {
    const { rows } = await withBusiness(deps.pool, access, (c) =>
      c.query<{ telegram_user_id: string; locale: Locale }>(
        `SELECT u.telegram_user_id, u.locale FROM businesses b JOIN users u ON u.id = b.owner_user_id WHERE b.id = $1`,
        [access.businessId],
      ),
    );
    const owner = rows[0];
    if (!owner) return;
    const ownerChat = Number(owner.telegram_user_id);
    if (ownerChat === actor.telegramUserId) return;
    const locale = owner.locale;
    await deps.send(
      ownerChat,
      translate(locale, 'delete.ownerNotice', {
        user: actor.name,
        name: displayName({ name: detail.customerName, label: detail.customerLabel }),
        delta: formatSigned(detail.delta),
        type: translate(locale, `type.${detail.type}` as MessageKey),
        balance: formatUzs(balance, locale),
      }),
    );
  } catch (error) {
    deps.logger.warn({ err: error }, 'egasiga o‘chirish xabari yuborilmadi');
  }
}
