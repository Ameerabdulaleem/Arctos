// ─── AI Service ───────────────────────────────────────────────────────────────
// Provider: Google Gemini 1.5 Flash (free tier — 15 req/min, 1M tokens/day)
// Docs: https://ai.google.dev/gemini-api/docs
// Get a free API key: https://aistudio.google.com/app/apikey
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-1.5-flash';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: [{ text: string }];
}

interface GeminiRequestBody {
  system_instruction: { parts: [{ text: string }] };
  contents: GeminiMessage[];
  generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    topP: number;
  };
}

export interface AIError {
  code: 'NO_API_KEY' | 'RATE_LIMIT' | 'INVALID_KEY' | 'NETWORK' | 'UNKNOWN';
  message: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class AIService {
  private readonly model = DEFAULT_MODEL;

  /**
   * Send a chat message to Gemini with conversation history + system prompt.
   * @throws {AIError} with a typed error code for UI-friendly error handling
   */
  async sendMessage(
    history: GeminiMessage[],
    systemPrompt: string,
    apiKey: string,
  ): Promise<string> {
    if (!apiKey?.trim()) {
      const err: AIError = {
        code: 'NO_API_KEY',
        message: 'No API key configured. Add VITE_GEMINI_API_KEY to your .env file.',
      };
      throw err;
    }

    const url = `${GEMINI_BASE}/${this.model}:generateContent?key=${apiKey}`;

    const body: GeminiRequestBody = {
      system_instruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: history,
      generationConfig: {
        temperature: 0.65,
        maxOutputTokens: 1500,
        topP: 0.9,
      },
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      const err: AIError = {
        code: 'NETWORK',
        message: 'Network error — check your connection and try again.',
      };
      throw err;
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as {
        error?: { message?: string; status?: string };
      };
      const status = response.status;
      const apiMessage = errorBody?.error?.message ?? '';

      if (status === 429) {
        const err: AIError = {
          code: 'RATE_LIMIT',
          message: 'Rate limit reached (15 req/min on free tier). Wait a moment and try again.',
        };
        throw err;
      }

      if (status === 400 || status === 403) {
        const err: AIError = {
          code: 'INVALID_KEY',
          message: `Invalid or restricted API key. ${apiMessage}`.trim(),
        };
        throw err;
      }

      const err: AIError = {
        code: 'UNKNOWN',
        message: apiMessage || `API error (HTTP ${status})`,
      };
      throw err;
    }

    const data = await response.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };

    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const err: AIError = {
        code: 'UNKNOWN',
        message: 'Empty response received from AI.',
      };
      throw err;
    }

    return text;
  }

  /**
   * Utility to format an AIError into a user-readable string.
   */
  formatError(err: unknown): string {
    if (
      err !== null &&
      typeof err === 'object' &&
      'code' in err &&
      'message' in err
    ) {
      return (err as AIError).message;
    }
    if (err instanceof Error) return err.message;
    return 'An unexpected error occurred.';
  }
}

export const aiService = new AIService();
