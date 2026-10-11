/**
 * `QoderAdapter`: route the harness LLM seam onto a local Qoder CLI account
 * through the qoder-agent-sdk. One warm inner session per host session id
 * carries the conversation (model turns and tool rounds live inside it); host
 * tool schemas are exposed to the inner model through an in-process MCP
 * server whose handlers park until the host delivers tool results on the next
 * request. Side-channel requests (titles, compaction) run cold one-shots.
 * @module dsh-llm-qoder/adapter
 */

import { LlmAdapter, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions, LlmModelInfo, LlmModelReasoningInfo, LlmProviderInfo, LlmResolvedModelInfo,
  PreparedAdapterCall, RequestMessage, StreamChunk,
} from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import {
  DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, QODER_MODELS, resolveQoderModelId,
} from './catalog.ts'
import type { ContextWindowMode, ResolvedConfig } from './config.ts'
import { DEFAULT_MODEL_CACHE_TTL_MS, DEFAULT_FETCH_TIMEOUT_MS, QoderModelCatalog } from './models.ts'
import { feedImageRefs, feedToText, imageRefs, joinFeeds, renderInitialFeed, renderRefreshed, renderUserTurn } from './render.ts'
import type { Feed } from './render.ts'
import { QoderSession, QoderSessionManager } from './session.ts'
import type { ChannelContent, ResolvedImages } from './session.ts'

/**
 * Read one durable image occurrence into the bytes a request sends.
 * Implemented over `ctx.attachments`; returns undefined when the object is
 * unreadable, which degrades that one image instead of failing the turn.
 */
export type ImageRequestReader = (
  ref: ImageAttachmentRef,
  signal?: AbortSignal,
) => Promise<{ bytes: Uint8Array, mediaType: string } | undefined>

/** Options for {@link QoderAdapter}. */
export interface QoderAdapterOptions {
  /** Maximum simultaneously warm inner sessions (default 8). */
  maxSessions?: number
  /** How long a fetched CLI model catalog stays fresh (default 5 min). */
  modelCacheTtlMs?: number
  /** Request-image reader; absent → images are never forwarded as pixels. */
  readImage?: ImageRequestReader
  /** How long an MCP tool handler waits for the host tool result. */
  toolResultTimeoutMs?: number
  /** How long the inner process gets to acknowledge an abort. */
  abortGraceMs?: number
  /** Maximum inner turns for one side-channel request. */
  coldMaxTurns?: number
  /** How long one CLI catalog fetch may take before the static fallback. */
  catalogFetchTimeoutMs?: number
  /** Whether custom models keep their own route or merge into the main one. */
  byokRoute?: 'separate' | 'inline'
  /** Which context window to report; see `ContextWindowMode`. */
  contextWindowMode?: ContextWindowMode
  /** Fixed window used when the mode is `custom`. */
  contextWindowOverride?: number
  /** Output-token cap assumed when a model reports none. */
  defaultMaxTokens?: number
  /** Allow-list of model ids; empty advertises everything. */
  enabledModels?: readonly string[]
  /** Deny-list of model ids, applied after the allow-list. */
  disabledModels?: readonly string[]
  /** Extra harness-id → Qoder-id aliases, merged over the built-in ones. */
  modelAliases?: Readonly<Record<string, string>>
  /** Reasoning effort used when a request names none. */
  defaultReasoningEffort?: string
  /** Display name of the primary provider group. */
  displayName?: string
  /** Display name of the group holding the account's custom models. */
  byokDisplayName?: string
  /** Prepend the identity block to the inner system prompt. */
  identityOverride?: boolean
}

/** The primary provider route (the qoder account's built-in models). */
export const QODER_PROVIDER = 'qoder-cn'
/** Secondary route advertising only the account's custom models. */
export const QODER_BYOK_PROVIDER = 'qoder-cn-byok'

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
export function pickContextWindow(
  mode: ContextWindowMode,
  live: { maxInputTokens?: number, defaultContextWindow?: number, availableContextWindows?: readonly number[] } | undefined,
  override: number,
  fallback: number,
): number {
  if (mode === 'custom') return override
  if (live === undefined) return fallback
  const declared = live.defaultContextWindow
  if (mode === 'max') {
    const available = live.availableContextWindows
    const largest = available !== undefined && available.length > 0 ? Math.max(...available) : undefined
    return largest ?? declared ?? live.maxInputTokens ?? fallback
  }
  // `auto` and `default` both follow upstream's own per-session window. `auto`
  // is kept as a distinct id so the default can diverge later without changing
  // what an explicitly-pinned `default` means.
  return declared ?? live.maxInputTokens ?? fallback
}

