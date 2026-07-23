import { useEffect } from 'react';
import './Modal.css';

export default function Modal({ open, onClose, title, children, width = 440 }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal card" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-x" onClick={onClose} aria-label="Yopish">✕</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
