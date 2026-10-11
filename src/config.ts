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

import z from '@deepseek-ai/schemastery'

/**
 * How the context window reported to the harness is chosen for each model.
 *
 * The upstream Qoder catalog reports three different numbers, and conflating
 * them is the classic mistake:
 *
 * - `maxInputTokens` — the ceiling for ONE request (often well below the
 *   session window; e.g. 180 000 while the session window is 200 000)
 * - `defaultContextWindow` — the window a session actually runs with (e.g. 200 000)
 * - `availableContextWindows` — every window the model can be switched to
 *   (e.g. `[200000, 400000, 1000000]`)
 *
 * `auto` follows upstream's own default, which is what keeps automatic
 * compaction honest: the harness prices its compaction threshold as
 * `ratio × contextWindow`, so reporting a window larger than the session really
 * uses lets a conversation grow past what the provider accepts before
 * compaction ever fires.
 */
export const CONTEXT_WINDOW_MODES = ['auto', 'default', 'max', 'custom'] as const
export type ContextWindowMode = (typeof CONTEXT_WINDOW_MODES)[number]

/**
 * Human labels for {@link CONTEXT_WINDOW_MODES}. The generated form shows these
 * instead of the raw ids.
 */
export const CONTEXT_WINDOW_MODE_NAMES: Readonly<Record<ContextWindowMode, string>> = {
  auto: 'Auto (upstream default)',
  default: 'Upstream default',
  max: 'Largest available (e.g. 1M)',
  custom: 'Custom (fixed tokens)',
}

/** Guard for {@link CONTEXT_WINDOW_MODE_NAMES} lookups from untrusted config. */
export function isContextWindowMode(value: unknown): value is ContextWindowMode {
  return typeof value === 'string' && (CONTEXT_WINDOW_MODES as readonly string[]).includes(value)
}

/** How to treat the account's custom (user-added) models on the main route. */
export const BYOK_ROUTES = ['separate', 'inline'] as const
export type ByokRoute = (typeof BYOK_ROUTES)[number]

/** Human labels for {@link BYOK_ROUTES}. */
export const BYOK_ROUTE_NAMES: Readonly<Record<ByokRoute, string>> = {
  separate: 'Separate route (qoder-cn-byok)',
  inline: 'Merge into the main route',
}

/**
 * The plugin configuration.
 *
 * Every field is optional and defaulted, so an empty config — the profile row
 * DSH inserts by default — runs with the tuned defaults below.
 */
export interface Config {
  // ── Identity ────────────────────────────────────────────────────────────
  /**
   * Display name of the primary provider group in the model picker.
   * Change it when you run several Qoder accounts side by side.
   */
  displayName?: string
  /**
   * Display name of the secondary group carrying the account's own custom
   * models. Only shown when `byokRoute` is `separate`.
   */
  byokDisplayName?: string
  /**
   * Whether the account's custom models get their own provider route.
   * `separate` keeps them in a second group (matching upstream behaviour);
   * `inline` merges them into the main group.
   */
  byokRoute?: ByokRoute

  // ── Session capacity ────────────────────────────────────────────────────
  /**
   * How many warm inner Qoder CLI sessions to keep alive at once. One warm
   * session exists per DSH session id; beyond this cap the least recently used
   * one is closed. Raise it when you keep many sessions open and switching
   * feels slow, lower it to bound memory (each warm session is a subprocess).
   */
  maxSessions?: number
  /**
   * Seconds a fetched CLI model catalog stays fresh before it is re-fetched.
   * A larger value means fewer CLI round-trips; a smaller one picks up account
   * changes (new custom models, quota-driven model disabling) sooner.
   */
  modelCacheTtlSeconds?: number

  // ── Context window ──────────────────────────────────────────────────────
  /**
   * Which window to report to the harness. See {@link CONTEXT_WINDOW_MODES}.
   * `max` reports the largest window upstream offers (often 1M); because the
   * harness derives its auto-compaction threshold from this number, `max`
   * delays compaction and is only advisable if you also lower
   * `compactionThresholdHint`.
   */
  contextWindowMode?: ContextWindowMode
  /**
   * Window in tokens, used only when `contextWindowMode` is `custom`.
   * Ignored otherwise.
   */
  contextWindowOverride?: number
  /**
   * Advisory compaction ratio (0–1) logged on startup for the mode in use.
   * The harness owns the real threshold; this only surfaces the value implied
   * by the chosen window so a misconfiguration is visible in the log.
   */
  compactionThresholdHint?: number
  /**
   * Output-token cap assumed when a model does not report one.
   */
  defaultMaxTokens?: number