function modelInfo(provider: string, entry: { id: string, name: string, description?: string, isVl?: boolean }): LlmModelInfo {
  return {
    provider,
    id: entry.id,
    name: entry.name,
    ...entry.description === undefined ? {} : { description: entry.description },
    inputModalities: entry.isVl === true ? ['text' as const, 'image' as const] : ['text' as const],
  }
}

/**
 * Default selectable reasoning efforts for a Qoder model. The CLI catalog
 * reports per-model `efforts`; this is the fallback when a model (or the
 * static catalog) discloses none.
 */
const DEFAULT_REASONING_EFFORTS = ['low', 'medium', 'high', 'max'] as const

/** Human display name for the default effort ids. */
const EFFORT_NAMES: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

/**
 * Build the `reasoning` metadata block for a resolved model, or undefined
 * when the model does not support reasoning.
 * @param efforts - CLI-reported effort ids (absent for reasoning-less models).
 * @param defaultEffort - CLI-reported default effort id.
 * @param isReasoning - whether the model supports reasoning per the CLI.
 * @returns the harness reasoning metadata, or undefined to omit it.
 */
export function reasoningInfo(
  efforts: readonly string[] | undefined,
  defaultEffort: string | undefined,
  isReasoning: boolean | undefined,
): LlmModelReasoningInfo | undefined {
  if (efforts === undefined && isReasoning === false) return undefined
  const ids = efforts !== undefined && efforts.length > 0
    ? efforts
    : DEFAULT_REASONING_EFFORTS
  return {
    efforts: ids.map(id => ({
      id: ReasoningEffortId(id),
      name: EFFORT_NAMES[id] ?? id,
    })),
    ...defaultEffort !== undefined && ids.includes(defaultEffort)
      ? { defaultEffort: ReasoningEffortId(defaultEffort) }
      : {},
  }
}

/** One adapter dispatch generation: the metadata the harness saw, plus what it implies. */
interface CallGeneration {
  readonly info: LlmResolvedModelInfo
  /** Whether the resolved route accepts image input, per that same resolution. */
  readonly vision: boolean
}

/**
 * The Qoder-backed adapter. Session continuity, tool parking, and feed
 * planning live here; chunk synthesis lives in the session's consumer.
 */
export class QoderAdapter extends LlmAdapter {
  private readonly sessions: QoderSessionManager
  private readonly catalog: QoderModelCatalog
  private readonly readImage: ImageRequestReader | undefined
  private readonly contextWindowMode: ContextWindowMode
  private readonly contextWindowOverride: number
  private readonly defaultMaxTokens: number
  private readonly enabledModels: ReadonlySet<string>
  private readonly enabledModelsResolved: ReadonlySet<string>
  private readonly disabledModels: ReadonlySet<string>
  private readonly modelAliases: Readonly<Record<string, string>>
  private readonly defaultReasoningEffort: string | undefined
  private readonly displayName: string
  private readonly byokDisplayName: string
  private readonly byokRoute: 'separate' | 'inline'

