/**
 * `QoderAdapter`: route the harness LLM seam onto a local Qoder CLI account
 * through the qoder-agent-sdk. One warm inner session per host session id
 * carries the conversation (model turns and tool rounds live inside it); host
 * tool schemas are exposed to the inner model through an in-process MCP
 * server whose handlers park until the host delivers tool results on the next
 * request. Side-channel requests (titles, compaction) run cold one-shots.
 * @module dsh-llm-qoder/adapter
 */
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo, LlmResolvedModelInfo, PreparedAdapterCall, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { ContextWindowMode } from './config.ts';
import type { Feed } from './render.ts';
/**
 * Read one durable image occurrence into the bytes a request sends.
 * Implemented over `ctx.attachments`; returns undefined when the object is
 * unreadable, which degrades that one image instead of failing the turn.
 */
export type ImageRequestReader = (ref: ImageAttachmentRef, signal?: AbortSignal) => Promise<{
    bytes: Uint8Array;
    mediaType: string;
} | undefined>;
/** Options for {@link QoderAdapter}. */
export interface QoderAdapterOptions {
    /** Maximum simultaneously warm inner sessions (default 8). */
    maxSessions?: number;
    /** How long a fetched CLI model catalog stays fresh (default 5 min). */
    modelCacheTtlMs?: number;
    /** Request-image reader; absent → images are never forwarded as pixels. */
    readImage?: ImageRequestReader;
    /** How long an MCP tool handler waits for the host tool result. */
    toolResultTimeoutMs?: number;
    /** How long the inner process gets to acknowledge an abort. */
    abortGraceMs?: number;
    /** Maximum inner turns for one side-channel request. */
    coldMaxTurns?: number;
    /** How long one CLI catalog fetch may take before the static fallback. */
    catalogFetchTimeoutMs?: number;
    /** Whether custom models keep their own route or merge into the main one. */
    byokRoute?: 'separate' | 'inline';
    /** Which context window to report; see `ContextWindowMode`. */
    contextWindowMode?: ContextWindowMode;
    /** Fixed window used when the mode is `custom`. */
    contextWindowOverride?: number;
    /** Output-token cap assumed when a model reports none. */
    defaultMaxTokens?: number;
    /** Allow-list of model ids; empty advertises everything. */
    enabledModels?: readonly string[];
    /** Deny-list of model ids, applied after the allow-list. */
    disabledModels?: readonly string[];
    /** Extra harness-id → Qoder-id aliases, merged over the built-in ones. */
    modelAliases?: Readonly<Record<string, string>>;
    /** Reasoning effort used when a request names none. */
    defaultReasoningEffort?: string;
    /** Display name of the primary provider group. */
    displayName?: string;
    /** Display name of the group holding the account's custom models. */
    byokDisplayName?: string;
    /** Prepend the identity block to the inner system prompt. */
    identityOverride?: boolean;
}
/** The primary provider route (the qoder account's built-in models). */
export declare const QODER_PROVIDER = "qoder-cn";
/** Secondary route advertising only the account's custom models. */
export declare const QODER_BYOK_PROVIDER = "qoder-cn-byok";
/**
 * Decide the context window to report for one live model.
 *
 * The three upstream numbers mean different things and only one of them is the
 * window a session actually runs with, so the choice is explicit rather than
 * guessed. See `ContextWindowMode` for what each mode is for.
 *
 * @param mode - the configured mode.
 * @param live - the live catalog entry, when the CLI answered.
 * @param override - the fixed window for `custom`.
 * @param fallback - window used when nothing else is available.
 * @returns the window in tokens.
 */
export declare function pickContextWindow(mode: ContextWindowMode, live: {
    maxInputTokens?: number;
    defaultContextWindow?: number;
    availableContextWindows?: readonly number[];
} | undefined, override: number, fallback: number): number;
/**
 * Build the `reasoning` metadata block for a resolved model, or undefined
 * when the model does not support reasoning.
 * @param efforts - CLI-reported effort ids (absent for reasoning-less models).
 * @param defaultEffort - CLI-reported default effort id.
 * @param isReasoning - whether the model supports reasoning per the CLI.
 * @returns the harness reasoning metadata, or undefined to omit it.
 */
export declare function reasoningInfo(efforts: readonly string[] | undefined, defaultEffort: string | undefined, isReasoning: boolean | undefined): LlmModelReasoningInfo | undefined;
/**
 * The Qoder-backed adapter. Session continuity, tool parking, and feed
 * planning live here; chunk synthesis lives in the session's consumer.
 */
export declare class QoderAdapter extends LlmAdapter {
    private readonly sessions;
    private readonly catalog;
    private readonly readImage;
    private readonly contextWindowMode;
    private readonly contextWindowOverride;
    private readonly defaultMaxTokens;
    private readonly enabledModels;
    private readonly enabledModelsResolved;
    private readonly disabledModels;
    private readonly modelAliases;
    private readonly defaultReasoningEffort;
    private readonly displayName;
    private readonly byokDisplayName;
    private readonly byokRoute;
    constructor(options?: QoderAdapterOptions);
    providerInfo(provider: string): LlmProviderInfo;
    /**
     * Whether one model survives the configured allow/deny lists.
     *
     * A catalog id is matched against the allow-list directly, against its
     * alias-resolved form, and against the raw entries whose own resolution
     * produced it — so a user may write either the Qoder value (`dmodel`) or a
     * harness-side alias (`deepseek-v4-pro`) and get the same model.
     */
    private isVisible;
    listModels(provider: string): Promise<readonly LlmModelInfo[]>;
    resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo>;
    /**
     * Bind one resolution generation to its dispatch, as the seam requires of a
     * dynamic adapter: the live catalog and the CLI login can change between the
     * harness preparing a call and the inner session running it, and a turn must
     * not mix one generation's declared capabilities with another's endpoint.
     */
    prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall>;
    stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
    /** Resolve the exact route once and derive the capability facts from it. */
    private capture;
    private dispatch;
    private firstTurn;
    /** Image references carried by a message tail, skipping assistant content. */
    private resolveTurnImages;
    /** Resolve image references into base64 request bytes; absent reader → none. */
    private resolveImages;
    /**
     * Turn a feed into channel content. A text feed passes through; a non-vision
     * feed flattens to the harness's own image handle text; an image the host
     * could not read keeps a note naming what was dropped, so the inner model
     * still knows the attachment was there.
     */
    private buildFeed;
    /** Tear down every warm inner session (plugin dispose). */
    close(): void;
}
interface ContinuationPlan {
    /** Feed for the inner session this turn, or null for a pure continuation. */
    feed: Feed | null;
    /** Whether the warm session must be rebuilt (history diverged past repair). */
    rebuild: boolean;
}
/**
 * Decide what to feed on a continuation request. The previous list must be a
 * prefix (same length growth, index 0 untouched, at most two in-place
 * mutations — the host refreshes runtime-context snapshots in place every
 * turn). Tail tool-result messages were already resolved into parked handlers
 * and never feed; fresh user turns and mutated messages do.
 */
export declare function planContinuation(previous: readonly RequestMessage[], current: readonly RequestMessage[]): ContinuationPlan;
export {};
