import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function ShareQr({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className="qr-dialog" aria-labelledby="qr-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <button autoFocus className="icon-button modal-close" aria-label="關閉 QR code" onClick={onClose}><X size={21} /></button>
    <h2 id="qr-title">分享「就到站」</h2>
    <p>用手機掃描 QR code，即可開啟網站。</p>
    <img src={`${import.meta.env.BASE_URL}share-qr.png`} width="370" height="370" alt="就到站網站網址的 QR code：https://lp-ict.github.io/hk-bus/" />
    <a className="qr-url" href="https://lp-ict.github.io/hk-bus/">https://lp-ict.github.io/hk-bus/</a>
  </dialog>;
}