  constructor(options: QoderAdapterOptions = {}) {
    super()
    this.sessions = new QoderSessionManager(options.maxSessions ?? 8, {
      toolResultTimeoutMs: options.toolResultTimeoutMs,
      abortGraceMs: options.abortGraceMs,
      coldMaxTurns: options.coldMaxTurns,
      identityOverride: options.identityOverride,
    })
    this.catalog = new QoderModelCatalog(
      options.modelCacheTtlMs ?? DEFAULT_MODEL_CACHE_TTL_MS,
      options.catalogFetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
    )
    this.readImage = options.readImage
    this.byokRoute = options.byokRoute ?? 'separate'
    this.contextWindowMode = options.contextWindowMode ?? 'auto'
    this.contextWindowOverride = options.contextWindowOverride ?? DEFAULT_CONTEXT_WINDOW
    this.defaultMaxTokens = options.defaultMaxTokens ?? DEFAULT_MAX_TOKENS
    this.enabledModels = new Set(options.enabledModels ?? [])
    this.disabledModels = new Set(options.disabledModels ?? [])
    this.modelAliases = options.modelAliases ?? {}
    // Pre-resolve the allow-list so an entry written as a harness-side alias
    // (`deepseek-v4-pro`) matches the Qoder id the catalog actually carries
    // (`dmodel`). Resolving the catalog id instead would never match, because
    // the alias table maps harness name → Qoder id, not the reverse.
    this.enabledModelsResolved = new Set(
      [...this.enabledModels].map(entry => resolveQoderModelId(entry, this.modelAliases)),
    )
    this.defaultReasoningEffort = options.defaultReasoningEffort
    this.displayName = options.displayName ?? 'Qoder CN'
    this.byokDisplayName = options.byokDisplayName ?? 'Qoder CN 自定义'
  }

  override providerInfo(provider: string): LlmProviderInfo {
    return {
      id: provider,
      name: provider === QODER_BYOK_PROVIDER ? this.byokDisplayName : this.displayName,
    }
  }

  /**
   * Whether one model survives the configured allow/deny lists.
   *
   * A catalog id is matched against the allow-list directly, against its
   * alias-resolved form, and against the raw entries whose own resolution
   * produced it — so a user may write either the Qoder value (`dmodel`) or a
   * harness-side alias (`deepseek-v4-pro`) and get the same model.
   */
  private isVisible(id: string): boolean {
    if (this.disabledModels.has(id)) return false
    if (this.enabledModels.size === 0) return true
    return this.enabledModels.has(id) || this.enabledModelsResolved.has(id)
  }

