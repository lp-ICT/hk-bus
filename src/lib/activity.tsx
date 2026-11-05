import { createContext, useContext, useEffect, useState } from 'react';

export const ScreenActivity = createContext(true);
export function useScreenActive() {
  const enabled = useContext(ScreenActivity);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return enabled && visible;
}
