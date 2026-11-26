/**
 * Optional AI explanations: the player's own key (Claude, OpenAI) or a local model (Ollama).
 * Called only when the player clicks; the engine computes, the AI only explains.
 */

export type AiProvider = 'anthropic' | 'openai' | 'ollama'

export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openai', 'ollama']

/** Cheap, fast default model of each provider (the player can type another one). */
export const DEFAULT_AI_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-6-luna',
  ollama: 'qwen3:4b'
}

export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'

export interface AiConfig {
  provider: AiProvider
  model: string
  apiKey: string | null
  /** Ollama server (local). */
  ollamaUrl?: string
}

export interface AiPrompt {
  system: string
  user: string
  maxTokens?: number
}

export type AiErrorCode = 'no-key' | 'bad-key' | 'rate-limit' | 'unreachable' | 'model' | 'other'

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string
  ) {
    super(message)
  }
}

export interface HttpResponse {
  status: number
  text(): Promise<string>
}

export type Http = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<HttpResponse>

const TIMEOUT_MS = 90_000

/** Ask the configured model; returns its answer as plain text. */
export async function askAi(cfg: AiConfig, prompt: AiPrompt, http: Http): Promise<string> {
  const maxTokens = prompt.maxTokens ?? 700
  const model = cfg.model.trim() || DEFAULT_AI_MODELS[cfg.provider]
  if (cfg.provider !== 'ollama' && !cfg.apiKey) throw new AiError('no-key', 'No API key')

  let url: string
  let headers: Record<string, string> = { 'content-type': 'application/json' }
  let body: unknown
  if (cfg.provider === 'anthropic') {
    url = 'https://api.anthropic.com/v1/messages'
    headers = { ...headers, 'x-api-key': cfg.apiKey!, 'anthropic-version': '2023-06-01' }
    body = { model, max_tokens: maxTokens, system: prompt.system, messages: [{ role: 'user', content: prompt.user }] }
  } else if (cfg.provider === 'openai') {
    url = 'https://api.openai.com/v1/responses'
    headers = { ...headers, authorization: `Bearer ${cfg.apiKey!}` }
    body = { model, instructions: prompt.system, input: prompt.user, max_output_tokens: maxTokens }
  } else {
    url = `${(cfg.ollamaUrl ?? DEFAULT_OLLAMA_URL).replace(/\/+$/, '')}/api/chat`
    body = {
      model,
      stream: false,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    }
  }

  let res: HttpResponse
  try {
    res = await http(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) })
  } catch (err) {
    throw new AiError('unreachable', err instanceof Error ? err.message : String(err))
  }
  const raw = await res.text()
  let json: unknown = null
  try {
    json = JSON.parse(raw)
  } catch {
    // not JSON: handled below
  }
  if (res.status < 200 || res.status >= 300) throw httpError(res.status, errorMessage(json) ?? raw.slice(0, 200))

  const text = extractText(cfg.provider, json)
  if (!text) throw new AiError('other', 'Empty answer')
  return stripThinking(text).trim()
}

/** Models installed in the local Ollama (names to pick from). */
export async function listOllamaModels(http: Http, ollamaUrl = DEFAULT_OLLAMA_URL): Promise<string[]> {
  let res: HttpResponse
  try {
    res = await http(`${ollamaUrl.replace(/\/+$/, '')}/api/tags`, { method: 'GET', headers: {}, signal: AbortSignal.timeout(5_000) })
  } catch (err) {
    throw new AiError('unreachable', err instanceof Error ? err.message : String(err))
  }
  if (res.status !== 200) throw httpError(res.status, (await res.text()).slice(0, 200))
  const json = JSON.parse(await res.text()) as { models?: { name?: string }[] }
  return (json.models ?? []).map((m) => m.name).filter((n): n is string => Boolean(n))
}

function httpError(status: number, message: string): AiError {
  if (status === 401 || status === 403) return new AiError('bad-key', message)
  if (status === 429 || status === 529) return new AiError('rate-limit', message)
  if (status === 404 || /model/i.test(message)) return new AiError('model', message)
  return new AiError('other', `HTTP ${status}: ${message}`)
}

function errorMessage(json: unknown): string | null {
  const j = json as { error?: string | { message?: string } } | null
  if (!j?.error) return null
  return typeof j.error === 'string' ? j.error : (j.error.message ?? null)
}

function extractText(provider: AiProvider, json: unknown): string | null {
  if (provider === 'anthropic') {
    const content = (json as { content?: { type: string; text?: string }[] })?.content ?? []
    return content.filter((c) => c.type === 'text' && c.text).map((c) => c.text).join('\n') || null
  }
  if (provider === 'openai') {
    const j = json as { output_text?: string; output?: { type: string; content?: { type: string; text?: string }[] }[] }
    if (j?.output_text) return j.output_text
    const parts = (j?.output ?? [])
      .filter((o) => o.type === 'message')
      .flatMap((o) => o.content ?? [])
      .filter((c) => c.type === 'output_text' && c.text)
      .map((c) => c.text)
    return parts.join('\n') || null
  }
  return (json as { message?: { content?: string } })?.message?.content ?? null
}

/** Some local models write their reasoning between <think> tags: keep only the answer. */
function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, '')
}
