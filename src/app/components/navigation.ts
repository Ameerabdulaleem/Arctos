import type { Icon } from '@phosphor-icons/react';
import { Buildings, ChartLineUp, Crosshair, GearSix, Newspaper, Notebook, Sparkle, SquaresFour, Waves } from '@phosphor-icons/react';
import type { ViewId } from '../hooks/useHashView';
import type { Tone } from './ui/common';

export interface NavItem {
  id: ViewId;
  label: string;
  /** One line on what the page is for, shown on the homepage. */
  blurb: string;
  icon: Icon;
  tone: Tone;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/** The single source of truth for page names, icons and accent colours. */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ id: 'dashboard', label: 'Dashboard', blurb: 'Portfolio and market pulse on one screen.', icon: SquaresFour, tone: 'ice' }],
  },
  {
    label: 'Trade',
    items: [
      { id: 'trading', label: 'Trading Terminal', blurb: 'Live candles, order book and paper orders.', icon: ChartLineUp, tone: 'mint' },
      { id: 'sniper', label: 'Sniper Engine', blurb: 'New liquidity pools with contract risk checks.', icon: Crosshair, tone: 'amber' },
      { id: 'tradebook', label: 'Trade Book', blurb: 'Your journal, with live profit and loss.', icon: Notebook, tone: 'violet' },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { id: 'whale', label: 'Whale Alerts', blurb: 'Large on chain transfers as they land.', icon: Waves, tone: 'ice' },
      { id: 'news', label: 'Fundamental News', blurb: 'Headlines scored by likely market impact.', icon: Newspaper, tone: 'rose' },
      { id: 'stocks', label: 'Stocks & PRE-IPO', blurb: 'Crypto linked equities and private listings.', icon: Buildings, tone: 'mint' },
      { id: 'chat', label: 'AI Chat', blurb: 'Answers grounded in the live data above.', icon: Sparkle, tone: 'violet' },
    ],
  },
];

export const SETTINGS_ITEM: NavItem = { id: 'settings', label: 'Settings', blurb: 'Account, wallet and data sources.', icon: GearSix, tone: 'neutral' };

export const NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), SETTINGS_ITEM];

export function navItem(id: ViewId): NavItem {
  return NAV_ITEMS.find((item) => item.id === id) ?? SETTINGS_ITEM;
}
