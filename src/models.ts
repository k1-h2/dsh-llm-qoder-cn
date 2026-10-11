/**
 * Live model catalog retrieval from the local Qoder CLI. One short-lived
 * inner session sends the SDK's `get_models` control request; the response
 * (including account-custom models) stays fresh for a TTL, concurrent
 * callers share one in-flight fetch, and the static catalog is the fallback
 * while the CLI is unreachable.
 * @module dsh-llm-qoder/models
 */

import type { ModelInfo } from '@qodercn-ai/qodercn-agent-sdk'
import { qodercliAuth, query } from '@qodercn-ai/qodercn-agent-sdk'
import type { QoderCatalogModel } from './catalog.ts'
import { QODER_MODELS } from './catalog.ts'
import type { Live } from './live.ts'
import { readLive } from './live.ts'

/** How long a fetched catalog stays fresh by default. */
export const DEFAULT_MODEL_CACHE_TTL_MS = 5 * 60_000
/** Give up on one CLI catalog fetch after this long by default. */
export const DEFAULT_FETCH_TIMEOUT_MS = 20_000

/** One fetched catalog snapshot with its freshness stamp. */
interface CatalogSnapshot {
  at: number
  models: readonly ModelInfo[]
}

/**
 * Last successful catalog, shared by every {@link QoderModelCatalog} in this
 * process.
 *
 * A settings write does NOT restart this plugin — a volatile edit is committed
 * into the running cells (see `live.ts`) — so the cache now only has to survive
 * a real remount: enabling the plugin, a profile reload, or a DSH restart. It
 * matters in exactly those cases, because the first settings read after the
 * remount would otherwise cold-start the Qoder CLI and stall the page for
 * seconds.
 *
 * The entry carries its own timestamp and is only used while it is still within
 * the requesting catalog's TTL, so normal freshness is unchanged.
 */
let sharedSnapshot: CatalogSnapshot | undefined

/** Cached live CLI catalog with a static fallback. */
export class QoderModelCatalog {
  private cached: CatalogSnapshot | undefined
  private inflight: Promise<readonly ModelInfo[]> | undefined

  /**
   * @param ttlMs - how long a fetched catalog stays fresh before a re-fetch.
   *   Read per use, so a settings edit takes effect on the next read.
   * @param fetchTimeoutMs - how long one CLI catalog fetch may take before the
   *   static fallback takes over.
   */
  constructor(
    private readonly ttlMs: Live<number>,
    private readonly fetchTimeoutMs: Live<number> = DEFAULT_FETCH_TIMEOUT_MS,
  ) {}

  /**
   * Raw live entries; the stale snapshot when a refresh fails, else nothing.
   *
   * Only the account's own (official) models come back: Qoder CN exposes no
   * user-added models, so filtering here is what keeps the picker and the
   * settings page from disagreeing about what the account has.
   */
  async liveModels(): Promise<readonly ModelInfo[]> {
    const ttlMs = readLive(this.ttlMs, DEFAULT_MODEL_CACHE_TTL_MS)
    const fresh = (snapshot: CatalogSnapshot | undefined): boolean =>
      snapshot !== undefined && Date.now() - snapshot.at < ttlMs
    // Own cache first, then the process-wide one a previous adapter left behind.
    const cached = this.cached ?? sharedSnapshot
    if (fresh(cached) && cached !== undefined) {
      this.cached = cached
      return officialOnly(cached.models)
    }
    this.inflight ??= this.fetch().finally(() => { this.inflight = undefined })
    try {
      const models = await this.inflight
      const snapshot: CatalogSnapshot = { at: Date.now(), models }
      this.cached = snapshot
      sharedSnapshot = snapshot
      return officialOnly(models)
    } catch {
      // A failed refresh keeps serving the last good list rather than dropping
      // to the static fallback, which would hide the account's real models.
      return officialOnly((this.cached ?? sharedSnapshot)?.models ?? [])
    }
  }

  /** dsh catalog entries: the enabled live list, or the static fallback. */
  async models(): Promise<readonly QoderCatalogModel[]> {
    const live = (await this.liveModels()).filter(model => model.isEnabled !== false)
    if (live.length === 0) return QODER_MODELS
    return live.map(model => ({
      id: model.value,
      name: model.displayName.length > 0 ? model.displayName : model.value,
      ...model.description.length > 0 ? { description: model.description } : {},
      // Carry only a verified affirmative: a false or absent flag stays off the
      // entry, so a non-VL live model and the static fallback look identical.
      ...model.isVl === true ? { isVl: true } : {},
    }))
  }
  private async fetch(): Promise<readonly ModelInfo[]> {
    const q = query({
      prompt: inertInput(),
      options: { auth: qodercliAuth(), tools: [], allowedTools: [], settingSources: [], maxTurns: 1 },
    })
    try {
      return await withTimeout(q.getAvailableModels({ fetchStrategy: 'live' }), readLive(this.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS))
    } finally {
      await q.close().catch(() => undefined)
    }
  }
}

/**
 * Keep only the account's official models.
 *
 * Qoder CN exposes no user-added models — the account's catalog *is* the
 * official one — so an entry upstream marks `user`/`custom` is not something
 * this plugin serves. Dropping it here means the picker, the settings page and
 * the request path all agree on one list.
 *
 * @param models - entries as the CLI reported them.
 * @returns the same list without account-added entries.
 */
function officialOnly(models: readonly ModelInfo[]): readonly ModelInfo[] {
  return models.filter(model => model.source !== 'user' && model.source !== 'custom')
}

/**
 * The credit multiplier upstream quotes for one model.
 *
 * Present on every live entry as `priceFactor`; `0` means the model is free.
 * Returned as a number rather than a formatted string so callers decide how to
 * render it.
 *
 * @param entry - one live catalog entry.
 * @returns the multiplier, or undefined when upstream did not quote one.
 */
export function priceFactorOf(entry: { priceFactor?: number }): number | undefined {
  const value = entry.priceFactor
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

/** Streaming prompt that never yields, so no model turn runs during the fetch. */
async function* inertInput(): AsyncGenerator<never> {
  await new Promise<never>(() => {})
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => { reject(new Error(`qoder model catalog fetch timed out after ${ms}ms`)) }, ms)
    promise.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (error: unknown) => { clearTimeout(timer); reject(error) },
    )
  })
}
