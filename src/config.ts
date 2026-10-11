/**
 * The plugin's configuration surface.
 *
 * DSH's settings service reads a plugin's exported `Config` schema and, when no
 * custom page is registered for that entry, auto-generates a settings page from
 * it (`autoGenerate` defaults to true in `dsh-settings`). That makes this schema
 * the single source of truth for both runtime behaviour and the settings UI —
 * every field documented here appears as a labelled control, and its
 * `description` becomes the help text under it.
 *
 * Field order matters: the generated form renders in declaration order, so the
 * groups below are arranged the way a user reads them (identity → capacity →
 * context → timeouts → models → aliases).
 *
 * @module dsh-llm-qoder-cn/config
 */

import { isVolatile } from '@deepseek-ai/cosmokit'
import z from '@deepseek-ai/schemastery'

/** How to treat the account's custom (user-added) models on the main route. */
export const BYOK_ROUTES = ['separate', 'inline'] as const
export type ByokRoute = (typeof BYOK_ROUTES)[number]

/** Human labels for {@link BYOK_ROUTES}. */
export const BYOK_ROUTE_NAMES: Readonly<Record<ByokRoute, string>> = {
  separate: 'Separate route (qoder-cn-byok)',
  inline: 'Merge into the main route',
}

/**
 * The plugin configuration as authored in a profile patch.
 *
 * These are the values a user writes; at runtime every one of them arrives
 * wrapped in a `Volatile<T>` reference (see {@link ConfigSchema}), which
 * {@link resolveConfig} unwraps. Keep this interface as the authoring shape and
 * `ResolvedConfig` as the runtime shape.
 *
 * Every field is optional and defaulted, so an empty config — the profile row
 * DSH inserts by default — runs with the tuned defaults below.
 */
export interface Config {
  // ── Models: the only settings most users touch ──────────────────────────
  /**
   * Model ids the user switched OFF in the settings page.
   *
   * Stored as a deny-list rather than an allow-list so a newly published model
   * appears enabled by default: the account's catalog changes upstream, and a
   * stored allow-list would silently hide anything added after it was written.
   *
   * Ids are Qoder SDK values (e.g. `qmodel_38max`).
   */
  disabledModels?: string[]
  /**
   * Per-model context window in tokens, keyed by Qoder model id.
   *
   * A model with no entry uses the window upstream declares for it, which is
   * what its own session actually runs with. A larger value makes the request
   * use that window, but it also raises the harness's auto-compaction
   * threshold, so a conversation can grow past what the provider accepts
   * before compaction fires.
   */
  modelContextWindows?: Record<string, number>
  /**
   * Extra aliases mapping a harness-side model id onto a Qoder SDK value,
   * merged over the built-in `deepseek-v4-*` ones.
   */
  modelAliases?: Record<string, string>

  // ── Advanced: sensible defaults, rarely changed ─────────────────────────
  /**
   * Whether the account's custom models get their own provider route.
   * `separate` keeps them in a second picker group; `inline` merges them in.
   */
  byokRoute?: ByokRoute
  /**
   * Display name of the primary provider group in the model picker.
   */
  displayName?: string
  /**
   * Display name of the secondary group carrying the account's own models.
   * Only used when `byokRoute` is `separate`.
   */
  byokDisplayName?: string
  /**
   * How many warm inner Qoder CLI sessions to keep alive at once. One warm
   * session exists per DSH session id; beyond this cap the least recently used
   * one is closed. Each warm session is a subprocess.
   */
  maxSessions?: number
  /**
   * Seconds a fetched CLI model catalog stays fresh before it is re-fetched.
   */
  modelCacheTtlSeconds?: number
  /**
   * Reasoning effort used when a request names none. Empty uses upstream's own
   * default for the model.
   */
  defaultReasoningEffort?: string
  /**
   * Prepend an identity block telling the inner model to answer as the host's
   * agent and not to disclose that it is Qoder.
   *
   * Defaults to **false**, and deliberately so. Upstream ships an equivalent
   * helper but never calls it, so the default matches what actually ran before:
   * the model answers as Qoder. Turning this on makes the assistant deny its own
   * provenance, which is a product decision to make knowingly.
   */
  identityOverride?: boolean
  /**
   * Output-token cap assumed when a model does not report one.
   */
  defaultMaxTokens?: number
  /**
   * Seconds the inner model waits for a host tool result before that call is
   * cancelled.
   */
  toolResultTimeoutSeconds?: number
  /**
   * Seconds to wait for the CLI model catalog before using the static fallback.
   */
  catalogFetchTimeoutSeconds?: number
  /**
   * Seconds to wait for the inner process to acknowledge an abort.
   */
  abortGraceSeconds?: number
  /**
   * Maximum inner turns for one side-channel request (title, compaction).
   */
  coldMaxTurns?: number
}

