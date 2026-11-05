import { useEffect, useRef, useState } from 'react';
import { ArrowDown, RefreshCw } from 'lucide-react';

export default function PullRefresh({ enabled, busy, onRefresh }: { enabled: boolean; busy: boolean; onRefresh: () => Promise<void> }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef({ busy, onRefresh });
  latest.current = { busy, onRefresh };
  useEffect(() => {
    if (!enabled) return;
    let start: { x: number; y: number } | null = null;
    let amount = 0;
    let running = false;
    const root = document.documentElement;
    const previous = root.style.overscrollBehaviorY;
    root.style.overscrollBehaviorY = 'none';
    const reset = () => { start = null; amount = 0; setPull(0); };
    const begin = (event: TouchEvent) => {
      if (event.touches.length !== 1 || window.scrollY > 0 || latest.current.busy || running) { reset(); return; }
      if (event.target instanceof Element && event.target.closest('.leaflet-container, dialog, .modal-backdrop')) return;
      let parent = event.target instanceof Element ? event.target : null;
      while (parent && parent !== document.body) {
        if (parent.scrollHeight > parent.clientHeight && parent.scrollTop > 0 && /auto|scroll/.test(getComputedStyle(parent).overflowY)) return;
        parent = parent.parentElement;
      }
      start = { x: event.touches[0].clientX, y: event.touches[0].clientY };
    };
    const move = (event: TouchEvent) => {
      if (!start) return;
      if (event.touches.length !== 1 || window.scrollY > 0) { reset(); return; }
      const dx = event.touches[0].clientX - start.x;
      const dy = event.touches[0].clientY - start.y;
      if (dy < 0 || Math.abs(dx) > Math.abs(dy)) { reset(); return; }
      if (dy > 8) {
        if (event.cancelable) event.preventDefault();
        amount = Math.min(100, dy * 0.5);
        setPull(amount);
      }
    };
    const end = () => {
      const trigger = amount >= 65 && !latest.current.busy && !running;
      reset();
      if (!trigger) return;
      running = true; setRefreshing(true);
      void latest.current.onRefresh().catch(() => {}).finally(() => { running = false; setRefreshing(false); });
    };
    document.addEventListener('touchstart', begin, { passive: true });
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', end);
    document.addEventListener('touchcancel', reset);
    return () => {
      root.style.overscrollBehaviorY = previous;
      document.removeEventListener('touchstart', begin);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', end);
      document.removeEventListener('touchcancel', reset);
      setPull(0);
    };
  }, [enabled]);
  if (!enabled || (!pull && !refreshing)) return null;
  return <div className="pull-refresh-indicator" role="status" style={{ transform: `translate(-50%, ${refreshing ? 18 : pull / 3}px)` }}>
    {refreshing ? <RefreshCw size={18} className="spin" /> : <ArrowDown size={18} style={{ transform: pull >= 65 ? 'rotate(180deg)' : undefined }} />}
    {refreshing ? '正在更新位置及交通資料…' : pull >= 65 ? '放手立即更新' : '向下拉更新'}
  </div>;
}
