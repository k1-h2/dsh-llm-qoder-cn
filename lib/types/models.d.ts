/**
 * Live model catalog retrieval from the local Qoder CLI. One short-lived
 * inner session sends the SDK's `get_models` control request; the response
 * (including account-custom models) stays fresh for a TTL, concurrent
 * callers share one in-flight fetch, and the static catalog is the fallback
 * while the CLI is unreachable.
 * @module dsh-llm-qoder/models
 */
import type { ModelInfo } from '@qodercn-ai/qodercn-agent-sdk';
import type { QoderCatalogModel } from './catalog.ts';
import type { Live } from './live.ts';
/** How long a fetched catalog stays fresh by default. */
export declare const DEFAULT_MODEL_CACHE_TTL_MS: number;
/** Give up on one CLI catalog fetch after this long by default. */
export declare const DEFAULT_FETCH_TIMEOUT_MS = 20000;
/** Cached live CLI catalog with a static fallback. */
export declare class QoderModelCatalog {
    private readonly ttlMs;
    private readonly fetchTimeoutMs;
    private cached;
    private inflight;
    /**
     * @param ttlMs - how long a fetched catalog stays fresh before a re-fetch.
     *   Read per use, so a settings edit takes effect on the next read.
     * @param fetchTimeoutMs - how long one CLI catalog fetch may take before the
     *   static fallback takes over.
     */
    constructor(ttlMs: Live<number>, fetchTimeoutMs?: Live<number>);
    /**
     * Raw live entries; the stale snapshot when a refresh fails, else nothing.
     *
     * Only the account's own (official) models come back: Qoder CN exposes no
     * user-added models, so filtering here is what keeps the picker and the
     * settings page from disagreeing about what the account has.
     */
    liveModels(): Promise<readonly ModelInfo[]>;
    /** dsh catalog entries: the enabled live list, or the static fallback. */
    models(): Promise<readonly QoderCatalogModel[]>;
    private fetch;
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
export declare function priceFactorOf(entry: {
    priceFactor?: number;
}): number | undefined;
