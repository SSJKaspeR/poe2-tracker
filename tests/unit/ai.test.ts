import { describe, expect, it } from 'vitest'
import { AiError, askAi, listOllamaModels, type Http } from '../../src/core/ai/providers'
import { buildCoachPrompt, comparisonPrompt } from '../../src/core/ai/prompts'

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

function fakeHttp(status: number, response: unknown, calls: Call[] = []): Http {
  return async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null })
    return { status, text: async () => (typeof response === 'string' ? response : JSON.stringify(response)) }
  }
}

const PROMPT = { system: 'be brief', user: 'stats' }

describe('AI providers', () => {
  it('Claude: Messages API with the key, default model', async () => {
    const calls: Call[] = []
    const answer = await askAi(
      { provider: 'anthropic', model: '', apiKey: 'sk-ant-1' },
      PROMPT,
      fakeHttp(200, { content: [{ type: 'text', text: ' Cap your resistances. ' }] }, calls)
    )
    expect(answer).toBe('Cap your resistances.')
    expect(calls[0]).toMatchObject({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'x-api-key': 'sk-ant-1', 'anthropic-version': '2023-06-01' },
      body: { model: 'claude-haiku-5-5', system: 'be brief', messages: [{ role: 'user', content: 'stats' }] }
    })
  })

  it('OpenAI: Responses API', async () => {
    const calls: Call[] = []
    const res = { output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Equip it.' }] }] }
    expect(await askAi({ provider: 'openai', model: 'gpt-6-sol', apiKey: 'sk-1' }, PROMPT, fakeHttp(200, res, calls))).toBe('Equip it.')
    expect(calls[0]).toMatchObject({
      url: 'https://api.openai.com/v1/responses',
      headers: { authorization: 'Bearer sk-1' },
      body: { model: 'gpt-6-sol', instructions: 'be brief', input: 'stats' }
    })
  })

  it('Ollama: local chat, no key, reasoning removed; installed models', async () => {
    const calls: Call[] = []
    const res = { message: { content: '<think>hmm</think>\nRun more maps.' } }
    expect(await askAi({ provider: 'ollama', model: 'qwen3:4b', apiKey: null, ollamaUrl: 'http://127.0.0.1:9/' }, PROMPT, fakeHttp(200, res, calls))).toBe(
      'Run more maps.'
    )
    expect(calls[0]).toMatchObject({ url: 'http://127.0.0.1:9/api/chat', body: { model: 'qwen3:4b', stream: false } })
    expect(await listOllamaModels(fakeHttp(200, { models: [{ name: 'qwen3:4b' }, { name: 'gemma4' }] }))).toEqual(['qwen3:4b', 'gemma4'])
  })

  it('errors the player can act on', async () => {
    const code = async (p: Promise<unknown>) => (await p.then(() => 'ok').catch((e: AiError) => e.code)) as string
    const cfg = { provider: 'anthropic', model: 'x', apiKey: 'k' } as const
    expect(await code(askAi({ ...cfg, apiKey: null }, PROMPT, fakeHttp(200, {})))).toBe('no-key')
    expect(await code(askAi(cfg, PROMPT, fakeHttp(401, { error: { message: 'invalid x-api-key' } })))).toBe('bad-key')
    expect(await code(askAi(cfg, PROMPT, fakeHttp(429, { error: { message: 'rate limited' } })))).toBe('rate-limit')
    expect(await code(askAi(cfg, PROMPT, fakeHttp(404, { error: { message: 'model: x not found' } })))).toBe('model')
    expect(await code(askAi(cfg, PROMPT, fakeHttp(500, 'oops')))).toBe('other')
    expect(await code(askAi(cfg, PROMPT, fakeHttp(200, { content: [] })))).toBe('other')
    const down: Http = async () => {
      throw new Error('ECONNREFUSED')
    }
    expect(await code(askAi({ provider: 'ollama', model: 'm', apiKey: null }, PROMPT, down))).toBe('unreachable')
  })
})

describe('what is sent to the AI', () => {
  const snapshot = {
    info: { className: 'Ranger', ascendancy: 'Deadeye', level: 80, mainSkill: 'Lightning Arrow' },
    stats: { CombinedDPS: 12345.6, Life: 2100, FireResist: 60, ColdResist: 75, LightningResist: 75, SomethingElse: 3 }
  }

  it('build coach: numbers and findings only, answer in the player language', () => {
    const p = buildCoachPrompt('fr', {
      snapshot,
      verdicts: [
        { id: 'r', area: 'build', severity: 'warn', title: 'Elemental resistances not capped', detail: 'Fire 60%.', tab: 'build' },
        { id: 'g', area: 'maps', severity: 'good', title: 'No death in your last 10 maps', detail: '…', tab: 'dashboard' }
      ],
      gear: [{ slot: 'Helmet', name: 'Doom Crown', rarity: 'RARE', findings: [{ kind: 'socket', level: 'easy', message: '1 empty socket' }] }],
      optimisations: null
    })
    expect(p.system).toContain('Answer in French')
    expect(p.system).toMatch(/never invent/)
    expect(p.user).toContain('Character: Deadeye, level 80; main skill: Lightning Arrow')
    expect(p.user).toContain('- Fire res: 60%')
    expect(p.user).toContain('- Elemental resistances not capped. Fire 60%.')
    expect(p.user).toContain('Going well:\n- No death in your last 10 maps')
    expect(p.user).toContain('- Helmet (Doom Crown): 1 empty socket')
    expect(p.user).not.toContain('SomethingElse')
  })

  it('item comparison: changes with before → after', () => {
    const p = comparisonPrompt('en', {
      slot: 'Body Armour',
      item: { name: 'Gloom Shell', rarity: 'RARE', base: 'Iron Cuirass' },
      before: {},
      after: {},
      diff: { Life: { before: 2000, after: 2090, delta: 90 }, FireResist: { before: 75, after: 65, delta: -10 }, Str: { before: 10, after: 10, delta: 0 } },
      verdict: { tone: 'worse', text: 'Not recommended.' }
    })
    expect(p.system).toContain('Answer in English')
    expect(p.user).toContain('Item compared: Gloom Shell (Iron Cuirass), RARE, slot Body Armour.')
    expect(p.user).toContain('App verdict: Not recommended.')
    expect(p.user).toContain('- Fire res: 75% → 65%')
    expect(p.user).not.toContain('Str')
  })
})