/**
 * The configuration schema. This is what DSH turns into the settings page, so
 * the defaults and bounds here are user-visible documentation.
 *
 * ## Why every field is `.volatile()`
 *
 * DSH's settings service builds its form from `volatileForm(schema)`, which
 * keeps a field ONLY when the node (or an ancestor) carries `meta.volatile`;
 * an object whose fields are all non-volatile collapses to `undefined` and the
 * whole namespace is dropped from `describe()` before any client sees it. A
 * plugin with a plain schema therefore registers successfully, streams models
 * correctly, and still shows no settings page anywhere — the namespace never
 * reaches the wire.
 *
 * `.volatile()` also declares the intended semantics: the value is a stable
 * reference holding immutable data, and edits apply live. That is exactly how
 * this plugin consumes its config — the adapter reads it at mount, and every
 * field is a plain scalar, list, or map.
 */
export const Config = z.object({
  // ── Models: the only settings most users touch ──────────────────────────
  // These two are the model page's data source. The settings page renders the
  // live catalog with a switch per model and a window choice per model, and
  // writes back through these fields.
  disabledModels: z.array(z.string()).default([]).description('已关闭的模型 ID 列表（以 Qoder 模型 ID 为准）。关闭的模型不会出现在模型选择器里。').volatile(),
  modelContextWindows: z.dict(z.number()).default({}).description('按模型指定上下文窗口（token 数）。未指定的模型使用上游声明的窗口。').volatile(),

  // ── 高级：一般无需改动 ─────────────────────────────────────────────────
  byokRoute: z.union(BYOK_ROUTES).default('separate').description('账号自定义模型的展示方式：独立分组，或并入主分组。').volatile(),
  displayName: z.string().default('Qoder CN').description('模型选择器里主分组的名称。同时使用多个 Qoder 账号时可区分。').volatile(),
  byokDisplayName: z.string().default('Qoder CN 自定义').description('自定义模型分组的名称，仅在「独立分组」时使用。').volatile(),
  maxSessions: z.number().step(1).min(1).max(64).default(8).description('同时保持的内层会话数上限，超出后按最久未使用关闭。每个会话是一个子进程。').volatile(),
  modelCacheTtlSeconds: z.number().step(1).min(10).max(86_400).default(300).description('模型列表缓存时长（秒）。调小可更快看到账号侧变化。').volatile(),
  modelAliases: z.dict(z.string()).default({}).description('额外的模型别名映射：DSH 侧名称 → Qoder 模型 ID。内置 deepseek-v4-* 别名仍然生效。').volatile(),
  defaultReasoningEffort: z.string().default('').description('请求未指定思考档位时使用的默认档位；留空则用上游默认。').volatile(),
  identityOverride: z.boolean().default(false).description('让内层模型以宿主 Agent 的身份回答，且不透露自己是 Qoder。默认关闭：开启后助手会否认自身来源，请自行决定。').volatile(),
  defaultMaxTokens: z.number().step(1).min(1).default(32_000).description('模型未声明输出上限时使用的输出上限。').volatile(),
  toolResultTimeoutSeconds: z.number().step(1).min(5).max(3_600).default(120).description('内层模型等待宿主返回工具结果的时限（秒），超时则取消该次工具调用。').volatile(),
  catalogFetchTimeoutSeconds: z.number().step(1).min(1).max(300).default(20).description('拉取模型列表的时限（秒），超时后回退到内置列表。').volatile(),
  abortGraceSeconds: z.number().step(1).min(1).max(120).default(5).description('内层进程确认中断的宽限时间（秒）。').volatile(),
  coldMaxTurns: z.number().step(1).min(1).max(32).default(4).description('旁路请求（生成标题、压缩摘要）允许的最大内层轮次。').volatile(),
})