  // ── Timeouts ────────────────────────────────────────────────────────────
  /**
   * Seconds the inner model waits for the host to return a tool result before
   * that call is cancelled. Raise it for slow tools; lower it so a lost tool
   * result cannot stall a turn for long.
   */
  toolResultTimeoutSeconds?: number
  /**
   * Seconds to wait for the CLI model catalog before falling back to the
   * static list.
   */
  catalogFetchTimeoutSeconds?: number
  /**
   * Seconds to wait for the inner process to acknowledge an abort before the
   * turn is force-ended.
   */
  abortGraceSeconds?: number
  /**
   * Maximum inner turns allowed for one side-channel request (title
   * generation, compaction summary). Side channels should answer in one shot.
   */
  coldMaxTurns?: number

  // ── Models ──────────────────────────────────────────────────────────────
  /**
   * Allow-list of model ids. When non-empty, only these models are advertised
   * in the picker; everything else is hidden. Empty means "advertise all".
   * Ids are matched against the Qoder SDK value (e.g. `qmodel_38max`).
   */
  enabledModels?: string[]
  /**
   * Deny-list of model ids, applied after `enabledModels`. Use it to hide
   * models you never pick without maintaining a full allow-list.
   */
  disabledModels?: string[]
  /**
   * Extra aliases mapping a harness-side model id onto a Qoder SDK value,
   * merged over the built-in `deepseek-v4-*` ones. Useful when an existing
   * DSH deployment already refers to models by its own names.
   */
  modelAliases?: Record<string, string>

  // ── Behaviour ───────────────────────────────────────────────────────────
  /**
   * Whether to prepend an identity block telling the inner model to answer as
   * the host's agent and not to disclose that it is Qoder.
   *
   * Defaults to **false**, and deliberately so. Upstream ships an equivalent
   * helper but never calls it, so the default here matches what actually ran
   * before: the model answers as Qoder. Turning this on makes the assistant
   * deny its own provenance, which is a product decision you should make
   * knowingly rather than inherit from a default.
   */
  identityOverride?: boolean
  /**
   * Default reasoning effort applied when a model declares efforts but the
   * request names none. Leave empty to use upstream's own default.
   */
  defaultReasoningEffort?: string
}

/**
 * The configuration schema. This is what DSH turns into the settings page, so
 * the defaults and bounds here are user-visible documentation.
 */
export const Config: z<Config> = z.object({
  // Identity
  displayName: z.string().default('Qoder CN').description('Name of the primary provider group in the model picker.'),
  byokDisplayName: z.string().default('Qoder CN 自定义').description('Name of the group holding the account\'s custom models.'),
  byokRoute: z.union(BYOK_ROUTES).default('separate').description('Whether custom models get their own route or merge into the main one.'),

  // Session capacity
  maxSessions: z.number().step(1).min(1).max(64).default(8).description('Warm inner CLI sessions kept alive; least recently used is closed beyond this cap.'),
  modelCacheTtlSeconds: z.number().step(1).min(10).max(86_400).default(300).description('Seconds a fetched CLI model catalog stays fresh.'),

  // Context window
  contextWindowMode: z.union(CONTEXT_WINDOW_MODES).default('auto').description('Which context window to report: auto (upstream default), default, max (largest available), or custom.'),
  contextWindowOverride: z.number().step(1).min(1).default(200_000).description('Window in tokens, used only when the mode is custom.'),
  compactionThresholdHint: z.number().min(0).max(1).default(0.8).description('Advisory compaction ratio logged at startup; the harness owns the real threshold.'),
  defaultMaxTokens: z.number().step(1).min(1).default(32_000).description('Output-token cap assumed when a model does not report one.'),

  // Timeouts
  toolResultTimeoutSeconds: z.number().step(1).min(5).max(3_600).default(120).description('Seconds the inner model waits for a host tool result before cancelling that call.'),
  catalogFetchTimeoutSeconds: z.number().step(1).min(1).max(300).default(20).description('Seconds to wait for the CLI model catalog before using the static fallback.'),
  abortGraceSeconds: z.number().step(1).min(1).max(120).default(5).description('Seconds to wait for the inner process to acknowledge an abort.'),
  coldMaxTurns: z.number().step(1).min(1).max(32).default(4).description('Maximum inner turns for one side-channel request (titles, compaction).'),

  // Models
  enabledModels: z.array(z.string()).default([]).description('Allow-list of model ids; empty advertises every model.'),
  disabledModels: z.array(z.string()).default([]).description('Deny-list of model ids, applied after the allow-list.'),
  modelAliases: z.dict(z.string()).default({}).description('Extra harness-id → Qoder-model-id aliases, merged over the built-in ones.'),

  // Behaviour
  identityOverride: z.boolean().default(false).description('Prepend an identity block telling the inner model to answer as the host agent and not to disclose it is Qoder. Off by default: enabling it makes the assistant deny its own provenance.'),
  defaultReasoningEffort: z.string().default('').description('Reasoning effort used when a request names none; empty uses upstream\'s default.'),
})

