import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-session', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'usage-session', key: 'isHidden' } as const, false)

const LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: 'Week',
  spend_limit: 'Plafond',
}


export const bar = (percent: number, width = 8): [filled: string, empty: string] => {
  const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width)

  return ['▬'.repeat(filled), '▬'.repeat(width - filled)]
}

const tone = (percent: number): string | undefined =>
  percent >= 90 ? 'red' : percent >= 70 ? 'yellow' : undefined

export const duration = (ms: number): string => {
  const minutes = Math.max(0, Math.floor(ms / 60000))
  const hours = Math.floor(minutes / 60)

  return `${String(hours).padStart(2, '0')}h${String(minutes % 60).padStart(2, '0')}`
}

export const resetIn = (iso: string | undefined, now: number): string => {
  if (!iso) return ''
  const at = Date.parse(iso)

  return Number.isNaN(at) ? '' : ` (↻ ${duration(at - now)})`
}

async function measure($: EngineInterface): Promise<void> {
  const { context, rateLimits, cost, startedAt } = await $.session.usage()
  const next: Snapshot = {
    startedAt,
    context: { tokens: context.tokens, window: context.window, percent: context.percent },
    rateLimits,
    cost,
    measuredAt: await $.clock.now(),
  }
  await update($, snapshot, () => next)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-session',
      description: "Afficher ou masquer le bandeau d'usage au-dessus du message",
    })
    await measure($)

    return next(e)
  })

  on('command.run', { command: 'usage-session' }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return { text: hidden ? 'Bandeau d\'usage masqué.' : 'Bandeau d\'usage affiché.' }
  })

  on('session.measure', async ($, e, next) => {
    await measure($)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapshot)

    if (e.props.hasSurvey || snap === null || (await read($, isHidden))) {
      return next(e)
    }

    const now = snap.measuredAt
    const percent = snap.context.percent ?? 0

    const { Text } = $.ui.resolve(e)
    const gauge = (label: string, value: number, suffix = '') => {
      const [filled, empty] = bar(value)

      return [
        <Text dimColor>{label} </Text>,
        <Text color={tone(value)}>{filled}</Text>,
        <Text dimColor>{empty}</Text>,
        <Text color={tone(value)}> {value}%</Text>,
        <Text dimColor>{suffix}   </Text>,
      ]
    }

    return (
      <Text wrap="truncate-end">
        {gauge('Context', percent)}
        {snap.rateLimits.map(limit =>
          gauge(LABELS[limit.kind] ?? limit.kind, limit.percentUsed, resetIn(limit.resetsAt, now)),
        )}
      </Text>
    )
  })
}
