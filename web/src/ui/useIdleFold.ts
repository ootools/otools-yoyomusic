import { useEffect, useRef, useState } from 'react';

export function useIdleFold({ idleMs, leaveMs, pinned, sticky = false }: {
  idleMs: number; leaveMs: number; pinned: boolean; sticky?: boolean;
}) {
  const [folded, setFolded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const schedule = (ms: number) => {
    clear();
    if (pinned || sticky) return;
    timer.current = setTimeout(() => {
      // Portal交互或面板编辑期间不能卸载触发组件、丢失草稿；失焦后继续原计时。
      const editor = document.activeElement?.closest('input,textarea,[contenteditable]:not([contenteditable="false"])');
      if (document.querySelector('[role="menu"],[role="dialog"]') || editor?.closest('.left-rail,.right-rail')) schedule(ms);
      else setFolded(true);
    }, ms);
  };
  useEffect(() => { if (pinned || sticky) { clear(); setFolded(false); } return clear; }, [pinned, sticky]);
  return {
    folded: pinned || sticky ? false : folded,
    notifyActivity() { setFolded(false); schedule(idleMs); },
    notifyEnter() { clear(); setFolded(false); },
    notifyLeave() { schedule(leaveMs); },
  };
}
