import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Anim, LastTurn, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)
const anim = atom({ plugin: 'usage-bar', key: 'anim' } as const, { phase: 'idle', t: 0, from: [], flash: [] })
const lastTurn = atom({ plugin: 'usage-bar', key: 'lastTurn' } as const, null)

const LABELS: Record<string, string> = {
  five_hour: 'Session',
  seven_day: 'Week',
  spend_limit: 'Spend limit',
}

const MIN_SEGMENTS = 8
const MAX_SEGMENTS = 40
// L'éditeur et l'application annoncent une largeur fixe sans rapport avec la place réelle :
// on suppose une ligne d'environ 102 caractères, la place observée dans le bandeau de l'éditeur.
const REMOTE_COLUMNS = 102
// Un espace entre deux jauges.
const SEPARATOR_WIDTH = 1
// Une puce par segment, la part consommée en couleur de statut, le reste en gris sombre.
const BULLET = '•'
const EMPTY_COLOR = '#4a4a4a'
// Environ 8 images par seconde.
const TICK_MS = 120
// Pendant le tour, un pourcentage qui gagne un point s'allume dans la couleur d'accent pendant 400 ms.
const FLASH_MS = 400

// Couleurs de statut : blanc sous 70 %, jaune à partir de 70 %, rouge à partir de 90 %.
const WHITE = '#ffffff'
const YELLOW = '#e5c07b'
const RED = '#f26b6b'
const DEFAULT_ACCENT = '#e8876a'
// Fond du bandeau vers lequel les teintes sombres se fondent.
const GROUND = '#252526'

export const filledOf = (percent: number, segments: number): number =>
  Math.round((Math.min(100, Math.max(0, percent)) / 100) * segments)

// Toutes les barres ont la même longueur : la place que les textes laissent libre, partagée entre elles.
export const segmentsFor = (columns: number, texts: string[], bars = texts.length): number => {
  const taken = texts.reduce((sum, text) => sum + text.length, 0) + (texts.length - 1) * SEPARATOR_WIDTH

  return Math.min(MAX_SEGMENTS, Math.max(MIN_SEGMENTS, Math.floor((columns - taken) / Math.max(1, bars))))
}

export const statusHex = (percent: number): string => (percent >= 90 ? RED : percent >= 70 ? YELLOW : WHITE)

const mix = (a: string, b: string, k: number): string => {
  const ch = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  const out = [0, 1, 2].map(i => Math.round(ch(a, i) * (1 - k) + ch(b, i) * k))

  return `#${out.map(v => v.toString(16).padStart(2, '0')).join('')}`
}

// La couleur d'accent des réglages, ou l'orange par défaut si elle n'est pas un hexadécimal.
export const accentOf = (accent: unknown): string =>
  typeof accent === 'string' && /^#[0-9a-f]{6}$/i.test(accent.trim()) ? accent.trim() : DEFAULT_ACCENT

// 'fill' et 'empty' : couleurs de statut et de vide ; sinon une couleur calculée.
export type Shade = 'fill' | 'empty' | string

const msOf = (t: number): number => t * TICK_MS

// La houle à la position g et à l'image t, entre -1 et 1 ; elle avance d'une case par image environ.
const wave = (g: number, t: number): number => Math.sin((g - t * 0.9) * 0.9)

// L'ombre de la houle sur un élément plein à la position g : plus sombre au passage de la vague,
// dans sa couleur de statut ; rien entre deux vagues.
export const shadow = (anim: Anim, g: number, hue = WHITE): string | undefined => {
  const w = wave(g, anim.t)

  return w > 0.6 ? mix(hue, GROUND, 0.45) : w > 0.2 ? mix(hue, GROUND, 0.25) : undefined
}

export const shade = (anim: Anim, g: number, i: number, to: number, accent = DEFAULT_ACCENT, hue = WHITE): Shade => {
  if (anim.phase !== 'work') return i < to ? 'fill' : 'empty'
  if (i < to) return shadow(anim, g, hue) ?? 'fill'

  // Sur le vide, trois teintes de l'accent fondues dans le fond selon la hauteur de la vague.
  const w = wave(g, anim.t)

  return mix(accent, GROUND, w > 0.6 ? 0.35 : w > 0 ? 0.6 : 0.75)
}

