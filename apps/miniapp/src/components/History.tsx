import { dayLabel, grouped, signed, timeOf } from '../lib/format';
import { useI18n } from '../lib/i18n';
import type { HistoryItem } from '../lib/types';
import { IconDebt, IconPay, IconUndo } from './icons';

export function EntryIcon({ e, big }: { e: HistoryItem; big?: boolean }) {
  const size = big ? 22 : 18;
  if (e.isReversal)
    return (
      <div className={`entry-icon ${big ? 'is-big' : ''}`}>
        <IconUndo size={size} />
      </div>
    );
  const debt = e.delta > 0;
  return (
    <div className={`entry-icon ${debt ? 'is-debt' : 'is-pay'} ${big ? 'is-big' : ''}`}>
      {debt ? <IconDebt size={size} /> : <IconPay size={size} />}
    </div>
  );
}

export function useTypeLabel(): (e: HistoryItem) => string {
  const { t } = useI18n();
  return (e) => (e.isReversal ? t('entry.REVERSAL') : t(`entry.${e.type}`));
}

/**
 * Tarix kunlar bo'yicha guruhlangan ("Bugun", "Kecha", "3-oktabr"). `onSelect` bo'lsa qator bosiladi
 * (tafsilot oynasi), aks holda faqat ko'rish uchun.
 */
export function HistoryGroups({
  entries,
  onSelect,
}: {
  entries: readonly HistoryItem[];
  onSelect?: (e: HistoryItem) => void;
}) {
  const { t, locale } = useI18n();
  const typeLabel = useTypeLabel();
  const groups: { label: string; items: HistoryItem[] }[] = [];
  for (const e of entries) {
    const label = dayLabel(e.occurredAt, locale, t);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(e);
    else groups.push({ label, items: [e] });
  }

  return (
    <>
      {groups.map((g) => (
        <div key={g.label}>
          <h2 className="group-label">{g.label}</h2>
          <ul className="rows flush">
            {g.items.map((e) => {
              const content = (
                <>
                  <EntryIcon e={e} />
                  <div className="row-body">
                    <span className="row-title">
                      {typeLabel(e)}
                      {e.reversedBy ? <small> · {t('entry.deleted')}</small> : null}
                    </span>
                    <span className="row-sub">
                      {[timeOf(e.occurredAt), e.description, e.createdByName]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                  <div className="entry-right">
                    <span className={`row-amount ${e.delta > 0 ? 'debt' : 'pay'}`}>
                      {signed(e.delta)}
                    </span>
                    <small>{t('entry.balance', { amount: grouped(e.runningBalance) })}</small>
                  </div>
                </>
              );
              return (
                <li key={e.id} className={e.reversedBy ? 'entry-deleted' : ''}>
                  {onSelect ? (
                    <button type="button" className="row" onClick={() => onSelect(e)}>
                      {content}
                    </button>
                  ) : (
                    <div className="row">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