/** Fully-resolved options with every default applied. */
export interface ResolvedConfig {
  displayName: string
  byokDisplayName: string
  byokRoute: ByokRoute
  maxSessions: number
  modelCacheTtlMs: number
  contextWindowMode: ContextWindowMode
  contextWindowOverride: number
  compactionThresholdHint: number
  defaultMaxTokens: number
  toolResultTimeoutMs: number
  catalogFetchTimeoutMs: number
  abortGraceMs: number
  coldMaxTurns: number
  enabledModels: readonly string[]
  disabledModels: readonly string[]
  modelAliases: Readonly<Record<string, string>>
  identityOverride: boolean
  defaultReasoningEffort: string | undefined
}

/**
 * Apply defaults to a parsed config.
 *
 * `apply()` receives whatever the loader composed, which for a profile row with
 * no explicit `config:` block is `{}`; schemastery defaults are applied by the
 * settings service but not necessarily on every code path, so resolving here
 * keeps the runtime independent of how the config arrived.
 *
 * @param config - the parsed plugin config, possibly partial.
 * @returns the same values with every default filled in.
 */
export function resolveConfig(config: Config | undefined): ResolvedConfig {
  const raw = config ?? {}
  const mode = isContextWindowMode(raw.contextWindowMode) ? raw.contextWindowMode : 'auto'
  const byok = raw.byokRoute === 'inline' ? 'inline' : 'separate'
  const effort = typeof raw.defaultReasoningEffort === 'string' ? raw.defaultReasoningEffort.trim() : ''
  return {
    displayName: nonEmpty(raw.displayName, 'Qoder CN'),
    byokDisplayName: nonEmpty(raw.byokDisplayName, 'Qoder CN 自定义'),
    byokRoute: byok,
    maxSessions: positive(raw.maxSessions, 8),
    modelCacheTtlMs: positive(raw.modelCacheTtlSeconds, 300) * 1_000,
    contextWindowMode: mode,
    contextWindowOverride: positive(raw.contextWindowOverride, 200_000),
    compactionThresholdHint: ratio(raw.compactionThresholdHint, 0.8),
    defaultMaxTokens: positive(raw.defaultMaxTokens, 32_000),
    toolResultTimeoutMs: positive(raw.toolResultTimeoutSeconds, 120) * 1_000,
    catalogFetchTimeoutMs: positive(raw.catalogFetchTimeoutSeconds, 20) * 1_000,
    abortGraceMs: positive(raw.abortGraceSeconds, 5) * 1_000,
    coldMaxTurns: positive(raw.coldMaxTurns, 4),
    enabledModels: stringList(raw.enabledModels),
    disabledModels: stringList(raw.disabledModels),
    modelAliases: stringMap(raw.modelAliases),
    identityOverride: raw.identityOverride === true,
    defaultReasoningEffort: effort.length > 0 ? effort : undefined,
  }
}

function nonEmpty(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback
}

function positive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

function ratio(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : fallback
}

function stringList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0).map(entry => entry.trim())
}

function stringMap(value: unknown): Readonly<Record<string, string>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string' && entry.trim().length > 0) out[key] = entry.trim()
  }
  return out
}
