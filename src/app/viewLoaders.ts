// Every page's code loads on demand. Hovering or focusing a menu item starts the download
// early, so the page is usually ready by the time it is clicked.
import type { ViewId } from './hooks/useHashView';

export const VIEW_LOADERS = {
  dashboard: () => import('./components/DashboardView').then((m) => ({ default: m.DashboardView })),
  trading: () => import('./components/TradingTerminal').then((m) => ({ default: m.TradingTerminal })),
  sniper: () => import('./components/SniperPanel').then((m) => ({ default: m.SniperPanel })),
  tradebook: () => import('./components/TradeBook').then((m) => ({ default: m.TradeBook })),
  whale: () => import('./components/WhaleAlert').then((m) => ({ default: m.WhaleAlert })),
  news: () => import('./components/FundamentalNews').then((m) => ({ default: m.FundamentalNews })),
  stocks: () => import('./components/StocksPreIPO').then((m) => ({ default: m.StocksPreIPO })),
  chat: () => import('./components/AIChat').then((m) => ({ default: m.AIChat })),
  settings: () => import('./components/Settings').then((m) => ({ default: m.Settings })),
};

// Every view must have a loader.
const everyView: Record<ViewId, unknown> = VIEW_LOADERS;
void everyView;

const started = new Set<ViewId>();

/** Starts loading a page's code without showing it. Safe to call often. */
export function prefetchView(id: ViewId | null | undefined): void {
  if (!id || started.has(id)) return;
  started.add(id);
  // Respect people who asked their browser to save data.
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  void VIEW_LOADERS[id]().catch(() => started.delete(id));
}

/** Runs a task when the browser is idle, so it never competes with what the user is doing. */
export function whenIdle(task: () => void, timeout = 2500): void {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(task, { timeout });
  else setTimeout(task, 1200);
}
