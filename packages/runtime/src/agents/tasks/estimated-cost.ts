import type { Agent } from '@dovo/protocol'
import type { TurnTokenUsage } from './context-usage.js'

// Standard API text prices in USD per million tokens (September 2026).
// https://developers.openai.com/api/docs/pricing and https://platform.claude.com/docs/en/about-claude/pricing
type Rates = { input: number; output: number; cacheRead: number; cacheWrite: number }
const openai: Record<string, Rates> = {
  'gpt-6-astra': { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  'gpt-6-sol': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-6-luna': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  'gpt-5.6-sol': { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5 },
  'gpt-5.6-terra': { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 2.5 },
  'gpt-5.6-luna': { input: 0.2, output: 1.2, cacheRead: 0.02, cacheWrite: 0.25 },
}
const claude: Record<string, Rates> = {
  'claude-opus-4-6': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-sonnet-4-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
}

/** Subscription turns are valued at standard API list rates, not billed dollars. */
export function estimatedTurnCost(
  provider: Agent['provider'],
  model: string,
  usage: TurnTokenUsage | undefined,
): number | undefined {
  if (!usage) return undefined
  const claudeModel = model.replace(/-\d{8}$/, '')
  const rates =
    provider === 'codex' ? openai[model] : provider === 'claude' ? claude[claudeModel] : undefined
  if (!rates) return undefined
  return (
    (usage.input * rates.input +
      usage.output * rates.output +
      usage.cacheRead * rates.cacheRead +
      usage.cacheWrite * rates.cacheWrite) /
    1_000_000
  )
}
