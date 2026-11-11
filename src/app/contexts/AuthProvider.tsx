import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AuthContext, type User } from './auth-context';
import {
  connectWallet as connectWalletService,
  disconnectProvider,
  restoreWallet,
  watchWallet,
  type WalletConnection,
  type WalletType,
} from '../services/walletService';
import { hashPassword, verifyPassword, type PasswordRecord } from '../lib/passwordHash';

const USER_KEY = 'arctos_user';
const ACCOUNTS_KEY = 'arctos_accounts_v2';
const LEGACY_ACCOUNTS_KEY = 'arctos_accounts';
const MIN_PASSWORD = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StoredAccount extends PasswordRecord {
  createdAt: string;
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable or full */
  }
}

function loadUser(): User | null {
  const u = readJson<Partial<User> | null>(USER_KEY, null);
  if (!u || (u.authMethod !== 'wallet' && u.authMethod !== 'email')) return null;
  return u as User;
}

function toWalletConnection(u: User): WalletConnection | null {
  if (u.authMethod !== 'wallet' || !u.walletAddress || !u.walletType || !u.walletKind) return null;
  return { address: u.walletAddress, chainId: u.chainId ?? null, walletType: u.walletType, kind: u.walletKind };
}

// Slow down repeated failed sign ins on this device.
const failures = new Map<string, { count: number; until: number }>();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(loadUser);
  const stopWatching = useRef<() => void>(() => {});

  const applyConnection = useCallback((c: WalletConnection) => {
    setUser({ authMethod: 'wallet', walletAddress: c.address, walletType: c.walletType, walletKind: c.kind, chainId: c.chainId });
  }, []);

  // Persist the session.
  useEffect(() => {
    if (user) writeJson(USER_KEY, user);
    else {
      try {
        localStorage.removeItem(USER_KEY);
      } catch {
        /* ignore */
      }
    }
  }, [user]);

  // A saved wallet session is only trusted if the wallet still says it is connected.
  useEffect(() => {
    const saved = user && toWalletConnection(user);
    if (!saved) return;
    let cancelled = false;
    void restoreWallet(saved).then((alive) => {
      if (cancelled) return;
      if (!alive) setUser(null);
      else if (alive.address !== saved.address || alive.chainId !== saved.chainId) applyConnection(alive);
    });
    return () => {
      cancelled = true;
    };
    // Only on first load: later changes come from watchWallet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow account and network changes made inside the wallet.
  const walletAddress = user?.walletAddress;
  const walletType = user?.walletType;
  useEffect(() => {
    stopWatching.current();
    const conn = user && toWalletConnection(user);
    if (!conn) return;
    stopWatching.current = watchWallet(conn, (next) => (next ? applyConnection(next) : setUser(null)));
    return () => stopWatching.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walletAddress, walletType]);

  const connectWallet = useCallback(
    async (type: WalletType) => {
      applyConnection(await connectWalletService(type));
    },
    [applyConnection],
  );

  const disconnectWallet = useCallback(() => {
    if (user?.authMethod === 'wallet' && user.walletType && user.walletKind) void disconnectProvider(user.walletType, user.walletKind);
    setUser(null);
  }, [user]);

  const signUpWithEmail = useCallback(async (rawEmail: string, password: string) => {
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL.test(email)) throw new Error('Enter a valid email address.');
    if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters for your password.`);
    const accounts = readJson<Record<string, StoredAccount>>(ACCOUNTS_KEY, {});
    if (accounts[email]) throw new Error('An account with this email already exists on this device. Please sign in.');
    accounts[email] = { ...(await hashPassword(password)), createdAt: new Date().toISOString() };
    writeJson(ACCOUNTS_KEY, accounts);
    setUser({ authMethod: 'email', email });
  }, []);

  const signInWithEmail = useCallback(async (rawEmail: string, password: string) => {
    const email = rawEmail.trim().toLowerCase();
    const lock = failures.get(email);
    if (lock && lock.until > Date.now()) {
      throw new Error(`Too many attempts. Try again in ${Math.ceil((lock.until - Date.now()) / 1000)} seconds.`);
    }
    const accounts = readJson<Record<string, StoredAccount>>(ACCOUNTS_KEY, {});
    let account = accounts[email];

    // Older builds stored plaintext passwords. Upgrade the record on a successful sign in, then delete it.
    const legacy = readJson<Record<string, { password?: string }>>(LEGACY_ACCOUNTS_KEY, {});
    if (!account && typeof legacy[email]?.password === 'string' && legacy[email].password === password) {
      account = { ...(await hashPassword(password)), createdAt: new Date().toISOString() };
      accounts[email] = account;
      writeJson(ACCOUNTS_KEY, accounts);
      delete legacy[email];
      if (Object.keys(legacy).length === 0) localStorage.removeItem(LEGACY_ACCOUNTS_KEY);
      else writeJson(LEGACY_ACCOUNTS_KEY, legacy);
    }

    const ok = account ? await verifyPassword(password, account) : false;
    if (!ok) {
      const prev = failures.get(email) ?? { count: 0, until: 0 };
      const count = prev.count + 1;
      failures.set(email, { count, until: count >= 5 ? Date.now() + 30_000 : 0 });
      // The same message for unknown email and wrong password.
      throw new Error('Email or password is not correct.');
    }
    failures.delete(email);
    setUser({ authMethod: 'email', email });
  }, []);

  const signOut = useCallback(() => setUser(null), []);

  const value = useMemo(
    () => ({
      user,
      isAuthenticated: user !== null,
      isWalletConnected: user?.authMethod === 'wallet',
      connectWallet,
      disconnectWallet,
      signInWithEmail,
      signUpWithEmail,
      signOut,
    }),
    [user, connectWallet, disconnectWallet, signInWithEmail, signUpWithEmail, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