  override async listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const cliModels = await this.catalog.models()
    if (provider === QODER_BYOK_PROVIDER) {
      // Only the account's custom models, which have their own route.
      return cliModels
        .filter(entry => entry.source === 'user' || entry.source === 'custom')
        .filter(entry => this.isVisible(entry.id))
        .map(entry => modelInfo(provider, entry))
    }
    // The built-in route lists the qoder account's own models. When the
    // deployment asked for a single group (`byokRoute: inline`), the account's
    // custom models are folded in here instead of getting their own route.
    return cliModels
      .filter(entry => this.byokRoute === 'inline'
        || (entry.source !== 'user' && entry.source !== 'custom'))
      .filter(entry => this.isVisible(entry.id))
      .map(entry => modelInfo(provider, entry))
  }

  override async resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    // The host may address a model by a `deepseek-v4-*` alias or a `qoder-`
    // prefixed id, while the CLI catalog is keyed by the SDK value. Resolve the
    // address to find the metadata, but echo the requested id back: the seam
    // rejects an exact-model result whose id differs from the one asked for.
    const target = resolveQoderModelId(model, this.modelAliases)
    const live = (await this.catalog.liveModels()).find(entry => entry.value === target)
    if (live !== undefined) {
      const reasoning = reasoningInfo(live.efforts, live.defaultEffort ?? this.defaultReasoningEffort, live.isReasoning)
      return {
        provider,
        id: model,
        name: live.displayName.length > 0 ? live.displayName : live.value,
        ...live.description.length > 0 ? { description: live.description } : {},
        // Only an affirmative CLI `isVl` declares image input. The harness
        // projects images to handle text for a route that omits it, so a claim
        // the CLI did not make would silently drop pixels; the reverse error
        // would send pixels to a model that cannot read them.
        inputModalities: live.isVl === true ? ['text' as const, 'image' as const] : ['text' as const],
        context: {
          // The compaction engine and context meter price against the window a
          // request actually uses. Upstream reports three different numbers
          // (per-request ceiling, effective session window, and the list of
          // selectable windows); `pickContextWindow` implements the configured
          // choice among them. Reporting a window larger than the session
          // really runs with would push the auto-compaction threshold past what
          // the provider accepts.
          contextWindow: pickContextWindow(
            this.contextWindowMode,
            live,
            this.contextWindowOverride,
            DEFAULT_CONTEXT_WINDOW,
          ),
        },
        defaultMaxTokens: live.maxOutputTokens ?? this.defaultMaxTokens,
        ...reasoning === undefined ? {} : { reasoning },
      }
    }
    const configured = QODER_MODELS.find(entry => entry.id === target)
    const reasoning = reasoningInfo(undefined, this.defaultReasoningEffort, true)
    return Promise.resolve({
      ...configured === undefined
        ? { provider, id: model, name: model, inputModalities: ['text' as const] }
        : { ...modelInfo(provider, configured), id: model },
      context: {
        contextWindow: this.contextWindowMode === 'custom' ? this.contextWindowOverride : DEFAULT_CONTEXT_WINDOW,
      },
      defaultMaxTokens: this.defaultMaxTokens,
      ...reasoning === undefined ? {} : { reasoning },
    })
  }

  /**
   * Bind one resolution generation to its dispatch, as the seam requires of a
   * dynamic adapter: the live catalog and the CLI login can change between the
   * harness preparing a call and the inner session running it, and a turn must
   * not mix one generation's declared capabilities with another's endpoint.
   */
  override async prepareCall(provider: string, model: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const generation = await this.capture(provider, model, signal)
    return {
      model: generation.info,
      stream: options => this.dispatch(options, generation),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield* this.dispatch(options, await this.capture(options.provider, options.model, options.signal))
  }

  /** Resolve the exact route once and derive the capability facts from it. */
  private async capture(provider: string, model: string, signal?: AbortSignal): Promise<CallGeneration> {
    const info = await this.resolveModel(provider, model, signal)
    return { info, vision: info.inputModalities?.includes('image') === true }
  }

  private async *dispatch(options: GenerateOptions, generation: CallGeneration): AsyncGenerator<StreamChunk> {
    const model = resolveQoderModelId(options.model, this.modelAliases)
    if (options.sessionId === undefined || options.purpose !== undefined) {
      // Side channels summarise text; pixels would only cost them context.
      const prompt = feedToText(renderInitialFeed(options.system, options.messages))
        + '\n（这是一次性旁路请求，直接输出下一条助手回复。）'
      // Side channels (titles, compaction summaries) reuse the main session's
      // model so dsh's recorded summarization target matches what qodercli
      // actually runs — a different default route could have different
      // context limits or quota, silently failing the compaction.
      yield* this.sessions.coldStream(options, prompt, model)
      return
    }
    const sessionId = String(options.sessionId)
    // The seam carries no per-request context window: the route's capacity
    // comes from resolveModel, and the inner session uses the CLI's own window.
    const policy = {
      ...options.reasoningEffort === undefined ? {} : { reasoningEffort: options.reasoningEffort },
    }
    let session = this.sessions.forSession(sessionId, model)
    if (session.fedMessages === undefined) {
      yield* this.firstTurn(session, options, model, policy, generation.vision)
      return
    }
    const tail = options.messages.slice(session.fedMessages.length)
    const images = await this.resolveTurnImages(tail, generation.vision, options.signal)
    session.deliverToolResults(tail, images)
    const plan = planContinuation(session.fedMessages, options.messages)
    if (plan.rebuild) {
      this.sessions.dispose(sessionId)
      session = this.sessions.forSession(sessionId, model)
      yield* this.firstTurn(session, options, model, policy, generation.vision)
      return
    }
    session.setModel(model, policy)
    session.ensureTools(options.tools ?? [])
    session.recordRequestInput(options.system, options.messages)
    session.fedMessages = options.messages
    session.fedSystem = options.system
    yield* session.stream(options, plan.feed === null ? null : await this.buildFeed(plan.feed, generation.vision, images))
  }

  private async *firstTurn(
    session: QoderSession,
    options: GenerateOptions,
    model: string,
    policy: { reasoningEffort?: string },
    vision: boolean,
  ): AsyncGenerator<StreamChunk> {
    session.setModel(model, policy)
    session.setSystem(options.system)
    // Older dsh-llm releases lack the cwd field on GenerateOptions; read it
    // through the widened view so this adapter compiles against the peer range.
    const cwd = (options as GenerateOptions & { cwd?: string }).cwd
    session.setCwd(cwd)
    session.ensureTools(options.tools ?? [])
    session.recordRequestInput(options.system, options.messages)
    session.fedMessages = options.messages
    session.fedSystem = options.system
    const feed = renderInitialFeed(options.system, options.messages)
    const images = await this.resolveImages(feedImageRefs(feed), vision, options.signal)
    yield* session.stream(options, await this.buildFeed(feed, vision, images))
  }

  /** Image references carried by a message tail, skipping assistant content. */
  private async resolveTurnImages(
    tail: readonly RequestMessage[],
    vision: boolean,
    signal?: AbortSignal,
  ): Promise<ResolvedImages> {
    const refs = tail.flatMap(message => message.role === 'assistant' ? [] : imageRefs(message.content))
    return this.resolveImages(refs, vision, signal)
  }

  /** Resolve image references into base64 request bytes; absent reader → none. */
  private async resolveImages(
    refs: readonly ImageAttachmentRef[],
    vision: boolean,
    signal?: AbortSignal,
  ): Promise<ResolvedImages> {
    const map = new Map<string, { data: string, mediaType: string }>()
    if (!vision || this.readImage === undefined || refs.length === 0) return map
    for (const ref of refs) {
      const key = String(ref.attachmentId)
      if (map.has(key)) continue
      try {
        const image = await this.readImage(ref, signal)
        if (image !== undefined) {
          map.set(key, { data: Buffer.from(image.bytes).toString('base64'), mediaType: image.mediaType })
        }
      } catch {
        // One unreadable attachment degrades to handle text; the turn continues.
      }
    }
    return map
  }

  /**
   * Turn a feed into channel content. A text feed passes through; a non-vision
   * feed flattens to the harness's own image handle text; an image the host
   * could not read keeps a note naming what was dropped, so the inner model
   * still knows the attachment was there.
   */
  private async buildFeed(
    feed: Feed,
    vision: boolean,
    images: ResolvedImages,
  ): Promise<string | ChannelContent[]> {
    if (typeof feed === 'string') return feed
    if (!vision) return feedToText(feed)
    const content: ChannelContent[] = []
    let pixels = 0
    for (const part of feed) {
      if (part.type === 'text') {
        if (part.text.length > 0) content.push({ type: 'text', text: part.text })
        continue
      }
      const resolved = images.get(String(part.attachment.attachmentId))
      if (resolved === undefined) {
        content.push({ type: 'text', text: `[图片附件 ${String(part.attachment.attachmentId)} 本次未能读取，请基于文字内容继续]` })
        continue
      }
      pixels += 1
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: resolved.mediaType, data: resolved.data },
      })
    }
    // Nothing to show as pixels: stay in the historical single-string shape.
    return pixels === 0 ? content.map(block => block.type === 'text' ? block.text : '').join('\n\n') : content
  }

  /** Tear down every warm inner session (plugin dispose). */
  close(): void {
    this.sessions.closeAll()
  }
}

