import { apiGet, apiPost, withFields } from './api';

export interface JoinResult {
  ok: boolean;
  position: number | null;
  alreadyJoined: boolean;
  persisted: boolean;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const waitlistService = {
  join: (email: string) => apiPost<JoinResult>('/api/waitlist', { email: email.trim() }, { check: withFields('ok', 'position') }),
  count: async (signal?: AbortSignal): Promise<number | null> => {
    try {
      return (await apiGet<{ count: number | null }>('/api/waitlist/count', { signal, check: withFields('count') })).count;
    } catch {
      return null;
    }
  },
};