// Pendant le tour, un pourcentage s'allume dans la couleur d'accent juste après avoir gagné un point.
export const isFlashing = (anim: Anim, k: number): boolean => {
  const at = anim.flash[k]

  return anim.phase === 'work' && at !== undefined && msOf(anim.t - at) < FLASH_MS
}

// Un nombre de tokens tel quel sous 1 000, sinon en milliers ou en millions : 640, 74k, 1M.
export const tokensLabel = (tokens: number): string =>
  tokens >= 1_000_000
    ? `${Math.round(tokens / 100_000) / 10}M`
    : tokens >= 1000
      ? `${Math.round(tokens / 1000)}k`
      : `${Math.round(tokens)}`

// Ce que le dernier tour a changé, en points : +4%, −2% ; rien quand il n'a rien changé.
export const deltaLabel = (value: number, from: number | undefined): string => {
  const delta = Math.round(value - (from ?? value))

  return delta > 0 ? ` +${delta}%` : delta < 0 ? ` −${-delta}%` : ''
}

// Durée d'un tour : 42s, 1m24s, 1h02m.
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// La ligne du dernier tour : durée, outils, tokens envoyés et générés et coût, puis coût total estimé de la conversation.
const UP = '🡅'
const DOWN = '🡇'

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)
const dollars = (usd: number): string => `$${usd.toFixed(2)}`

// Pendant un tour, les chiffres des tokens et du coût deviennent des paires de points côte à côte qui alternent
// entre deux lignes de la case ; unités, points et longueur restent ceux du run précédent.
const SPINNER = '⠒⠤'
// Nombre d'images entre deux positions des paires, soit environ 0,5 s.
const SPINNER_TICKS = 4
// Sans run précédent, un gabarit : deux chiffres en millions pour l'envoi, un en milliers pour la réception.
const BLANK_RUN: LastTurn = { durationMs: 0, sent: 10_000_000, received: 1000, tools: 0, costUsd: 0 }

// Toutes les paires changent de ligne en même temps.
const spinDigits = (text: string, frame: number): string =>
  text.replace(/\d/g, SPINNER[Math.floor(frame / SPINNER_TICKS) % SPINNER.length] ?? '')

// Un morceau de la ligne, dans la couleur d'accent ou en gris.
export type StatSegment = { text: string; isAccent: boolean }

const seg = (text: string, isAccent = false): StatSegment => ({ text, isAccent })
const toolsLabel = (n: number): string => (n === 1 ? ' tool' : ' tools')

// Le tour en cours : durée et outils en direct dans l'accent, tokens et coût en paires de points.
export type LiveRun = { frame: number; elapsedMs: number; tools: number }

// Les stats du dernier run entre crochets, puis le coût total : Last run [9s · 2 tools · 🡅12k 🡇3k · $0.12] - Total cost ~$1.42
export const turnSegments = (turn: LastTurn | null, sessionUsd?: number, live?: LiveRun): StatSegment[] => {
  const dot = seg('  ·  ', true)
  const out: StatSegment[] = []
  if (live) {
    const shape = turn ?? BLANK_RUN
    out.push(seg('Last run '), seg('['), seg(elapsed(live.elapsedMs), true), dot)
    out.push(seg(String(live.tools), true), seg(toolsLabel(live.tools)), dot)
    out.push(
      seg(
        `${UP}${spinDigits(tokensLabel(shape.sent), live.frame)} ${DOWN}${spinDigits(tokensLabel(shape.received), live.frame)}`,
      ),
    )
    if (isCount(shape.costUsd)) out.push(dot, seg(spinDigits(`~${dollars(shape.costUsd)}`, live.frame)))
    out.push(seg(']'))
  } else if (turn) {
    out.push(seg('Last run '), seg('['), seg(elapsed(turn.durationMs)), dot)
    out.push(seg(`${turn.tools}${toolsLabel(turn.tools)}`), dot)
    out.push(seg(`${UP}${tokensLabel(turn.sent)} ${DOWN}${tokensLabel(turn.received)}`))
    if (isCount(turn.costUsd)) out.push(dot, seg(`~${dollars(turn.costUsd)}`))
    out.push(seg(']'))
  }
  if (isCount(sessionUsd)) {
    if (out.length > 0) out.push(seg('  -  ', true))
    out.push(seg(`Total cost ~${dollars(sessionUsd)}`))
  }

  return out
}

