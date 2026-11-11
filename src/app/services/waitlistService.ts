import { apiGet, apiPost } from './api';

export interface JoinResult {
  ok: boolean;
  position: number | null;
  alreadyJoined: boolean;
  persisted: boolean;
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const waitlistService = {
  join: (email: string) => apiPost<JoinResult>('/api/waitlist', { email: email.trim() }),
  count: async (signal?: AbortSignal): Promise<number | null> => {
    try {
      return (await apiGet<{ count: number | null }>('/api/waitlist/count', { signal })).count;
    } catch {
      return null;
    }
  },
};
