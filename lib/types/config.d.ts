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
import z from '@deepseek-ai/schemastery';
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
export declare const CONTEXT_WINDOW_MODES: readonly ["auto", "default", "max", "custom"];
export type ContextWindowMode = (typeof CONTEXT_WINDOW_MODES)[number];
/**
 * Human labels for {@link CONTEXT_WINDOW_MODES}. The generated form shows these
 * instead of the raw ids.
 */
export declare const CONTEXT_WINDOW_MODE_NAMES: Readonly<Record<ContextWindowMode, string>>;
/** Guard for {@link CONTEXT_WINDOW_MODE_NAMES} lookups from untrusted config. */
export declare function isContextWindowMode(value: unknown): value is ContextWindowMode;
/** How to treat the account's custom (user-added) models on the main route. */
export declare const BYOK_ROUTES: readonly ["separate", "inline"];
export type ByokRoute = (typeof BYOK_ROUTES)[number];
/** Human labels for {@link BYOK_ROUTES}. */
export declare const BYOK_ROUTE_NAMES: Readonly<Record<ByokRoute, string>>;
/**
 * The plugin configuration.
 *
 * Every field is optional and defaulted, so an empty config — the profile row
 * DSH inserts by default — runs with the tuned defaults below.
 */
export interface Config {
    /**
     * Display name of the primary provider group in the model picker.
     * Change it when you run several Qoder accounts side by side.
     */
    displayName?: string;
    /**
     * Display name of the secondary group carrying the account's own custom
     * models. Only shown when `byokRoute` is `separate`.
     */
    byokDisplayName?: string;
    /**
     * Whether the account's custom models get their own provider route.
     * `separate` keeps them in a second group (matching upstream behaviour);
     * `inline` merges them into the main group.
     */
    byokRoute?: ByokRoute;
    /**
     * How many warm inner Qoder CLI sessions to keep alive at once. One warm
     * session exists per DSH session id; beyond this cap the least recently used
     * one is closed. Raise it when you keep many sessions open and switching
     * feels slow, lower it to bound memory (each warm session is a subprocess).
     */
    maxSessions?: number;
    /**
     * Seconds a fetched CLI model catalog stays fresh before it is re-fetched.
     * A larger value means fewer CLI round-trips; a smaller one picks up account
     * changes (new custom models, quota-driven model disabling) sooner.
     */
    modelCacheTtlSeconds?: number;
    /**
     * Which window to report to the harness. See {@link CONTEXT_WINDOW_MODES}.
     * `max` reports the largest window upstream offers (often 1M); because the
     * harness derives its auto-compaction threshold from this number, `max`
     * delays compaction and is only advisable if you also lower
     * `compactionThresholdHint`.
     */
    contextWindowMode?: ContextWindowMode;
    /**
     * Window in tokens, used only when `contextWindowMode` is `custom`.
     * Ignored otherwise.
     */
    contextWindowOverride?: number;
    /**
     * Advisory compaction ratio (0–1) logged on startup for the mode in use.
     * The harness owns the real threshold; this only surfaces the value implied
     * by the chosen window so a misconfiguration is visible in the log.
     */
    compactionThresholdHint?: number;
    /**
     * Output-token cap assumed when a model does not report one.
     */
    defaultMaxTokens?: number;
    /**
     * Seconds the inner model waits for the host to return a tool result before
     * that call is cancelled. Raise it for slow tools; lower it so a lost tool
     * result cannot stall a turn for long.
     */
    toolResultTimeoutSeconds?: number;
    /**
     * Seconds to wait for the CLI model catalog before falling back to the
     * static list.
     */
    catalogFetchTimeoutSeconds?: number;
    /**
     * Seconds to wait for the inner process to acknowledge an abort before the
     * turn is force-ended.
     */
    abortGraceSeconds?: number;
    /**
     * Maximum inner turns allowed for one side-channel request (title
     * generation, compaction summary). Side channels should answer in one shot.
     */
    coldMaxTurns?: number;
    /**
     * Allow-list of model ids. When non-empty, only these models are advertised
     * in the picker; everything else is hidden. Empty means "advertise all".
     * Ids are matched against the Qoder SDK value (e.g. `qmodel_38max`).
     */
    enabledModels?: string[];
    /**
     * Deny-list of model ids, applied after `enabledModels`. Use it to hide
     * models you never pick without maintaining a full allow-list.
     */
    disabledModels?: string[];
    /**
     * Extra aliases mapping a harness-side model id onto a Qoder SDK value,
     * merged over the built-in `deepseek-v4-*` ones. Useful when an existing
     * DSH deployment already refers to models by its own names.
     */
    modelAliases?: Record<string, string>;
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
    identityOverride?: boolean;
    /**
     * Default reasoning effort applied when a model declares efforts but the
     * request names none. Leave empty to use upstream's own default.
     */
    defaultReasoningEffort?: string;
}
/**
 * The configuration schema. This is what DSH turns into the settings page, so
 * the defaults and bounds here are user-visible documentation.
 */
export declare const Config: z<Config>;
/** Fully-resolved options with every default applied. */
export interface ResolvedConfig {
    displayName: string;
    byokDisplayName: string;
    byokRoute: ByokRoute;
    maxSessions: number;
    modelCacheTtlMs: number;
    contextWindowMode: ContextWindowMode;
    contextWindowOverride: number;
    compactionThresholdHint: number;
    defaultMaxTokens: number;
    toolResultTimeoutMs: number;
    catalogFetchTimeoutMs: number;
    abortGraceMs: number;
    coldMaxTurns: number;
    enabledModels: readonly string[];
    disabledModels: readonly string[];
    modelAliases: Readonly<Record<string, string>>;
    identityOverride: boolean;
    defaultReasoningEffort: string | undefined;
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
export declare function resolveConfig(config: Config | undefined): ResolvedConfig;
