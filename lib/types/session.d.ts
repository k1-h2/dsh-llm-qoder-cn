/**
 * One long-lived inner Qoder CLI session per host session id: a channel-fed
 * `query()` subprocess whose model continuation streams out as harness
 * `StreamChunk`s. Host tool calls travel through an in-process MCP server:
 * the handler parks on a promise, the adapter finishes the turn with
 * `tool-calls`, and the next host request (carrying tool results) resolves
 * the parked promise so the inner model continues with the result in place.
 * @module dsh-llm-qoder/session
 */
import type { ContentBlock, GenerateOptions, RequestMessage, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm';
import type { Live } from './live.ts';
/** MCP server name this adapter exposes host tools under. */
export declare const MCP_SERVER_NAME = "dsh-host";
/** Warm sessions kept alive when the deployment names no cap. */
export declare const DEFAULT_MAX_SESSIONS = 8;
/**
 * Runtime knobs shared by every warm session a manager owns. Populated from the
 * plugin's resolved config, so the settings page is the single place these are
 * decided.
 *
 * Each value may be a {@link Live} thunk and is resolved when a session is
 * created, not when the manager is: a settings edit therefore applies to the
 * sessions opened after it, while a conversation already in flight keeps the
 * knobs it started with.
 */
export interface SessionRuntimeOptions {
    /** How long an MCP tool handler waits for the host tool result. */
    toolResultTimeoutMs?: Live<number>;
    /** How long the inner process gets to acknowledge an abort. */
    abortGraceMs?: Live<number>;
    /**
     * Prepend the identity block to the host system prompt. Off by default: the
     * block instructs the inner model to deny being Qoder, which is a deliberate
     * product choice rather than a neutral default.
     */
    identityOverride?: Live<boolean>;
}
/**
 * One user-turn content block on the streaming-input channel. Text is the
 * historical shape; image blocks use the SDK's Claude-compatible base64
 * vision shape (`ImageContentBlock`).
 */
export type ChannelContent = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    source: {
        type: 'base64';
        media_type: string;
        data: string;
    };
};
/** One MCP tool-result content block: text, or the MCP image shape. */
export type McpContent = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    data: string;
    mimeType: string;
};
/** A host tool result delivered to a parked or buffered MCP handler. */
export interface ToolResultPayload {
    content: McpContent[];
    isError: boolean;
}
/**
 * Request-image bytes resolved by the adapter, keyed by attachment id. An id
 * missing from the map degrades to handle text instead of failing the turn.
 */
export type ResolvedImages = ReadonlyMap<string, {
    data: string;
    mediaType: string;
}>;
/**
 * The host tool runtime dispatches by the bare host name; the inner model
 * only ever sees the namespaced MCP form, so strip the prefix on the way out.
 */
export declare function hostToolName(name: string): string;
/** Deny native tools, allow this adapter's MCP tools. */
export declare function gateTools(toolName: string, _input: unknown, options: {
    toolUseID?: string;
}): Promise<unknown>;
/**
 * One warm inner session. All mutation happens on the consumer fiber except
 * the documented turn lifecycle driven by {@link stream}.
 */
