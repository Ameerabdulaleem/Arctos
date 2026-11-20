import { describe, expect, it } from 'vitest';
import { EVM_NATIVE, SOL_MINT, SOLANA_ID } from './chains';
import { heldFromHolding } from './useWalletHoldings';
import type { Holding } from '../services/portfolioService';

const base: Holding = { chain: 'solana', chainName: 'Solana', symbol: 'BONK', name: 'Bonk', kind: 'token', amount: 1, priceUsd: 0.00002, valueUsd: 20, change24h: null };

describe('wallet holdings as swappable tokens', () => {
  it('keeps the exact balance and the logo', () => {
    const h = heldFromHolding({ ...base, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, rawAmount: '834694675459207', logo: 'https://img.example/bonk.png', verified: true });
    expect(h?.token).toMatchObject({ chainId: SOLANA_ID, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, logo: 'https://img.example/bonk.png', verified: true });
    expect(h?.raw).toBe(834694675459207n);
  });

  it('writes native coins the way the swap panel does', () => {
    expect(heldFromHolding({ ...base, symbol: 'SOL', kind: 'native', decimals: 9, rawAmount: '65859023956' })?.token.address).toBe(SOL_MINT);
    const bnb = heldFromHolding({ ...base, chain: 'bsc', chainName: 'BNB Chain', symbol: 'BNB', kind: 'native', decimals: 18, rawAmount: '1000' });
    expect(bnb?.token).toMatchObject({ chainId: 56, address: EVM_NATIVE, symbol: 'BNB' });
  });

  it('skips what it cannot swap safely', () => {
    expect(heldFromHolding({ ...base, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 })).toBeNull();
    expect(heldFromHolding({ ...base, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, rawAmount: '0' })).toBeNull();
    expect(heldFromHolding({ ...base, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', rawAmount: '5' })).toBeNull();
    expect(heldFromHolding({ ...base, chain: 'dogechain', address: 'x', decimals: 5, rawAmount: '5' })).toBeNull();
    expect(heldFromHolding({ ...base, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, rawAmount: '1e5' })).toBeNull();
    expect(heldFromHolding({ ...base, address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, rawAmount: '5', logo: 'http://img.example/x.png' })?.token.logo).toBeUndefined();
  });
});
