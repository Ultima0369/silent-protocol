// ---- 多模型 HTTP 中继 ----

import type { Message } from '../protocol/types.js';

export interface RelayProvider {
  name: string;
  query(payload: any): Promise<{ answer: string; tokensUsed: number; model: string; error?: string }>;
}

// ---- Claude API ----
class ClaudeRelayProvider implements RelayProvider {
  readonly name = 'claude';
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private timeout: number;

  constructor() {
    this.apiKey = process.env.ANTHROPIC_API_KEY || '';
    this.model = process.env.NECA2_RELAY_MODEL || 'claude-sonnet-4-20250514';
    this.maxTokens = parseInt(process.env.NECA2_RELAY_MAX_TOKENS || '4096', 10);
    this.timeout = parseInt(process.env.NECA2_RELAY_TIMEOUT || '60000', 10);
  }

  get available(): boolean { return !!this.apiKey; }

  async query(payload: any): Promise<{ answer: string; tokensUsed: number; model: string; error?: string }> {
    if (!this.apiKey) return { answer: '', tokensUsed: 0, model: this.model, error: 'ANTHROPIC_API_KEY not configured' };
    const content = payload.question + (payload.context ? '\n\nContext:\n' + payload.context : '');
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeout);
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': this.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: payload.maxTokens ?? this.maxTokens,
          temperature: payload.temperature ?? 0.7,
          system: 'You are an advisor in a four-party silicon collaboration network. Respond concisely.',
          messages: [{ role: 'user', content }],
        }),
        signal: abortController.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown');
        const c = response.status;
        const ec = (c === 401 || c === 403) ? 'API_AUTH_FAILED' : (c === 429 ? 'API_RATE_LIMITED' : 'API_SERVER_ERROR');
        return { answer: '', tokensUsed: 0, model: this.model, error: ec + ': ' + errText.substring(0, 200) };
      }
      const data = await response.json() as any;
      const text = data.content?.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n') ?? '';
      return { answer: text, tokensUsed: data.usage?.output_tokens ?? 0, model: data.model ?? this.model };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return { answer: '', tokensUsed: 0, model: this.model, error: 'TIMEOUT: Claude API timeout' };
      return { answer: '', tokensUsed: 0, model: this.model, error: err.message };
    }
  }
}

// ---- DeepSeek API ----
class DeepSeekRelayProvider implements RelayProvider {
  readonly name = 'deepseek';
  private apiKey: string;
  private model: string;
  private maxTokens: number;
  private timeout: number;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || '';
    this.model = process.env.NECA2_RELAY_DS_MODEL || 'deepseek-chat';
    this.maxTokens = parseInt(process.env.NECA2_RELAY_MAX_TOKENS || '4096', 10);
    this.timeout = parseInt(process.env.NECA2_RELAY_TIMEOUT || '60000', 10);
  }

  get available(): boolean { return !!this.apiKey; }

  async query(payload: any): Promise<{ answer: string; tokensUsed: number; model: string; error?: string }> {
    if (!this.apiKey) return { answer: '', tokensUsed: 0, model: this.model, error: 'DEEPSEEK_API_KEY not configured' };
    const content = payload.question + (payload.context ? '\n\nContext:\n' + payload.context : '');
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), this.timeout);
    try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          max_tokens: payload.maxTokens ?? this.maxTokens,
          temperature: payload.temperature ?? 0.7,
          messages: [
            { role: 'system', content: 'You are an advisor in a four-party silicon collaboration network.' },
            { role: 'user', content },
          ],
        }),
        signal: abortController.signal,
      });
      clearTimeout(timer);
      if (!response.ok) {
        const errText = await response.text().catch(() => 'unknown');
        const c = response.status;
        const ec = (c === 401 || c === 403) ? 'API_AUTH_FAILED' : (c === 429 ? 'API_RATE_LIMITED' : 'API_SERVER_ERROR');
        return { answer: '', tokensUsed: 0, model: this.model, error: ec + ': ' + errText.substring(0, 200) };
      }
      const data = await response.json() as any;
      return { answer: data.choices?.[0]?.message?.content ?? '', tokensUsed: data.usage?.total_tokens ?? 0, model: data.model ?? this.model };
    } catch (err: any) {
      clearTimeout(timer);
      if (err.name === 'AbortError') return { answer: '', tokensUsed: 0, model: this.model, error: 'TIMEOUT: DeepSeek API timeout' };
      return { answer: '', tokensUsed: 0, model: this.model, error: err.message };
    }
  }
}

// ---- 中继管理器 ----
export class RelayManager {
  private providers: Map<string, RelayProvider> = new Map();
  private defaultProvider: string;

  constructor() {
    const claude = new ClaudeRelayProvider();
    const deepseek = new DeepSeekRelayProvider();
    if (claude.available) this.providers.set('claude', claude);
    if (deepseek.available) this.providers.set('deepseek', deepseek);
    this.defaultProvider = process.env.NECA2_DEFAULT_RELAY || (claude.available ? 'claude' : 'deepseek');
  }

  get availableProviders(): string[] { return Array.from(this.providers.keys()); }
  get default(): string { return this.defaultProvider; }
  get available(): boolean { return this.providers.size > 0; }

  async query(payload: any, preferredProvider?: string): Promise<{ answer: string; tokensUsed: number; model: string; error?: string }> {
    const name = preferredProvider && this.providers.has(preferredProvider) ? preferredProvider : this.defaultProvider;
    const provider = this.providers.get(name);
    if (!provider) return { answer: '', tokensUsed: 0, model: 'none', error: 'No relay providers available' };
    return provider.query(payload);
  }
}

export const relayManager = new RelayManager();