interface ContinuationPlan {
  /** Feed for the inner session this turn, or null for a pure continuation. */
  feed: Feed | null
  /** Whether the warm session must be rebuilt (history diverged past repair). */
  rebuild: boolean
}

/**
 * Decide what to feed on a continuation request. The previous list must be a
 * prefix (same length growth, index 0 untouched, at most two in-place
 * mutations — the host refreshes runtime-context snapshots in place every
 * turn). Tail tool-result messages were already resolved into parked handlers
 * and never feed; fresh user turns and mutated messages do.
 */
export function planContinuation(
  previous: readonly RequestMessage[],
  current: readonly RequestMessage[],
): ContinuationPlan {
  if (current.length <= previous.length) return { feed: null, rebuild: true }
  const mutated: number[] = []
  for (let i = 0; i < previous.length; i++) {
    if (JSON.stringify(previous[i]) !== JSON.stringify(current[i])) mutated.push(i)
  }
  if (mutated.includes(0) || mutated.length > 2) return { feed: null, rebuild: true }
  const tail = current.slice(previous.length)
  const freshUser = tail.filter(m => m.role === 'user')
  if (freshUser.length === 0 && mutated.length === 0) return { feed: null, rebuild: false }
  const parts: Feed[] = []
  for (const index of mutated) {
    const message = current[index]
    if (message !== undefined) parts.push(renderRefreshed(message))
  }
  for (const message of freshUser) parts.push(renderUserTurn(message.content))
  const feed = joinFeeds(parts)
  return { feed: typeof feed === 'string' && feed.length === 0 ? null : feed, rebuild: false }
}
