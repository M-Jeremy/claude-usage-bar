export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  measuredAt: number
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: RateLimit[]
  costUsd?: number
}

export type LastTurn = { durationMs: number; sent: number; received: number; tools: number; costUsd?: number }

export type Anim = { phase: 'idle' | 'work'; t: number; from: number[]; flash: number[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-bar': { snapshot: Snapshot | null; isHidden: boolean; anim: Anim; lastTurn: LastTurn | null; labelBag: string[]; randomAccent: string | null }
  }
}
