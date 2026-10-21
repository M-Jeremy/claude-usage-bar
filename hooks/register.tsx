import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Anim, LastTurn, Snapshot } from '../types'

const snapshot = atom({ plugin: 'usage-bar', key: 'snapshot' } as const, null)
const isHidden = atom({ plugin: 'usage-bar', key: 'isHidden' } as const, false)
const anim = atom({ plugin: 'usage-bar', key: 'anim' } as const, { phase: 'idle', t: 0, from: [], flash: [] })
const lastTurn = atom({ plugin: 'usage-bar', key: 'lastTurn' } as const, null)
const labelBag = atom({ plugin: 'usage-bar', key: 'labelBag' } as const, [] as string[])

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
export type LiveRun = { frame: number; elapsedMs: number; tools: number; label?: string }

// Les stats du dernier run entre crochets, puis le coût total : Last turn [9s · 2 tools · 🡅12k 🡇3k · ~$0.12] - Total cost ~$1.42
export const turnSegments = (turn: LastTurn | null, sessionUsd?: number, live?: LiveRun): StatSegment[] => {
  const dot = seg('  ·  ', true)
  const out: StatSegment[] = []
  if (live) {
    const shape = turn ?? BLANK_RUN
    // Pendant le tour, la ligne parle du tour en cours, sous un libellé tiré au sort à son début.
    out.push(seg(`${live.label ?? 'Working'} `), seg('['), seg(elapsed(live.elapsedMs), true), dot)
    out.push(seg(String(live.tools), true), seg(toolsLabel(live.tools)), dot)
    out.push(
      seg(
        `${UP}${spinDigits(tokensLabel(shape.sent), live.frame)} ${DOWN}${spinDigits(tokensLabel(shape.received), live.frame)}`,
      ),
    )
    if (isCount(shape.costUsd)) out.push(dot, seg(spinDigits(`~${dollars(shape.costUsd)}`, live.frame)))
    out.push(seg(']'))
  } else if (turn) {
    out.push(seg('Last turn '), seg('['), seg(elapsed(turn.durationMs)), dot)
    out.push(seg(`${turn.tools}${toolsLabel(turn.tools)}`), dot)
    out.push(seg(`${UP}${tokensLabel(turn.sent)} ${DOWN}${tokensLabel(turn.received)}`))
    if (isCount(turn.costUsd)) out.push(dot, seg(`~${dollars(turn.costUsd)}`))
    out.push(seg(']'))
  }
  // Un coût nul, en début de conversation, ne s'affiche pas.
  if (isCount(sessionUsd) && sessionUsd > 0) {
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
// Un run va du message de l'utilisateur à la fin du dernier tour qu'il entraîne, sous-agents et tours
// relancés par leurs résultats compris. Ses compteurs : début, outils, tokens envoyés et générés.
let runStartedAt: number | undefined
let toolsThisTurn = 0
let runSent = 0
let runReceived = 0
// Libellé du tour en cours, tiré au sort à chaque message dans un sac : chaque mot sort une fois
// avant que le sac ne se remplisse à nouveau.
export const WORK_LABELS = [
  'Working',
  'Tasking',
  'Running',
  'Thinking',
  'Building',
  'Crafting',
  'Cooking',
  'Brewing',
  'Forging',
  'Weaving',
  'Computing',
  'Processing',
  'Hustling',
]
let workLabel = 'Working'

// Tire un mot du sac ; un sac vide est rempli de tous les mots, sauf celui qui vient de sortir.
export const drawLabel = (bag: string[], last: string, random = Math.random): { label: string; bag: string[] } => {
  const pool = bag.length > 0 ? bag : WORK_LABELS.filter(word => word !== last)
  const index = Math.floor(random() * pool.length)

  return { label: pool[index] ?? 'Working', bag: pool.filter((_, i) => i !== index) }
}
// Coût de la session au début du run, pour en déduire le coût du run.
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

// Le bandeau travaille tant que la conversation a un tour en cours ou qu'un sous-agent tourne encore,
// y compris en arrière-plan après la fin du tour. Le démarrage d'un agent lancé par un outil n'est pas
// entendu : on le compte à l'appel de l'outil Agent, et on le décompte à la fin de son tour.
let isMainTurn = false
let runningAgents = 0
const isBusy = (): boolean => isMainTurn || runningAgents > 0

// Un nouveau message de l'utilisateur ouvre un run : compteurs à zéro, nouveau libellé.
async function beginRun($: EngineInterface): Promise<void> {
  runStartedAt = await $.clock.now()
  toolsThisTurn = 0
  runSent = 0
  runReceived = 0
  costAtStart = (await read($, snapshot))?.costUsd
  const drawn = drawLabel(await read($, labelBag), workLabel)
  workLabel = drawn.label
  await update($, labelBag, () => drawn.bag)
  const from = percentsOf(await read($, snapshot))
  await update($, anim, (): Anim => ({ phase: 'idle', t: 0, from, flash: [] }))
}

// Un tour commence : le bandeau passe en travail, sans remettre le run à zéro.
async function startWork($: EngineInterface): Promise<void> {
  if (runStartedAt === undefined) await beginRun($)
  // Bandeau masqué : aucune animation à faire tourner.
  if (await read($, isHidden)) return
  await update($, anim, (a): Anim => (a.phase === 'work' ? a : { ...a, phase: 'work' }))
  ensureTicker($)
}

export const register: Register = (on, options) => {
  const accent = accentOf(options.accent)
  // La ligne de statistiques au-dessus des jauges, affichée seulement si le réglage showStats vaut true.
  const showStats = options.showStats === true
  stopTick = undefined

  // Ces deux crochets encadrent l'envoi d'un message et chaque outil : si le bandeau échoue,
  // le .catch laisse le message ou l'outil suivre son cours.
  // Seul un message de l'utilisateur ouvre un run ; le résultat d'un agent, remis comme message système
  // (isMeta), ou un message tapé pendant le travail, prolonge le run en cours.
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta && !isBusy()) await beginRun($)

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) isMainTurn = true
    await startWork($)

    return next(e)
  }).catch(($, e, next) => next(e))

  // Chaque outil terminé suit une réponse du modèle : les pourcentages avancent en direct.
  on('tool.call', async ($, e, next) => {
    const isAgent = e.tool === 'Agent'
    if (isAgent) runningAgents += 1
    const result = await next(e)
    // Un appel refusé ou en erreur n'a lancé aucun agent : on le retire du compte.
    if (isAgent && (result.deny !== undefined || result.isError)) runningAgents = Math.max(0, runningAgents - 1)
    toolsThisTurn += 1
    await measure($)

    return result
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    await measure($)
    const usage = e.usage
    if (usage) {
      runSent += usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
      runReceived += usage.output_tokens
    }
    if (e.agentId) runningAgents = Math.max(0, runningAgents - 1)
    else isMainTurn = false
    // Une interruption arrête tout, y compris les sous-agents dont on n'entendrait pas la fin.
    if (!e.agentId && e.isAborted) runningAgents = 0
    // Plus rien ne tourne : le run s'arrête ici, jusqu'à un éventuel tour relancé par un résultat.
    if (!isBusy()) {
      await update($, anim, (a): Anim => ({ ...a, phase: 'idle', t: 0 }))
      const now = await $.clock.now()
      const after = (await read($, snapshot))?.costUsd
      await update(
        $,
        lastTurn,
        (): LastTurn => ({
          durationMs: now - (runStartedAt ?? now),
          sent: runSent,
          received: runReceived,
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
    isMainTurn = false
    runningAgents = 0
    runStartedAt = undefined
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
    // k garde la place de la jauge parmi les valeurs mesurées ; le contexte vide d'une conversation neuve est caché.
    const gauges = [
      { k: 0, label: 'Context', value: contextValue, suffix: contextSuffix, hasBar: false },
      ...snap.rateLimits.map((limit, i) => ({
        k: i + 1,
        label: LABELS[limit.kind] ?? limit.kind,
        value: limit.percentUsed,
        suffix: resetIn(limit.resetsAt, snap.measuredAt),
        hasBar: true,
      })),
    ].filter(gauge => gauge.hasBar || (snap.context.tokens ?? 0) > 0)
    const columns = e.surface === 'terminal' ? e.props.bodyColumns : REMOTE_COLUMNS
    const segments = segmentsFor(
      columns,
      gauges.map(({ label, suffix }) => `${label}  100%${suffix}`),
      gauges.filter(gauge => gauge.hasBar).length,
    )

    const live =
      state.phase === 'work'
        ? {
            frame: state.t,
            elapsedMs: (await $.clock.now()) - (runStartedAt ?? 0),
            tools: toolsThisTurn,
            label: workLabel,
          }
        : undefined
    const stats = showStats ? turnSegments(await read($, lastTurn), snap.costUsd, live) : []
    // Les paires de points des tokens et du coût sont dans l'accent, comme les séparateurs.
    const paintStat = (part: StatSegment) =>
      part.text
        .split(/([⠒⠤]+)/)
        .map(piece =>
          part.isAccent || /^[⠒⠤]+$/.test(piece) ? <Text color={accent}>{piece}</Text> : <Text dimColor>{piece}</Text>,
        )

    // Rien à montrer, comme à l'ouverture d'une conversation : pas de bandeau du tout.
    if (stats.length === 0 && gauges.length === 0) {
      return next(e)
    }

    return (
      <Box flexDirection="column">
        {stats.length > 0 && <Text wrap="truncate-end">{stats.flatMap(paintStat)}</Text>}
        <Box flexDirection="row" flexWrap="wrap" rowGap={0}>
          {gauges.map(({ k, label, value, suffix, hasBar }, index) => {
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
              <Box key={label} flexShrink={0} marginRight={index === gauges.length - 1 ? 0 : SEPARATOR_WIDTH}>
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
