import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decodeResult,
  mutableStruct,
  usagePriceSchema,
  type UsagePrice,
  type UsageRecord,
} from '@dovo/protocol'
import { estimatedTurnCost } from '../agents/tasks/estimated-cost.js'
const documentSchema = mutableStruct({
  updatedAt: Schema.String,
  rates: Schema.Record(Schema.String, usagePriceSchema),
})
const priceUrl =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
export class UsagePricing {
  private rates: Record<string, UsagePrice> = {}
  private overrides: Record<string, UsagePrice> = {}
  updatedAt?: string
  private attempt = 0
  private pending?: Promise<void>
  constructor(private readonly db: Database.Database) {
    for (const id of ['usage-prices', 'usage-price-overrides']) {
      const row = decodeResult(
        mutableStruct({ value: Schema.String }),
        db.prepare('SELECT value FROM documents WHERE id = ?').get(id),
      )
      if (!row.success) continue
      try {
        if (id === 'usage-prices') {
          const parsed = decodeResult(documentSchema, JSON.parse(row.data.value))
          if (parsed.success) {
            this.rates = parsed.data.rates
            this.updatedAt = parsed.data.updatedAt
          }
        } else {
          const parsed = decodeResult(
            Schema.Record(Schema.String, usagePriceSchema),
            JSON.parse(row.data.value),
          )
          if (parsed.success) this.overrides = parsed.data
        }
      } catch (cause) {
        console.error('Could not load cached usage pricing', cause)
      }
    }
  }
  getOverrides() {
    return this.overrides
  }
  setOverride(model: string, price: UsagePrice | undefined) {
    const next = { ...this.overrides }
    if (price) next[model] = price
    else delete next[model]
    this.db
      .prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)')
      .run('usage-price-overrides', JSON.stringify(next))
    this.overrides = next
  }
  async refresh(force = false) {
    if (this.pending) return this.pending
    if (
      Date.now() - this.attempt < 60000 ||
      (!force && this.updatedAt && Date.now() - Date.parse(this.updatedAt) < 86400000)
    )
      return
    this.attempt = Date.now()
    this.pending = (async () => {
      const response = await fetch(priceUrl, { signal: AbortSignal.timeout(10000) })
      if (!response.ok) throw new Error(`Pricing refresh failed (${response.status})`)
      const data: unknown = await response.json()
      const rates: Record<string, UsagePrice> = {}
      for (const [id, value] of Object.entries(object(data))) {
        const raw = object(value),
          input = number(raw.input_cost_per_token),
          output = number(raw.output_cost_per_token)
        if (input === undefined || output === undefined) continue
        rates[id] = {
          input: input * 1e6,
          output: output * 1e6,
          cacheRead: (number(raw.cache_read_input_token_cost) ?? input) * 1e6,
          cacheWrite: (number(raw.cache_creation_input_token_cost) ?? input) * 1e6,
        }
      }
      if (!Object.keys(rates).length) throw new Error('Pricing source returned no usable rates')
      const updatedAt = new Date().toISOString()
      this.db
        .prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)')
        .run('usage-prices', JSON.stringify({ updatedAt, rates }))
      this.rates = rates
      this.updatedAt = updatedAt
    })()
    try {
      await this.pending
    } finally {
      this.pending = undefined
    }
  }
  price(record: UsageRecord): UsageRecord {
    const turn = record.turn
    if (!turn.tokenUsage || turn.costSource === 'provider' || turn.mixedModels) return record
    const id = turn.model,
      provider =
        turn.provider === 'codex' ? 'openai' : turn.provider === 'claude' ? 'anthropic' : undefined
    const rate =
      this.overrides[id] ??
      this.rates[id] ??
      (provider ? this.rates[`${provider}/${id}`] : undefined)
    const cost = rate
      ? (turn.tokenUsage.input * rate.input +
          turn.tokenUsage.output * rate.output +
          turn.tokenUsage.cacheRead * rate.cacheRead +
          turn.tokenUsage.cacheWrite * rate.cacheWrite) /
        1e6
      : estimatedTurnCost(turn.provider, id, turn.tokenUsage)
    return {
      ...record,
      turn: {
        ...turn,
        estimatedCostUsd: cost !== undefined && Number.isFinite(cost) ? cost : undefined,
        costSource: cost === undefined || !Number.isFinite(cost) ? undefined : 'estimated',
        pricingVersion: this.overrides[id] ? 'override' : rate ? this.updatedAt : '2026-09',
      },
    }
  }
}
