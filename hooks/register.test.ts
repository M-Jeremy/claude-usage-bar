import { expect, test } from 'claude-code/testing'

import { bar, duration } from './register'

const USAGE = {
  startedAt: 0,
  context: { tokens: 50_000, window: 200_000, percent: 25 },
  rateLimits: [{ kind: 'five_hour', percentUsed: 42 }],
  cost: { usd: 1.5 },
}

test('formate barres et durées', () => {
  expect(bar(50)).toEqual(['▬▬▬▬', '▬▬▬▬'])
  expect(duration(3_900_000)).toBe('01h05')
})

for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
  test(`le bandeau affiche contexte et limite (${surface})`, async ($, on) => {
    on('session.usage', () => ({ value: USAGE }))
    on('clock.now', () => ({ value: 600_000 }))
    on('session.measure', (_$, e) => ({ changed: e.changed }))
    await $.session.measure({ ...USAGE, changed: ['context'] })
    const pane = await $.ui.mount({
      plugin: 'usage-session',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await pane.findAll({ type: 'Text', text: /25%/ })).not.toHaveLength(0)
    expect(await pane.findAll({ type: 'Text', text: /5h/ })).not.toHaveLength(0)
    expect(await pane.findAll({ type: 'Text', text: /1\.50 \$/ })).toHaveLength(0)
  })
}
