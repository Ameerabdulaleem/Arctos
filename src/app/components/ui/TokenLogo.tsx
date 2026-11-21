import { useState } from 'react';
import { safeHref } from '../../lib/format';

/** A round picture, or the first letters of the name when there is none or it fails to load. */
export function Avatar({ src, handle, size = 36 }: { src: string | null | undefined; handle: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const href = safeHref(src);
  if (href && !broken) return <img src={href} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} className="shrink-0 rounded-full bg-white/5" style={{ width: size, height: size }} />;
  return <span className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-400/30 to-violet-400/30 text-xs font-bold text-white" style={{ width: size, height: size, fontSize: size < 24 ? Math.max(8, Math.round(size * 0.5)) : undefined }} aria-hidden>{handle.slice(0, size < 24 ? 1 : 2).toUpperCase()}</span>;
}

export function TokenLogo({ src, symbol, size = 32 }: { src: string | null | undefined; symbol: string; size?: number }) {
  return <Avatar src={src} handle={symbol} size={size} />;
}
