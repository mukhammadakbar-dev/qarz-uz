import { Alert } from './icons.jsx';
import { fmtDate } from '../lib/format.js';

/**
 * Persistent trial/subscription notice.
 *  - active paid plan  -> nothing
 *  - trial, >3 days    -> neutral
 *  - trial, <=3 days   -> warning
 *  - expired           -> danger, not dismissible
 */
export default function TrialBanner({ subscription, onChoosePlan }) {
  if (!subscription) return null;
  const { status, daysLeft, endsAt, isTrial } = subscription;

  if (status === 'expired') {
    return (
      <div className="banner banner-danger" role="alert">
        <Alert />
        <span className="banner-text">
          <strong>Sinov muddati tugadi</strong> — yozish imkoniyati cheklangan.
          Ma'lumotlaringiz saqlanib turibdi. Davom etish uchun tarif tanlang.
        </span>
        {onChoosePlan && (
          <button className="btn btn-primary" onClick={onChoosePlan}>Tarif tanlash</button>
        )}
      </div>
    );
  }

  // Paid and comfortably active: stay out of the way
  if (!isTrial) return null;

  const urgent = daysLeft <= 3;
  return (
    <div className={`banner ${urgent ? 'banner-warn' : ''}`}>
      {urgent && <Alert />}
      <span className="banner-text">
        <strong>Sinov muddati: {daysLeft} kun qoldi</strong>
        {endsAt && <span className="muted"> · {fmtDate(endsAt)} gacha</span>}
      </span>
      {urgent && onChoosePlan && (
        <button className="btn btn-primary" onClick={onChoosePlan}>Tarif tanlash</button>
      )}
    </div>
  );
}