/** Fully-resolved options with every default applied. */
export interface ResolvedConfig {
  displayName: string
  byokDisplayName: string
  byokRoute: ByokRoute
  maxSessions: number
  modelCacheTtlMs: number
  defaultMaxTokens: number
  toolResultTimeoutMs: number
  catalogFetchTimeoutMs: number
  abortGraceMs: number
  coldMaxTurns: number
  disabledModels: readonly string[]
  modelContextWindows: Readonly<Record<string, number>>
  modelAliases: Readonly<Record<string, string>>
  identityOverride: boolean
  defaultReasoningEffort: string | undefined
}

/**
 * A parsed config as it arrives at `apply()`: every field wrapped in the
 * `Volatile<T>` reference its `.volatile()` schema produces.
 *
 * Typed structurally rather than with `Volatile<T>` per field so the module
 * needs no import of the wrapper type, and so a plain (non-volatile) config
 * still satisfies it — which is what tests and direct callers pass.
 */
export type ParsedConfig = { readonly [K in keyof Config]?: unknown }

/**
 * Apply defaults to a parsed config.
 *
 * `apply()` receives whatever the loader composed, which for a profile row with
 * no explicit `config:` block is `{}`. Volatile fields arrive as references, so
 * they are unwrapped first; the rest of the plugin then works with plain values.
 *
 * @param config - the parsed plugin config, possibly partial.
 * @returns the same values with every default filled in.
 */
export function resolveConfig(config: ParsedConfig | undefined): ResolvedConfig {
  const raw = unwrap(config ?? {})
  const byok = raw.byokRoute === 'inline' ? 'inline' : 'separate'
  const effort = typeof raw.defaultReasoningEffort === 'string' ? raw.defaultReasoningEffort.trim() : ''
  return {
    displayName: nonEmpty(raw.displayName, 'Qoder CN'),
    byokDisplayName: nonEmpty(raw.byokDisplayName, 'Qoder CN 自定义'),
    byokRoute: byok,
    maxSessions: positive(raw.maxSessions, 8),
    modelCacheTtlMs: positive(raw.modelCacheTtlSeconds, 300) * 1_000,
    defaultMaxTokens: positive(raw.defaultMaxTokens, 32_000),
    toolResultTimeoutMs: positive(raw.toolResultTimeoutSeconds, 120) * 1_000,
    catalogFetchTimeoutMs: positive(raw.catalogFetchTimeoutSeconds, 20) * 1_000,
    abortGraceMs: positive(raw.abortGraceSeconds, 5) * 1_000,
    coldMaxTurns: positive(raw.coldMaxTurns, 4),
    disabledModels: stringList(raw.disabledModels),
    modelContextWindows: numberMap(raw.modelContextWindows),
    modelAliases: stringMap(raw.modelAliases),
    identityOverride: raw.identityOverride === true,
    defaultReasoningEffort: effort.length > 0 ? effort : undefined,
  }
}

/**
 * Flatten the `Volatile<T>` references a `.volatile()` schema produces.
 *
 * A volatile field arrives as `{ get(): T }` rather than `T`, so every read has
 * to go through `get()`. Doing it once here keeps the rest of the plugin typed
 * against plain values, which is the same shape upstream adapters consume.
 *
 * @param config - parsed plugin config, whose fields may be volatile references.
 * @returns the same fields as plain values.
 */
function unwrap(config: ParsedConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    out[key] = isVolatile(value) ? value.get() : value
  }
  return out
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(entry => entry.trim())
}

/**
 * Keep only the positive, finite entries of a map.
 *
 * A window of zero or a negative number would be passed straight to the
 * harness as a capacity, so invalid entries are dropped here rather than
 * rejected — one bad row must not discard the user's other choices.
 */
function numberMap(value: unknown): Readonly<Record<string, number>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'number' && Number.isFinite(entry) && entry > 0) out[key] = entry
  }
  return out
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.trim().length > 0) out[key] = entry.trim()
  }
  return out
}
