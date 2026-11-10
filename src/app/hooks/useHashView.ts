import { useCallback, useEffect, useState } from 'react';

export const VIEWS = ['dashboard', 'trading', 'sniper', 'tradebook', 'whale', 'news', 'stocks', 'chat', 'settings'] as const;
export type ViewId = (typeof VIEWS)[number];

function read(): ViewId | null {
  const id = window.location.hash.replace(/^#\/?/, '');
  return (VIEWS as readonly string[]).includes(id) ? (id as ViewId) : null;
}

/** Tiny hash router: "#/trading" opens the terminal, an empty hash shows the homepage. */
export function useHashView() {
  const [view, setView] = useState<ViewId | null>(read);

  useEffect(() => {
    const onChange = () => setView(read());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  const navigate = useCallback((next: ViewId | null) => {
    window.location.hash = next ? `/${next}` : '/';
    window.scrollTo?.(0, 0);
  }, []);

  return { view, navigate };
}
