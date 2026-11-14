import { useTickers } from '../hooks/useTickers';
import { Pill } from './ui/common';

/** Shows how prices are arriving: a live stream, frequent refreshes, or not at all. */
export function LiveStatus() {
  const { status, tickers, error } = useTickers();
  const hasData = Object.keys(tickers).length > 0;
  if (!hasData && error) {
    return <Pill tone="red"><span className="h-1.5 w-1.5 rounded-full bg-rose-400" />Data service offline</Pill>;
  }
  if (hasData) {
    const streaming = status === 'live';
    return (
      <span title={streaming ? 'Prices are streamed as they change.' : 'Prices refresh every few seconds.'}>
        <Pill tone="green">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 motion-safe:animate-ping" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
          </span>
          Live{streaming ? '' : ' · 3s'}
        </Pill>
      </span>
    );
  }
  return <Pill tone="zinc"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-zinc-400" />Connecting</Pill>;
}
