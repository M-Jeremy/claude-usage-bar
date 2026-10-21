import { expect, test } from 'claude-code/testing'

import { accentOf, deltaLabel, duration, elapsed, turnLine, turnSegments, filledOf, isFlashing, segmentsFor, shade, shadow, statusHex, tokensLabel } from './register'

const USAGE = {
  startedAt: 0,
  context: { tokens: 50_000, window: 200_000, percent: 25 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 42 }],
  cost: { usd: 1.5 },
}

test('formate barres et durées', () => {
  expect(filledOf(50, 14)).toBe(7)
  expect(duration(3_900_000)).toBe('01h05')
})

test("le contexte affiche l'évolution du tour et les tokens sur la fenêtre", () => {
  expect(deltaLabel(37, 33)).toBe(' +4%')
  expect(deltaLabel(20, 37)).toBe(' −17%')
  expect(deltaLabel(37, 37)).toBe('')
  expect(tokensLabel(74_200)).toBe('74k')
  expect(tokensLabel(1_000_000)).toBe('1M')
  expect(tokensLabel(640)).toBe('640')
})

test('la ligne du dernier tour', () => {
  expect(elapsed(42_000)).toBe('42s')
  expect(elapsed(84_000)).toBe('1m24s')
  expect(elapsed(3_720_000)).toBe('1h02m')
  expect(turnLine({ durationMs: 84_000, sent: 12_300, received: 3_100, tools: 7, costUsd: 0.12 }, 1.418)).toBe(
    'Last run [1m24s  ·  7 tools  ·  🡅12k 🡇3k  ·  ~$0.12]  -  Total cost ~$1.42',
  )
  // Un tour enregistré par une version précédente n'a pas de coût : rien plutôt que NaN.
  const old = { durationMs: 42_000, sent: 1_000, received: 200, tools: 1 } as unknown as Parameters<typeof turnLine>[0]
  expect(turnLine(old)).toBe('Last run [42s  ·  1 tool  ·  🡅1k 🡇200]')
  expect(turnLine(null, 0.5)).toBe('Total cost ~$0.50')
  expect(turnLine(null)).toBe('')
})

test('pendant le tour : durée et outils en direct, tokens et coût en paires de points', () => {
  const last = { durationMs: 84_000, sent: 12_300, received: 3_100, tools: 7, costUsd: 0.12 }
  expect(turnLine(last, 1.418, { frame: 0, elapsedMs: 9_000, tools: 2 })).toBe(
    'Last run [9s  ·  2 tools  ·  🡅⠒⠒k 🡇⠒k  ·  ~$⠒.⠒⠒]  -  Total cost ~$1.42',
  )
  expect(turnLine(null, undefined, { frame: 0, elapsedMs: 0, tools: 0 })).toBe('Last run [0s  ·  0 tools  ·  🡅⠒⠒M 🡇⠒k  ·  ~$⠒.⠒⠒]')
  const accents = turnSegments(last, 1.418, { frame: 0, elapsedMs: 9_000, tools: 2 }).filter(s => s.isAccent).map(s => s.text.trim())
  expect(accents).toEqual(['9s', '·', '2', '·', '·', '-'])
})

test('les barres se partagent la place laissée par les textes', () => {
  expect(segmentsFor(102, ['Context  100% +4% (74k/200k)', 'Session  100% (↻ 01h05)', 'Week  100% (↻ 67h45)'], 2)).toBe(14)
  expect(segmentsFor(30, ['Context  100%', '5h  100%'])).toBe(8)
})

test("pendant le tour, un pourcentage qui gagne un point s'allume 400 ms", () => {
  const work = (t: number) => ({ phase: 'work' as const, t, from: [], flash: [10] })
  expect(isFlashing(work(10), 0)).toBe(true)
  expect(isFlashing(work(13), 0)).toBe(true)
  expect(isFlashing(work(14), 0)).toBe(false)
  expect(isFlashing(work(10), 1)).toBe(false)
  expect(isFlashing({ phase: 'idle', t: 10, from: [], flash: [10] }, 0)).toBe(false)
})

test("la couleur d'accent se règle, avec un repli sur l'orange", () => {
  expect(accentOf('#4fc1ff')).toBe('#4fc1ff')
  expect(accentOf('bleu')).toBe('#e8876a')
  expect(accentOf(undefined)).toBe('#e8876a')
})

test('la couleur de statut est blanche, jaune ou rouge', () => {
  expect(statusHex(40)).toBe('#ffffff')
  expect(statusHex(75)).toBe('#e5c07b')
  expect(statusHex(95)).toBe('#f26b6b')
})

test('au-dessus des seuils, la houle prend leur couleur sur le plein', () => {
  const work = { phase: 'work' as const, t: 0, from: [], flash: [] }
  const crests = Array.from({ length: 14 }, (_, g) => shade(work, g, g, 14, '#e8876a', statusHex(95)))
  expect(crests).not.toContain('#ffffff')
  expect(crests.some(c => c !== 'fill')).toBe(true)
})

test('pendant le tour, la houle assombrit aussi le pourcentage du contexte', () => {
  const work = { phase: 'work' as const, t: 0, from: [], flash: [] }
  const chars = Array.from({ length: 8 }, (_, i) => shadow(work, i))
  expect(chars.some(c => c !== undefined)).toBe(true)
  expect(chars.some(c => c === undefined)).toBe(true)
})

test('la houle assombrit les puces pleines à son passage', () => {
  const work = { phase: 'work' as const, t: 0, from: [], flash: [] }
  const shades = Array.from({ length: 14 }, (_, g) => shade(work, g, g, 7))
  expect(shades.slice(0, 7).some(s => s.startsWith('#'))).toBe(true)
  expect(shades.slice(0, 7)).not.toContain('#ffffff')
  expect(shades.slice(7).every(s => /^#[0-9a-f]{6}$/.test(s))).toBe(true)
})

test('au repos, les puces pleines et vides gardent leur couleur', () => {
  const idle = { phase: 'idle' as const, t: 0, from: [], flash: [] }
  expect(shade(idle, 0, 5, 6)).toBe('fill')
  expect(shade(idle, 0, 6, 6)).toBe('empty')
})

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  test(`le bandeau affiche contexte et limite (${surface})`, async ($, on) => {
    on('session.usage', () => ({ value: USAGE }))
    on('clock.now', () => ({ value: 600_000 }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({ ...USAGE, changed: ['context'] })
    const pane = await $.ui.mount({
      plugin: 'usage-bar',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await pane.findAll({ type: 'Text', text: /25%/ })).not.toHaveLength(0)
    expect(await pane.findAll({ type: 'Text', text: /Session/ })).not.toHaveLength(0)
    expect(await pane.findAll({ type: 'Text', text: /1\.50 \$/ })).toHaveLength(0)
  })
}

for (const showStats of [true, false]) {
  test(`la ligne de statistiques suit le réglage showStats (${showStats})`, { options: { showStats } }, async ($, on) => {
    on('session.usage', () => ({ value: USAGE }))
    on('clock.now', () => ({ value: 600_000 }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({ ...USAGE, changed: ['context'] })
    const band = await $.ui.mount({
      plugin: 'usage-bar',
      surface: 'vscode',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect((await band.findAll({ type: 'Text', text: /Total cost ~\$1\.50/ })).length > 0).toBe(showStats)
  })
}