export declare class QoderSession {
    readonly sessionId: string;
    private readonly channel;
    /**
     * Lazy: the MCP SDK refuses tool registration after the transport connects,
     * so the inner process only spawns once {@link ensureTools} has registered
     * the host tools (the adapter does that immediately before each stream).
     */
    private q;
    /**
     * Tool-call pairing state. qodercli asks `canUseTool` (with the qodercli
     * tool-use id) once per call in execution order, then sends the MCP message;
     * the host sees tool calls as content blocks and delivers all results up
     * front on the next request. Tool-use ids therefore arrive in the handler in
     * canUseTool order, and host callIds map back to them via the content-block
     * ids — so handlers park under the exact tool-use id, never a shifted FIFO
     * slot. Results buffer by tool-use id until their handler fires.
     */
    private readonly parked;
    private readonly pendingResults;
    /** qodercli tool-use ids in canUseTool (execution) order, claimed by MCP handlers. */
    private readonly toolUseQueue;
    /** Host callId (qoder-N) → qodercli tool-use id, from the content-block ids. */
    private readonly hostCallByToolUse;
    private readonly mcp;
    private readonly registered;
    private queue;
    private model;
    private reasoningEffort;
    private callCounter;
    /**
     * Per-instance suffix for emitted host call ids. Ids must stay unique across
     * the whole host session log: a history divergence rebuilds this class, LRU
     * eviction recreates it, and the harness keys tool-call blocks by id, so a
     * fresh `qoder-1` would collide with the one its predecessor already stored.
     */
    private readonly callNonce;
    private abortPending;
    private disposed;
    /** Previous request's messages for delta feeding. */
    fedMessages: readonly RequestMessage[] | undefined;
    fedSystem: string | undefined;
    /** This turn's fed characters, reset per turn for per-call token accounting. */
    turnInputChars: number;
    /** Host system prompt captured before spawn for the boot-time systemPrompt. */
    private hostSystem;
    /** Host session workspace; qodercli runs there so its preset reports the session cwd. */
    private sessionCwd;
    private blockIndex;
    private textBlock;
    private reasoningBlock;
    private openTool;
    private toolCalls;
    private outputChars;
    private reasoningChars;
    /** Last real usage reported by the inner model for the active turn. */
    private lastUsage;
    /**
     * Session-level input token estimate for the CURRENT request, priced the
     * same way the harness token meter prices the surface (4 chars per token
     * on the rendered conversation the inner session actually receives). The
     * qoder CLI zeroes its per-stream usage frames, so without this the harness
     * context meter would read ~0% and auto-compaction would never trigger.
     */
    private estimatedInputTokens;
    /** Per-session runtime knobs, resolved from the plugin config at creation. */
    private readonly toolResultTimeoutMs;
    private readonly abortGraceMs;
    private readonly identityOverride;
    constructor(sessionId: string, initialModel: string, runtime?: SessionRuntimeOptions);
    /** Spawn the inner process (first stream only) and attach the consumer. */
    private ensureStarted;
    /** Point the session at a model and its per-request policy. */
    setModel(model: string, policy?: {
        reasoningEffort?: string;
    }): void;
    /** Record the host system prompt; effective only before the process spawns. */
    /**
     * Record the host system prompt; effective only before the process spawns.
     *
     * When `identityOverride` is on, the identity block is prepended here rather
     * than in the adapter so it applies to the warm-session path and the cold
     * side-channel path alike, and so the prompt the harness believes it sent
     * stays untouched in its own records.
     */
    setSystem(system: string | undefined): void;
    /**
     * Record the host session workspace; effective only before the process
     * spawns. qodercli inherits the host process cwd otherwise, which would
     * make its preset report the server's launch directory instead of the
     * session's workspace.
     */
    setCwd(cwd: string | undefined): void;
    /**
     * Permission gate for the inner process. Native tools are denied; MCP host
     * tools are allowed, and each allowed call's qodercli tool-use id is queued
     * so the matching MCP handler can park under the exact id (qodercli asks
     * once per call, in execution order, before sending the MCP message).
     */
    private canUseTool;
    /** Register any host tools whose schema this session's MCP server lacks. */
    ensureTools(tools: readonly ToolSchema[]): void;
    /**
     * Deliver host tool results to parked or buffered handlers, keyed by call id.
     * @param tail - the host messages appended since the previous request.
     * @param images - adapter-resolved request images keyed by attachment id; an
     *   id missing from the map degrades to handle text.
     */
    deliverToolResults(tail: readonly RequestMessage[], images?: ResolvedImages): void;
    /**
     * Run one inner turn: feed (if any) then pump consumer chunks until finish.
     * @param options - the host request (signal; tools already registered).
     * @param feed - literal text, resolved content blocks (a vision turn), or
     *   null for a pure tool-result continuation.
     */
    stream(options: GenerateOptions, feed: string | readonly ChannelContent[] | null): AsyncGenerator<StreamChunk>;
    /** Tear the inner process down; parked calls die with it. */
    close(): void;
    private resetTurnState;
    private emit;
    private usage;
    /**
     * Record the input-token estimate for the CURRENT request, priced the same
     * way the harness token meter prices the surface: 4 chars per token over
     * the rendered conversation (system + messages) the inner session receives.
     * @param system - the host system prompt included in this request.
     * @param messages - the full host message list included in this request.
     */
    recordRequestInput(system: string | undefined, messages: readonly RequestMessage[]): void;
    private endTurn;
    private consume;
    private handle;
}
/**
 * Render tool-result content blocks into the MCP content the inner model
 * reads: text passes through, an image resolves from {@link images} into the
 * MCP image shape or degrades to the harness's own handle text, and anything
 * else is serialized.
 */
export declare function renderResultContent(blocks: readonly ContentBlock[], images?: ResolvedImages): McpContent[];
/**
 * Vision tokens for one image, estimated with the tile formula the
 * Claude-compatible wire shape this backend follows uses (width x height / 750).
 * The inner CLI reports no usage for the pixels it consumed, so this estimate is
 * the only image occupancy the harness context meter and compaction threshold
 * can see. It is an estimate, not a provider metering figure.
 */
export declare function estimateImageTokens(width: number, height: number): number;
/** Safely stringify the SDK error payload for turn diagnostics. */
export declare function safeErrors(errors: unknown): string;
/**
 * Classify an inner result-frame failure into a harness-routable code. The
 * qoder backend reports context-window and quota rejections as generic
 * per-turn errors, so their message text must be recognized through the shared
 * dsh-llm classifiers; only then does the harness overflow recovery (or quota
 * surfacing) fire instead of a dead-end BACKEND_TURN_ERROR.
 */
export declare function classifyTurnError(detail: string): string;
/**
 * Warm-session registry with insertion-order LRU eviction, plus the cold
 * one-shot path for side-channel requests (titles, compaction).
 */
export declare class QoderSessionManager {
    readonly maxSessions: Live<number>;
    private readonly runtime;
    private readonly sessions;
    /**
     * @param maxSessions - warm-session cap; read per eviction so a settings edit
     *   applies to the next session that overflows the pool.
     * @param runtime - per-session knobs, resolved when each session is created.
     */
    constructor(maxSessions?: Live<number>, runtime?: SessionRuntimeOptions & {
        coldMaxTurns?: Live<number>;
    });
    /** Existing or fresh warm session for one host session id. */
    forSession(sessionId: string, model: string): QoderSession;
    /** Drop one session (history diverged); the next request rebuilds it cold. */
    dispose(sessionId: string): void;
    closeAll(): void;
    /** One-shot turn with no warm state: side channels and cold rebuilds. */
    coldStream(options: GenerateOptions, prompt: string, model?: string): AsyncGenerator<StreamChunk>;
}
