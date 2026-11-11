import { useSyncExternalStore } from 'react';
import { tickerStore } from '../services/marketStream';

/** Live prices for the tracked pairs, keyed by base symbol such as BTC. */
export function useTickers() {
  return useSyncExternalStore(tickerStore.subscribe, tickerStore.getSnapshot, tickerStore.getSnapshot);
}
