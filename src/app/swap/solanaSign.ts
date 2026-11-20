// Signs a Solana transaction as raw bytes. Phantom and the other Solana wallets register
// themselves through the Wallet Standard, which takes the bytes and hands back the signed
// bytes, so nothing heavy has to load between the click and the wallet window. Phantom's
// older injected API is kept as a fallback for wallets that do not register.

const SIGN_TX = 'solana:signTransaction';
const CONNECT = 'standard:connect';
const MAINNET = 'solana:mainnet';

interface StandardAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly string[];
  readonly features: readonly string[];
}

interface StandardWallet {
  readonly name: string;
  readonly accounts: readonly StandardAccount[];
  readonly features: Readonly<Record<string, unknown>>;
}

interface SignFeature {
  signTransaction(...inputs: Array<{ account: StandardAccount; transaction: Uint8Array; chain?: string }>): Promise<ReadonlyArray<{ signedTransaction: Uint8Array }>>;
}

interface ConnectFeature {
  connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardAccount[] }>;
}

const registered = new Set<StandardWallet>();
let listening = false;

/** Wallets that registered with the Wallet Standard. The first call starts listening. */
function standardWallets(): StandardWallet[] {
  if (typeof window === 'undefined') return [];
  if (!listening) {
    listening = true;
    const api = {
      register: (...wallets: StandardWallet[]) => {
        for (const w of wallets) if (w && typeof w === 'object' && w.features) registered.add(w);
        return () => wallets.forEach((w) => registered.delete(w));
      },
    };
    window.addEventListener('wallet-standard:register-wallet', (event) => {
      const callback = (event as CustomEvent<unknown>).detail;
      if (typeof callback === 'function') callback(api);
    });
    window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: api }));
  }
  return [...registered];
}

// ------------------------------------------------------------------ reading transaction bytes

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => B58[d]).join('');
}

function shortvec(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 3; i++) {
    const b = bytes[at + i];
    if (b === undefined) throw new Error('cut short');
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return [value, at + i + 1];
  }
  throw new Error('bad length');
}

export interface ParsedTx {
  /** The accounts that must sign, in signature order. */
  signers: string[];
  /** One 64 byte slot per signer; all zero until signed. */
  signatures: Uint8Array[];
  /** The bytes every signer signs. */
  message: Uint8Array;
}

/** Reads the signer list out of a serialized legacy or versioned transaction. */
export function parseTransaction(bytes: Uint8Array): ParsedTx {
  try {
    const [count, sigStart] = shortvec(bytes, 0);
    const msgStart = sigStart + count * 64;
    if (count < 1 || count > 12 || msgStart >= bytes.length) throw new Error('bad signatures');
    const signatures = Array.from({ length: count }, (_, i) => bytes.subarray(sigStart + i * 64, sigStart + (i + 1) * 64));
    let at = msgStart;
    if (bytes[at] & 0x80) at += 1; // versioned message prefix
    const required = bytes[at];
    const [keys, keyStart] = shortvec(bytes, at + 3);
    if (required !== count || keys < required || keyStart + keys * 32 > bytes.length) throw new Error('bad header');
    const signers = Array.from({ length: required }, (_, i) => base58(bytes.subarray(keyStart + i * 32, keyStart + (i + 1) * 32)));
    return { signers, signatures, message: bytes.subarray(msgStart) };
  } catch {
    throw new Error('The swap transaction could not be read. Nothing was signed.');
  }
}

/** Checks what the wallet handed back is a transaction signed by the expected account. */
export function checkSigned(signed: Uint8Array, address: string): void {
  const after = parseTransaction(signed);
  const slot = after.signers.indexOf(address);
  if (slot < 0 || after.signatures[slot].every((b) => b === 0)) throw new Error('The wallet did not sign the swap. Nothing was sent.');
}

// ------------------------------------------------------------------ signing

interface Signer {
  sign(transaction: Uint8Array): Promise<Uint8Array>;
}

async function standardSigner(address: string): Promise<Signer | null> {
  const wallets = standardWallets().filter((w) => typeof (w.features[SIGN_TX] as SignFeature | undefined)?.signTransaction === 'function');
  const ordered = [...wallets.filter((w) => /phantom/i.test(w.name)), ...wallets.filter((w) => !/phantom/i.test(w.name))];
  for (const wallet of ordered) {
    let account = wallet.accounts.find((a) => a.address === address);
    if (!account && /phantom/i.test(wallet.name)) {
      // Already trusted from the earlier connection, so this never opens a window.
      const connect = wallet.features[CONNECT] as ConnectFeature | undefined;
      try {
        account = (await connect?.connect({ silent: true }))?.accounts.find((a) => a.address === address);
      } catch {
        account = undefined;
      }
    }
    if (!account) continue;
    const feature = wallet.features[SIGN_TX] as SignFeature;
    const chain = account.chains.includes(MAINNET) ? MAINNET : undefined;
    const found = account;
    return {
      async sign(transaction) {
        const [out] = await feature.signTransaction({ account: found, transaction, ...(chain ? { chain } : {}) });
        if (!(out?.signedTransaction instanceof Uint8Array)) throw new Error('The wallet did not return the signed swap. Nothing was sent.');
        return out.signedTransaction;
      },
    };
  }
  return null;
}

async function legacySign(provider: SolanaProvider, bytes: Uint8Array, address: string): Promise<Uint8Array> {
  if (!provider.signTransaction) throw new Error('This wallet cannot sign Solana transactions.');
  const { VersionedTransaction } = await import('@solana/web3.js');
  const tx = VersionedTransaction.deserialize(bytes);
  const out: unknown = await provider.signTransaction(tx);
  if (out instanceof Uint8Array) return out;
  if (out && typeof (out as { serialize?: unknown }).serialize === 'function') return (out as { serialize(): Uint8Array }).serialize();
  // Some wallet versions answer with only the signature, or sign the object in place.
  const slot = parseTransaction(bytes).signers.indexOf(address);
  const signature = (out as { signature?: unknown } | null)?.signature;
  if (slot >= 0 && signature instanceof Uint8Array && signature.length === 64) tx.signatures[slot] = signature;
  if (slot >= 0 && tx.signatures[slot]?.some((b) => b !== 0)) return tx.serialize();
  throw new Error('Phantom did not return the signed swap. Update Phantom, then try again.');
}

/**
 * Asks the wallet to sign a serialized transaction and returns the signed bytes.
 * Refuses a transaction this wallet is not asked to sign, and a result it did not sign.
 */
export async function signSolanaTransaction(provider: SolanaProvider, address: string, bytes: Uint8Array): Promise<Uint8Array> {
  if (!parseTransaction(bytes).signers.includes(address)) throw new Error('The route was built for another wallet. Nothing was signed.');
  const standard = await standardSigner(address);
  const signed = standard ? await standard.sign(bytes) : await legacySign(provider, bytes, address);
  checkSigned(signed, address);
  return signed;
}

/** Gets signing ready ahead of the click: finds the wallet, and loads the fallback only if it is needed. */
export function warmSolanaSigning(): void {
  const ready = standardWallets().some((w) => (w.features[SIGN_TX] as SignFeature | undefined)?.signTransaction);
  if (!ready) void import('@solana/web3.js').catch(() => {});
}