export const turnLine = (turn: LastTurn | null, sessionUsd?: number, live?: LiveRun): string =>
  turnSegments(turn, sessionUsd, live)
    .map(part => part.text)
    .join('')

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

const percentsOf = (snap: Snapshot | null): number[] =>
  snap ? [snap.context.percent ?? 0, ...snap.rateLimits.map(limit => limit.percentUsed)] : []

async function measure($: EngineInterface): Promise<void> {
  const { context, rateLimits, cost } = await $.session.usage()
  const next: Snapshot = {
    context: { tokens: context.tokens, window: context.window, percent: context.percent },
    rateLimits,
    costUsd: cost?.usd,
    measuredAt: await $.clock.now(),
  }
  const before = percentsOf(await read($, snapshot))
  await update($, snapshot, () => next)
  const after = percentsOf(next)
  await update($, anim, (a): Anim => {
    if (a.phase !== 'work') return a
    const flash = after.map((v, k) => (Math.floor(v) > Math.floor(before[k] ?? v) ? a.t : (a.flash[k] ?? -1e9)))

    return { ...a, flash }
  })
}

let stopTick: (() => void) | undefined
// Appels d'outils du tour en cours, sous-agents compris.
let toolsThisTurn = 0
// Coût de la session au début du tour, pour en déduire le coût du tour.
let costAtStart: number | undefined

// L'horloge des animations : elle tourne pendant un tour et s'arrête à sa fin.
function ensureTicker($: EngineInterface): void {
  if (stopTick) return
  const timer = $.clock.every(TICK_MS, async () => {
    const now = await update($, anim, (a): Anim => (a.phase === 'work' ? { ...a, t: a.t + 1 } : a))
    if (now.phase !== 'work') {
      timer.cancel()
      stopTick = undefined
    }
  })
  stopTick = () => timer.cancel()
}

async function startTurn($: EngineInterface): Promise<void> {
  toolsThisTurn = 0
  costAtStart = (await read($, snapshot))?.costUsd
  // Bandeau masqué : aucune animation à faire tourner.
  if (await read($, isHidden)) return
  const from = percentsOf(await read($, snapshot))
  await update($, anim, (): Anim => ({ phase: 'work', t: 0, from, flash: [] }))
  ensureTicker($)
}

