import type { ReactNode } from 'react'

export function Card({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-stone-800 bg-stone-900/60 p-4">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-400">{title}</h2>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary'
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  variant?: 'primary' | 'ghost'
}) {
  const base = 'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40'
  const style =
    variant === 'primary'
      ? 'bg-ember-500 text-stone-950 hover:bg-ember-400'
      : 'border border-stone-700 text-stone-300 hover:bg-stone-800'
  return (
    <button type="button" className={`${base} ${style}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
