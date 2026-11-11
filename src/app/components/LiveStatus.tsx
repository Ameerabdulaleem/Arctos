import { useTickers } from '../hooks/useTickers';
import { Pill } from './ui/common';

/** Shows whether the live price feed is connected. */
export function LiveStatus() {
  const { status, tickers, error } = useTickers();
  const hasData = Object.keys(tickers).length > 0;
  if (!hasData && error) {
    return <Pill tone="red"><span className="w-1.5 h-1.5 rounded-full bg-red-400" />Data service offline</Pill>;
  }
  if (status === 'live') {
    return <Pill tone="green"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />Live</Pill>;
  }
  if (status === 'polling' && hasData) {
    return <Pill tone="amber"><span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Updating every few seconds</Pill>;
  }
  return <Pill tone="zinc"><span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-pulse" />Connecting</Pill>;
}
