import { apiGet } from './api';

export type NewsImpact = 'high' | 'medium' | 'low';

export interface NewsArticle {
  id: string;
  title: string;
  excerpt: string;
  source: { name: string; color: string };
  category: string;
  impact: NewsImpact;
  publishedAt: string;
  imageUrl: string | null;
  url: string;
  trending: boolean;
}

export interface NewsResponse {
  articles: NewsArticle[];
  fetchedAt: string | null;
  feeds: Array<{ name: string; ok: boolean; count: number; error: string | null }>;
}

export const newsService = {
  list: (limit = 120, signal?: AbortSignal) => apiGet<NewsResponse>(`/api/news?limit=${limit}`, { signal }),
};