export const register: Register = (on, options) => {
  const accent = accentOf(options.accent)
  // La ligne de statistiques au-dessus des jauges, affichée seulement si le réglage showStats vaut true.
  const showStats = options.showStats === true
  stopTick = undefined

  // Ces deux crochets encadrent l'envoi d'un message et chaque outil : si le bandeau échoue,
  // le .catch laisse le message ou l'outil suivre son cours.
  on('prompt.submit', async ($, e, next) => {
    await startTurn($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Chaque outil terminé suit une réponse du modèle : les pourcentages avancent en direct.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    toolsThisTurn += 1
    await measure($)

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await measure($)
    // La fin du tour d'un sous-agent ne termine pas celui de la conversation.
    if (!e.agentId) {
      await update($, anim, (a): Anim => ({ ...a, phase: 'idle', t: 0 }))
      const after = (await read($, snapshot))?.costUsd
      const usage = e.usage
      await update(
        $,
        lastTurn,
        (): LastTurn => ({
          durationMs: e.durationMs,
          sent: usage ? usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens : 0,
          received: usage?.output_tokens ?? 0,
          costUsd: isCount(costAtStart) && isCount(after) ? after - costAtStart : undefined,
          tools: toolsThisTurn,
        }),
      )
    }

    return next(e)
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'usage-bar',
      description: 'Show or hide the usage bar above the message box',
    })
    // Un rechargement coupe l'horloge : une animation restée en cours repart au repos.
    await update($, anim, (a): Anim => ({ ...a, phase: 'idle', t: 0 }))
    await measure($)

    return next(e)
  })

  on('command.run', { command: 'usage-bar' }, async $ => {
    const hidden = await update($, isHidden, value => !value)

    return {
      text: hidden ? 'Usage bar hidden.' : 'Usage bar shown.',
    }
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

    const state = await read($, anim)
    const { Box, Text } = $.ui.resolve(e)
    const paint = (s: Shade, value: number): string =>
      s === 'fill' ? statusHex(value) : s === 'empty' ? EMPTY_COLOR : s

    const contextValue = snap.context.percent ?? 0
    // Le contexte n'a pas de barre : son pourcentage, l'évolution du dernier tour et les tokens sur la fenêtre.
    const contextSuffix = `${deltaLabel(contextValue, state.from[0])} (${tokensLabel(snap.context.tokens ?? 0)}/${tokensLabel(snap.context.window)})`
    const gauges = [
      { label: 'Context', value: contextValue, suffix: contextSuffix, hasBar: false },
      ...snap.rateLimits.map(limit => ({
        label: LABELS[limit.kind] ?? limit.kind,
        value: limit.percentUsed,
        suffix: resetIn(limit.resetsAt, snap.measuredAt),
        hasBar: true,
      })),
    ]
    const columns = e.surface === 'terminal' ? e.props.bodyColumns : REMOTE_COLUMNS
    const segments = segmentsFor(
      columns,
      gauges.map(({ label, suffix }) => `${label}  100%${suffix}`),
      gauges.filter(gauge => gauge.hasBar).length,
    )

    const live =
      state.phase === 'work' ? { frame: state.t, elapsedMs: state.t * TICK_MS, tools: toolsThisTurn } : undefined
    const stats = showStats ? turnSegments(await read($, lastTurn), snap.costUsd, live) : []
    // Les paires de points des tokens et du coût sont dans l'accent, comme les séparateurs.
    const paintStat = (part: StatSegment) =>
      part.text
        .split(/([⠒⠤]+)/)
        .map(piece =>
          part.isAccent || /^[⠒⠤]+$/.test(piece) ? <Text color={accent}>{piece}</Text> : <Text dimColor>{piece}</Text>,
        )

    return (
      <Box flexDirection="column">
        {stats.length > 0 && <Text wrap="truncate-end">{stats.flatMap(paintStat)}</Text>}
        <Box flexDirection="row" flexWrap="wrap" rowGap={0}>
          {gauges.map(({ label, value, suffix, hasBar }, k) => {
            const hue = statusHex(value)
            const to = filledOf(value, segments)
            // Les puces voisines de même couleur partagent un seul texte.
            const runs: { color: string; text: string }[] = []
            for (let i = 0; i < (hasBar ? segments : 0); i++) {
              const color = paint(shade(state, k * segments + i, i, to, accent, hue), value)
              const last = runs[runs.length - 1]
              if (last && last.color === color) last.text += BULLET
              else runs.push({ color, text: BULLET })
            }
            const percentText = `${hasBar ? ' ' : ''}${value}%`
            // Pendant le tour, la houle passe aussi sur le pourcentage du contexte, caractère par caractère,
            // sauf quand il vient de gagner un point et s'allume dans la couleur d'accent.
            const percentRuns = isFlashing(state, k)
              ? [{ color: accent, text: percentText }]
              : !hasBar && state.phase === 'work'
                ? [...percentText].map((text, i) => ({ color: shadow(state, i, hue) ?? hue, text }))
                : [{ color: hue, text: percentText }]

            return (
              <Box key={label} flexShrink={0} marginRight={k === gauges.length - 1 ? 0 : SEPARATOR_WIDTH}>
                <Text wrap="truncate-end">
                  <Text dimColor>{label} </Text>
                  {[...runs, ...percentRuns].map(run => (
                    <Text color={run.color}>{run.text}</Text>
                  ))}
                  <Text dimColor>{suffix}</Text>
                </Text>
              </Box>
            )
          })}
        </Box>
      </Box>
    )
  })
}
