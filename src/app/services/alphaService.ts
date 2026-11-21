import { apiGet, isRecord } from './api';
import type { SniperToken } from './sniperService';

export interface AlphaAuthor {
  handle: string;
  name: string;
  avatar: string | null;
  followers: number | null;
  verified: boolean;
}

export interface AlphaPost {
  id: string;
  url: string;
  text: string;
  quoted: string | null;
  createdAt: number;
  author: AlphaAuthor;
  likes: number;
  retweets: number;
  replies: number;
  views: number;
  isReply: boolean;
  isRetweet: boolean;
  /** Ids (chain:address) of the coins found in the post. */
  coins: string[];
}

export interface AlphaCoin extends SniperToken {
  kols: string[];
  mentions: number;
  firstSeen: number;
  lastSeen: number;
  posts: string[];
  evidence: 'contract' | 'ticker';
}

export interface LaunchedCoin extends SniperToken {
  word: string;
  postId: string;
  kol: string;
  minutesAfter: number;
}

export interface AlphaResponse {
  configured: boolean;
  source: 'twitterapi.io' | 'x' | null;
  accounts: string[];
  posts: AlphaPost[];
  coins: AlphaCoin[];
  launched: LaunchedCoin[];
  updatedAt?: string;
  error?: string | null;
}

export const alphaService = {
  get: (signal?: AbortSignal) =>
    apiGet<AlphaResponse>('/api/alpha', { signal, timeoutMs: 40_000, check: (v) => isRecord(v) && typeof v.configured === 'boolean' && Array.isArray(v.posts) && Array.isArray(v.coins) }),
};
