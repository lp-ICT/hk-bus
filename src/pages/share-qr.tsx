import { useEffect, useRef, useState } from 'react';
import { Copy, Download, Share2, X } from 'lucide-react';

export const websiteUrl = 'https://lp-ict.github.io/hk-bus/';
export default function ShareQr({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const imageUrl = `${import.meta.env.BASE_URL}share-qr.png`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    const controller = new AbortController();
    void fetch(imageUrl, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error('image');
      return response.blob();
    }).then(blob => { if (!controller.signal.aborted) setFile(new File([blob], '就到站-QR-code.png', { type: 'image/png' })); }).catch(() => { if (!controller.signal.aborted) setImageFailed(true); });
    return () => { controller.abort(); element?.close(); previous?.focus(); };
  }, [imageUrl]);
  async function copy() {
    setMessage('');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(websiteUrl);
      else {
        const input = document.createElement('textarea');
        input.value = websiteUrl; input.style.position = 'fixed'; input.style.opacity = '0';
        dialog.current?.appendChild(input); input.focus(); input.select();
        const copied = document.execCommand('copy'); input.remove();
        if (!copied) throw new Error('copy');
      }
      setMessage('已複製網址');
    } catch { setMessage('未能自動複製，請長按上方網址複製。'); }
  }
  function download() {
    const link = document.createElement('a');
    link.href = imageUrl; link.download = '就到站-QR-code.png';
    document.body.appendChild(link); link.click(); link.remove();
    setMessage('已要求下載圖片；如未能儲存，請長按 QR code，選擇儲存影像。');
  }
  async function shareImage(save = false) {
    setMessage('');
    if (!file) { setMessage('圖片未能載入，請長按 QR code 儲存或稍後重試。'); return; }
    let supported = false;
    try { supported = !!navigator.share && !!navigator.canShare?.({ files: [file] }); } catch {}
    if (!supported) {
      if (save) download();
      else setMessage('此瀏覽器未支援分享圖片，請先儲存 QR code，再到其他 App 附加圖片。');
      return;
    }
    setBusy(true);
    try {
      await navigator.share({ files: [file], title: '就到站' });
      setMessage(save ? '已開啟系統選單；如有「儲存影像」，可選擇存入相簿。' : '已交由系統分享選單處理');
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) setMessage('未能開啟分享，請長按 QR code 儲存圖片後再分享。');
    } finally { setBusy(false); }
  }
  async function shareLink() {
    setMessage('');
    if (!navigator.share) { setMessage('此瀏覽器未支援系統分享，請按「複製」後貼到其他 App。'); return; }
    setBusy(true);
    try { await navigator.share({ title: '就到站', url: websiteUrl }); setMessage('已交由系統分享選單處理'); }
    catch (error) { if (!(error instanceof Error && error.name === 'AbortError')) setMessage('未能開啟分享，請按「複製」後貼到其他 App。'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="qr-dialog" aria-labelledby="qr-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <button autoFocus className="icon-button modal-close" aria-label="關閉分享" onClick={onClose}><X size={21} /></button>
    <h2 id="qr-title">分享「就到站」</h2>
    <p>掃描二維碼，或將網址、圖片分享給朋友。</p>
    <img src={imageUrl} width="370" height="370" alt={'就到站網站網址的 QR code：' + websiteUrl} />
    <a className="qr-url" href={websiteUrl}>{websiteUrl}</a>
    <div className="share-actions">
      <button className="primary-button" disabled={busy} onClick={() => void copy()}><Copy size={16} />複製</button>
      <button className="primary-button" disabled={busy || !file} onClick={() => void shareImage(true)}><Download size={16} />儲存</button>
      <button className="primary-button" disabled={busy} onClick={() => void shareLink()}><Share2 size={16} />分享網址</button>
      <button className="primary-button" disabled={busy || !file} onClick={() => void shareImage()}><Share2 size={16} />分享 QR code</button>
    </div>
    {imageFailed && <p role="alert">圖片分享未能準備好；仍可複製網址，或長按 QR code 儲存。</p>}
    <p role="status" aria-live="polite">{message}</p>
    <p>「儲存」會開啟系統選單或下載圖片；存入相簿的選項視乎手機及瀏覽器。</p>
  </dialog>;
}
