import { useEffect, useState } from 'react'
import type { AiAnswerDTO, AiTopic } from '@shared/ipc'
import { useT, useTracker } from '../store'
import { Button } from './Card'

const PROVIDER_NAMES = { anthropic: 'Claude', openai: 'OpenAI', ollama: 'Ollama' } as const

/**
 * "Ask the AI" for a topic (build coach, item comparison). Sends only when clicked; the player
 * can read beforehand exactly what would be sent.
 */
export function AiExplain({ topic, label, resetKey }: { topic: AiTopic; label: string; resetKey?: unknown }) {
  const t = useT()
  const ai = useTracker((s) => s.status?.ai)
  const language = useTracker((s) => s.status?.language)
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<AiAnswerDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)

  useEffect(() => {
    setAnswer(null)
    setError(null)
    setSent(null)
  }, [resetKey, language, ai?.provider, ai?.model])

  if (!ai?.provider) return null

  const ask = async () => {
    setBusy(true)
    setError(null)
    const res = await window.tracker.askAi(topic)
    setBusy(false)
    if (res.ok) setAnswer(res.value)
    else setError(res.error)
  }

  const toggleSent = async () => {
    if (sent !== null) return setSent(null)
    const res = await window.tracker.aiPreview(topic)
    setSent(res.ok ? `${res.value.system}\n\n---\n\n${res.value.user}` : res.error)
  }

  return (
    <div className="space-y-2" data-testid="ai-explain">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={() => void ask()} disabled={busy}>
          {busy ? t('The AI is thinking…') : answer ? t('Ask again') : label}
        </Button>
        <button type="button" className="text-xs text-stone-500 underline hover:text-stone-300" onClick={() => void toggleSent()}>
          {sent !== null ? t('Hide what is sent') : t('See what is sent')}
        </button>
      </div>
      {sent !== null && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-stone-800 bg-stone-950 p-2 text-[11px] text-stone-400">
          {sent}
        </pre>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {answer && (
        <div className="rounded-md border border-sky-900/60 bg-sky-950/20 p-3" role="note" aria-label={t('AI answer')}>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-200">{answer.answer}</p>
          <p className="mt-2 text-xs text-stone-500">
            {t('Written by {model} ({provider}) from the numbers above. The AI explains; it can be wrong.', {
              model: answer.model,
              provider: PROVIDER_NAMES[answer.provider]
            })}
          </p>
        </div>
      )}
    </div>
  )
}
