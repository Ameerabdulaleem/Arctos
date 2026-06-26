// ─── AI Service ───────────────────────────────────────────────────────────────
// Provider: Anthropic Claude via API, with optional local Ollama support for free/self-hosted use.
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_BASE = 'https://api.anthropic.com/v1/messages';
const DEFAULT_CLAUDE_MODEL = 'claude-3-5-sonnet-latest';
const DEFAULT_OLLAMA_MODEL = 'llama3.2';
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIChatMessage {
  role: 'user' | 'model';
  parts: [{ text: string }];
}

interface ClaudeRequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  system: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface OllamaRequestBody {
  model: string;
  stream: false;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

export interface AIError {
  code: 'NO_API_KEY' | 'RATE_LIMIT' | 'INVALID_KEY' | 'NETWORK' | 'UNKNOWN';
  message: string;
}

// ─── Service ──────────────────────────────────────────────────────────────────

class AIService {
  private readonly claudeModel = DEFAULT_CLAUDE_MODEL;
  private readonly ollamaModel = DEFAULT_OLLAMA_MODEL;

  private getProvider(): 'claude' | 'ollama' {
    const provider = (import.meta.env.VITE_AI_PROVIDER as string | undefined)?.toLowerCase();
    return provider === 'ollama' ? 'ollama' : 'claude';
  }

  /**
   * Send a chat message with conversation history + system prompt.
   * @throws {AIError} with a typed error code for UI-friendly error handling
   */
  async sendMessage(
    history: AIChatMessage[],
    systemPrompt: string,
    apiKey: string,
  ): Promise<string> {
    const provider = this.getProvider();

    if (provider === 'ollama') {
      return this.sendToOllama(history, systemPrompt);
    }

    return this.sendToClaude(history, systemPrompt, apiKey);
  }

  private async sendToClaude(
    history: AIChatMessage[],
    systemPrompt: string,
    apiKey: string,
  ): Promise<string> {
    const key = apiKey?.trim() || (import.meta.env.VITE_ANTHROPIC_API_KEY as string | undefined)?.trim() || (import.meta.env.VITE_CLAUDE_API_KEY as string | undefined)?.trim() || '';

    if (!key) {
      const err: AIError = {
        code: 'NO_API_KEY',
        message: 'No Claude API key configured. Add VITE_ANTHROPIC_API_KEY to your .env file, or switch to Ollama with VITE_AI_PROVIDER=ollama.',
      };
      throw err;
    }

    const body: ClaudeRequestBody = {
      model: (import.meta.env.VITE_CLAUDE_MODEL as string | undefined)?.trim() || this.claudeModel,
      max_tokens: 1500,
      temperature: 0.65,
      system: systemPrompt,
      messages: history.map((msg) => ({
        role: msg.role === 'model' ? 'assistant' : 'user',
        content: msg.parts[0]?.text ?? '',
      })),
    };

    let response: Response;
    try {
      response = await fetch(CLAUDE_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
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
        error?: { message?: string; type?: string };
      };
      const status = response.status;
      const apiMessage = errorBody?.error?.message ?? '';

      if (status === 429) {
        const err: AIError = {
          code: 'RATE_LIMIT',
          message: 'Claude rate limit reached. Wait a moment and try again.',
        };
        throw err;
      }

      if (status === 400 || status === 401 || status === 403) {
        const err: AIError = {
          code: 'INVALID_KEY',
          message: `Invalid or restricted Claude API key. ${apiMessage}`.trim(),
        };
        throw err;
      }

      const err: AIError = {
        code: 'UNKNOWN',
        message: apiMessage || `Claude API error (HTTP ${status})`,
      };
      throw err;
    }

    const data = await response.json() as {
      content?: Array<{ type?: string; text?: string }>;
    };

    const text = data?.content?.find((item) => item.type === 'text')?.text;
    if (!text) {
      const err: AIError = {
        code: 'UNKNOWN',
        message: 'Empty response received from Claude.',
      };
      throw err;
    }

    return text;
  }

  private async sendToOllama(
    history: AIChatMessage[],
    systemPrompt: string,
  ): Promise<string> {
    const baseUrl = (import.meta.env.VITE_OLLAMA_BASE_URL as string | undefined)?.trim() || DEFAULT_OLLAMA_URL;
    const model = (import.meta.env.VITE_OLLAMA_MODEL as string | undefined)?.trim() || this.ollamaModel;
    const url = `${baseUrl.replace(/\/$/, '')}/api/chat`;

    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
      { role: 'system', content: systemPrompt },
      ...history.map((msg) => ({
        role: (msg.role === 'model' ? 'assistant' : 'user') as 'assistant' | 'user',
        content: msg.parts[0]?.text ?? '',
      })),
    ];

    const body: OllamaRequestBody = {
      model,
      stream: false,
      messages,
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
        message: 'Ollama is not reachable. Start your local Ollama server or switch back to Claude.',
      };
      throw err;
    }

    if (!response.ok) {
      const err: AIError = {
        code: 'UNKNOWN',
        message: `Ollama request failed (HTTP ${response.status}).`,
      };
      throw err;
    }

    const data = await response.json() as {
      message?: { content?: string };
    };

    const text = data?.message?.content;
    if (!text) {
      const err: AIError = {
        code: 'UNKNOWN',
        message: 'Empty response received from Ollama.',
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
