import { useLayoutEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n';

export function ConfirmDialog({ label, message, confirmLabel, onCancel, onConfirm, returnFocus }: {
  label: string; message: string; confirmLabel: string; onCancel: () => void; onConfirm: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const cancelAction = useRef(onCancel);
  cancelAction.current = onCancel;
  useLayoutEffect(() => {
    const previous = returnFocus?.current ?? (document.activeElement as HTMLElement | null);
    cancel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelAction.current(); }
      if (event.key === 'Tab') {
        event.preventDefault();
        const buttons = [...root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey ? (index <= 0 ? buttons.length - 1 : index - 1) : (index + 1) % buttons.length;
        buttons[next]?.focus();
      }
    };
    const focus = (event: FocusEvent) => { if (!root.current?.contains(event.target as Node)) cancel.current?.focus(); };
    document.addEventListener('keydown', key, true);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('focusin', focus);
      if (previous?.isConnected) previous.focus();
    };
  }, [returnFocus]);
  return createPortal(<div ref={root} className="confirm-overlay" role="dialog" aria-modal="true" aria-label={label}>
    <div className="confirm-card"><p>{message}</p><div>
      <button ref={cancel} type="button" onClick={onCancel}>{t('common.cancel')}</button>
      <button type="button" className="danger" onClick={onConfirm}>{confirmLabel}</button>
    </div></div>
  </div>, document.body);
}
