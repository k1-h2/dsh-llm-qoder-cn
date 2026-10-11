/**
 * The settings page's data source, served same-origin.
 *
 * The page cannot read the model catalog from the config form: the catalog is
 * fetched live from the Qoder CLI, while the form only carries what the user
 * stored. So the host answers one read-only JSON route that joins the two:
 *
 * - `GET <prefix>/models` — every model the account exposes, each with its
 *   enabled state, the window it will use, and the windows it may use.
 *
 * Writes deliberately do NOT come through here. The browser half already holds
 * a revision-fenced form for this plugin's config namespace
 * (`ctx.configForms.get(ns)`), and routing every change through it means one
 * write path, one revision fence, and no second owner of the same document. A
 * host-side write would have to reach into the settings service and could race
 * the form.
 *
 * @module dsh-llm-qoder-cn/api
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { QoderAdapter } from './adapter.ts'
import { priceFactorOf } from './models.ts'

/** Route prefix this plugin owns; the client resolves it relative to the page. */
export const API_PREFIX = '/api/llm-qoder-cn'

/** One model row as the page renders it. */
interface ModelRow {
  /** Qoder model id, the identity every write uses. */
  id: string
  /** Display name. */
  name: string
  /** Model description, when upstream provides one. */
  description?: string
  /** Whether the user currently allows this model in the picker. */
  enabled: boolean
  /** Whether the model accepts image input. */
  vision: boolean
  /** Where the model came from; `user`/`custom` mark account-added models. */
  source?: string
  /** Window the requests will actually use, in tokens. */
  contextWindow: number
  /** Windows the user may choose from, ascending. Always contains the current one. */
  contextWindows: number[]
  /** Upstream's own window for this model, i.e. what "default" means here. */
  defaultContextWindow: number
  /** The user's explicit choice, or undefined when following upstream. */
  override?: number
  /**
   * Credit multiplier upstream quotes for this model; `0` means free. Absent
   * when upstream quoted none, so the page shows no suffix rather than a
   * fabricated one.
   */
  priceFactor?: number
  /** Whether the model supports a reasoning-effort choice. */
  reasoning: boolean
}

/** Answer one request with JSON. */
function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/**
 * Build the model rows: the live catalog joined with the user's choices.
 *
 * @param adapter - the adapter owning the live catalog and the resolved config.
 * @returns one row per model the account exposes, in catalog order.
 */
export async function buildRows(adapter: QoderAdapter): Promise<ModelRow[]> {
  const live = await adapter.describeCatalog()
  return live.map(entry => {
    const override = adapter.contextWindowFor(entry.value)
    const upstream = entry.defaultContextWindow
      ?? (entry.availableContextWindows !== undefined && entry.availableContextWindows.length > 0
        ? Math.max(...entry.availableContextWindows)
        : entry.maxInputTokens)
      ?? 200_000
    // Offer upstream's declared windows, plus the effective one so the select
    // never shows a value it cannot re-select.
    const choices = new Set<number>(entry.availableContextWindows ?? [])
    choices.add(upstream)
    if (override !== undefined) choices.add(override)
    const priceFactor = priceFactorOf(entry)
    return {
      id: entry.value,
      name: entry.displayName.length > 0 ? entry.displayName : entry.value,
      ...entry.description.length > 0 ? { description: entry.description } : {},
      enabled: !adapter.isModelDisabled(entry.value),
      vision: entry.isVl === true,
      ...entry.source === undefined ? {} : { source: entry.source },
      contextWindow: override ?? upstream,
      contextWindows: [...choices].sort((a, b) => a - b),
      defaultContextWindow: upstream,
      ...override === undefined ? {} : { override },
      ...priceFactor === undefined ? {} : { priceFactor },
      reasoning: entry.isReasoning !== false,
    }
  })
}

/**
 * Handle one request under {@link API_PREFIX}.
 *
 * @param req - the incoming request.
 * @param res - the response this handler owns.
 * @param adapter - the adapter whose live catalog backs the list.
 */
export async function handleApi(req: IncomingMessage, res: ServerResponse, adapter: QoderAdapter): Promise<void> {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(API_PREFIX.length) || '/'
    const method = req.method ?? 'GET'

    if (path === '/models' && method === 'GET') {
      send(res, 200, { models: await buildRows(adapter) })
      return
    }

    send(res, method === 'GET' ? 404 : 405, { error: method === 'GET' ? 'not found' : '只支持读取' })
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
}
