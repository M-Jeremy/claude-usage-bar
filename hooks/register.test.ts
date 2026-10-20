import { expect, test } from 'claude-code/testing'

import { accentOf, deltaLabel, duration, filledOf, isFlashing, segmentsFor, shade, shadow, statusHex, tokensLabel } from './register'

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
})

test('les barres se partagent la place laissée par les textes', () => {
  expect(segmentsFor(106, ['Context  100% +4% (74k/200k)', 'Session  100% (↻ 01h05)', 'Week  100% (↻ 67h45)'], 2)).toBe(16)
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
