// Snipes bought with the user's real wallet. The wallet itself is the source of truth for what
// is held; this only remembers the entry price and size on this device, to show profit and loss
// and to raise the exit plan's alerts.

export interface WalletSnipe {
  /** chain:address, like sniper token ids. */
  id: string;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  /** Price in US dollars when bought. */
  entryPriceUsd: number;
  /** Tokens bought, as a plain number for display. */
  qty: number;
  /** Native coin spent, as typed, with its symbol. */
  spent: string;
  at: number;
  link: string | null;
  /** Exit plan alerts already shown, such as "tp1" or "sl". */
  alerted: string[];
  /** Bought from the user's own wallet (each trade approved) or from the sniper wallet (automatic). */
  source?: 'wallet' | 'sniper';
  decimals?: number;
}

const KEY = 'arctos_wallet_snipes_v1';
const MODE_KEY = 'arctos_sniper_mode';
const SETTINGS_KEY = 'arctos_sniper_wallet_settings';

export type SniperMode = 'paper' | 'wallet' | 'sniper';
export type AutoStrategy = 'smart' | 'filters';

export interface WalletSettings {
  /** Native coin spent per buy, by sniper chain key. */
  spend: Record<string, string>;
  slippagePct: number;
  /** How the auto sniper picks tokens. */
  strategy: AutoStrategy;
  /** Most paper money the auto sniper may have in open snipes at once. */
  paperBudgetUsd: number;
  /** SOL the sniper wallet spends per buy. */
  sniperSpend: string;
  /** Native coin the EVM sniper wallet spends per buy, by chain key (BNB on BNB Chain, ETH on Base). */
  sniperSpendEvm: Record<string, string>;
  /** Chains the auto sniper scans and buys on. */
  autoChains: string[];
  /** The most snipes auto sniping keeps open at once. */
  maxOpen: number;
}

/** The highest limit on open snipes; the keeper manages this many per browser. */
export const MAX_OPEN_LIMIT = 50;

/** Chains the auto sniper can cover, Solana and BNB Chain first. */
export const AUTO_CHAINS = ['solana', 'bsc', 'base', 'ethereum'];

export const DEFAULT_WALLET_SETTINGS: WalletSettings = {
  spend: { solana: '0.1', bsc: '0.02', ethereum: '0.005', base: '0.005', arbitrum: '0.005', polygon: '10', avalanche: '0.5', optimism: '0.005', linea: '0.005', sonic: '10' },
  slippagePct: 5,
  strategy: 'smart',
  paperBudgetUsd: 1000,
  sniperSpend: '0.05',
  sniperSpendEvm: { bsc: '0.01', base: '0.002', ethereum: '0.005', arbitrum: '0.002', polygon: '5', avalanche: '0.2', optimism: '0.002', linea: '0.002', sonic: '5' },
  autoChains: ['solana', 'bsc'],
  maxOpen: 5,
};

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked: kept for this visit only */
  }
}

const AMOUNT = /^\d{1,9}(\.\d{1,18})?$/;

function valid(s: unknown): s is WalletSnipe {
  const w = s as WalletSnipe;
  return Boolean(w) && typeof w.id === 'string' && typeof w.chain === 'string' && typeof w.address === 'string' && typeof w.symbol === 'string'
    && Number.isFinite(w.entryPriceUsd) && w.entryPriceUsd > 0 && Number.isFinite(w.qty) && w.qty >= 0 && Array.isArray(w.alerted);
}

export function readWalletSnipes(): WalletSnipe[] {
  const raw = read(KEY);
  return Array.isArray(raw) ? raw.filter(valid).slice(0, 50) : [];
}

export function saveWalletSnipes(list: WalletSnipe[]) {
  write(KEY, list.slice(0, 50));
}

export function readMode(): SniperMode {
  const m = read(MODE_KEY);
  return m === 'wallet' || m === 'sniper' ? m : 'paper';
}

export function saveMode(mode: SniperMode) {
  write(MODE_KEY, mode);
}

export function readWalletSettings(): WalletSettings {
  const raw = read(SETTINGS_KEY) as Partial<WalletSettings> | null;
  const spend = { ...DEFAULT_WALLET_SETTINGS.spend };
  if (raw?.spend && typeof raw.spend === 'object') {
    for (const [k, v] of Object.entries(raw.spend)) if (typeof v === 'string' && AMOUNT.test(v)) spend[k] = v;
  }
  const sniperSpendEvm = { ...DEFAULT_WALLET_SETTINGS.sniperSpendEvm };
  if (raw?.sniperSpendEvm && typeof raw.sniperSpendEvm === 'object') {
    for (const [k, v] of Object.entries(raw.sniperSpendEvm)) if (typeof v === 'string' && AMOUNT.test(v)) sniperSpendEvm[k] = v;
  }
  const autoChains = Array.isArray(raw?.autoChains) ? raw.autoChains.filter((c): c is string => typeof c === 'string' && AUTO_CHAINS.includes(c)) : [];
  const maxOpen = Number(raw?.maxOpen);
  const slip = Number(raw?.slippagePct);
  const budget = Number(raw?.paperBudgetUsd);
  return {
    spend,
    slippagePct: Number.isFinite(slip) && slip >= 0.1 && slip <= 50 ? slip : DEFAULT_WALLET_SETTINGS.slippagePct,
    strategy: raw?.strategy === 'filters' ? 'filters' : 'smart',
    paperBudgetUsd: Number.isFinite(budget) && budget >= 10 && budget <= 1e7 ? budget : DEFAULT_WALLET_SETTINGS.paperBudgetUsd,
    sniperSpend: typeof raw?.sniperSpend === 'string' && AMOUNT.test(raw.sniperSpend) ? raw.sniperSpend : DEFAULT_WALLET_SETTINGS.sniperSpend,
    sniperSpendEvm,
    autoChains: autoChains.length ? autoChains : DEFAULT_WALLET_SETTINGS.autoChains,
    maxOpen: Number.isInteger(maxOpen) && maxOpen >= 1 && maxOpen <= MAX_OPEN_LIMIT ? maxOpen : DEFAULT_WALLET_SETTINGS.maxOpen,
  };
}

export function saveWalletSettings(s: WalletSettings) {
  write(SETTINGS_KEY, s);
}

export function validSpend(text: string): boolean {
  return AMOUNT.test(text.trim()) && Number(text) > 0;
}

/** Exit plan targets this position has reached and not yet been alerted for. */
export function dueAlerts(
  snipe: WalletSnipe,
  price: number | null,
  plan: { takeProfits: Array<{ enabled: boolean; gainPct: number; sellPct: number }>; stopLossPct: number },
): Array<{ id: string; text: string; sellPct: number }> {
  if (price == null || !Number.isFinite(price) || price <= 0) return [];
  const gainPct = (price / snipe.entryPriceUsd - 1) * 100;
  const out: Array<{ id: string; text: string; sellPct: number }> = [];
  plan.takeProfits.forEach((tp, i) => {
    const id = `tp${i + 1}`;
    if (tp.enabled && gainPct >= tp.gainPct && !snipe.alerted.includes(id)) out.push({ id, text: `Take profit ${i + 1} reached (+${tp.gainPct}%)`, sellPct: tp.sellPct });
  });
  if (plan.stopLossPct > 0 && gainPct <= -plan.stopLossPct && !snipe.alerted.includes('sl')) out.push({ id: 'sl', text: `Stop loss reached (-${plan.stopLossPct}%)`, sellPct: 100 });
  return out;
}
