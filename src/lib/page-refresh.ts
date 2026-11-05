import { useEffect, useRef } from 'react';

const actions = new Set<() => Promise<unknown>>();
export function usePageRefresh(action: () => Promise<unknown>) {
  const latest = useRef(action);
  latest.current = action;
  useEffect(() => {
    const run = () => latest.current();
    actions.add(run);
    return () => { actions.delete(run); };
  }, []);
}
export async function refreshPageData() {
  await Promise.allSettled([...actions].map(action => action()));
}
