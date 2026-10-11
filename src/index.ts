/**
 * Register {@link QoderAdapter} for the `qoder-cn` and `qoder-cn-byok` provider
 * routes on `ctx.llm`, backed by the official Qoder CN Agent SDK
 * (`@qodercn-ai/qodercn-agent-sdk`).
 *
 * The inner sessions ride on the local `qoderclicn` login state, so no API key
 * or credential entry is required: the account's model catalog is fetched live
 * from the CLI and split into the account's built-in models and its custom
 * ones. Everything a deployment may want to tune — session pool size, context
 * window, timeouts, model allow/deny lists, aliases — is declared in
 * {@link Config}, which DSH renders as this plugin's settings page.
 *
 * @module dsh-llm-qoder-cn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import z from '@deepseek-ai/schemastery'
import { QoderAdapter, QODER_BYOK_PROVIDER, QODER_PROVIDER } from './adapter.ts'
import type { Config as QoderConfig } from './config.ts'
import { Config as ConfigSchema, resolveConfig } from './config.ts'

export { QoderAdapter, QODER_PROVIDER, QODER_BYOK_PROVIDER, pickContextWindow } from './adapter.ts'
export type { ImageRequestReader, QoderAdapterOptions } from './adapter.ts'
export { QoderSession, QoderSessionManager } from './session.ts'
export type { SessionRuntimeOptions } from './session.ts'
export { QODER_MODELS, MODEL_ALIASES, resolveQoderModelId, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './catalog.ts'
export { QoderModelCatalog } from './models.ts'
export {
  CONTEXT_WINDOW_MODES, CONTEXT_WINDOW_MODE_NAMES, BYOK_ROUTES, BYOK_ROUTE_NAMES,
  isContextWindowMode, resolveConfig,
} from './config.ts'
// The `Config` *type* is exported under a distinct name because this module also
// exports the `Config` *schema* value the loader reads; one module cannot
// re-export a type and declare a value under the same name.
export type {
  Config as QoderConfigShape, ResolvedConfig, ContextWindowMode, ByokRoute,
} from './config.ts'

/** Cordis plugin name; must match the `id` used by `cordis.patch.yml`. */
export const name = 'llm-qoder-cn'
/** The LLM registry must exist before an adapter can be registered on it. */
export const inject = ['llm']

/**
 * Configuration namespace: the profile entry id this plugin is mounted under.
 * The settings service and the configurable-provider directory both address the
 * plugin by this key, and the exported {@link ConfigSchema} is the form source,
 * so no page has to be registered by hand.
 */
const NS = 'llm-qoder-cn'

/** Encoded-byte ceiling for one forwarded request image, before base64 expansion. */
const REQUEST_IMAGE_MAX_BYTES = 1_048_576

/**
 * The plugin's configuration schema, re-exported under the name the loader
 * looks for. DSH reads `runtime.Config` off the plugin fiber to build the
 * settings page, so this must stay the exported `Config` binding.
 */
export const Config: z<QoderConfig> = ConfigSchema

/**
 * Mount the adapter for the lifetime of the plugin.
 *
 * @param ctx - the plugin's cordis context.
 * @param config - parsed plugin config; every field is defaulted by
 *   {@link resolveConfig}, so an empty object is a valid deployment.
 */
export function apply(ctx: Context, config: QoderConfig): void {
  const resolved = resolveConfig(config)
  let attachments: AttachmentStore | undefined

  const adapter = new QoderAdapter({
    maxSessions: resolved.maxSessions,
    modelCacheTtlMs: resolved.modelCacheTtlMs,
    toolResultTimeoutMs: resolved.toolResultTimeoutMs,
    abortGraceMs: resolved.abortGraceMs,
    coldMaxTurns: resolved.coldMaxTurns,
    catalogFetchTimeoutMs: resolved.catalogFetchTimeoutMs,
    byokRoute: resolved.byokRoute,
    contextWindowMode: resolved.contextWindowMode,
    contextWindowOverride: resolved.contextWindowOverride,
    defaultMaxTokens: resolved.defaultMaxTokens,
    enabledModels: resolved.enabledModels,
    disabledModels: resolved.disabledModels,
    modelAliases: resolved.modelAliases,
    defaultReasoningEffort: resolved.defaultReasoningEffort,
    displayName: resolved.displayName,
    byokDisplayName: resolved.byokDisplayName,
    identityOverride: resolved.identityOverride,
    // Images reach the inner model only through the host attachment store, so
    // this stays a lazy lookup. An unmounted store leaves the adapter with no
    // reader, and images degrade to the harness's own handle text instead of
    // failing the turn — which is also why `attachments` is not a hard inject:
    // the provider routes must register even on a deployment without one.
    readImage: (ref, signal) => {
      const store = attachments
      if (store === undefined) return Promise.resolve(undefined)
      // Ask for the attachment's own dimensions: the host already normalized
      // it, so only the byte ceiling binds the request version.
      return store.readImageRequest(ref, { width: ref.width, height: ref.height, maxBytes: REQUEST_IMAGE_MAX_BYTES }, signal)
        .then(image => ({ bytes: image.data, mediaType: image.mediaType }))
    },
  })

  ctx.inject(['attachments'], (scope) => {
    attachments = scope.attachments
    scope.effect(() => () => { attachments = undefined }, 'llm-qoder-cn.attachments')
  })

  // `byokRoute: inline` merges the account's custom models into the primary
  // route instead of giving them their own group, so the secondary route is
  // only registered when the deployment asked for it.
  const providers = resolved.byokRoute === 'separate'
    ? [QODER_PROVIDER, QODER_BYOK_PROVIDER]
    : [QODER_PROVIDER]
  ctx.llm.registerAdapter(providers, adapter)

  // Declare the routes in the configurable-provider directory so selection
  // surfaces (the composer model seat, the Models settings page) render the
  // Qoder groups with their display names instead of anonymous routes.
  ctx.llm.registerConfigurableProviders([
    { provider: QODER_PROVIDER, displayName: resolved.displayName, settingsNs: NS, settingsPath: [] },
    ...resolved.byokRoute === 'separate'
      ? [{ provider: QODER_BYOK_PROVIDER, displayName: resolved.byokDisplayName, settingsNs: NS, settingsPath: [] }]
      : [],
  ])

  // registerAdapter's disposer only withdraws the routes; the warm qodercli
  // subprocesses are owned by the adapter and must close with the plugin.
  ctx.effect(() => () => adapter.close(), 'llm-qoder-cn.sessions')

  // Surface the effective context policy once at mount: the compaction
  // threshold the harness derives is invisible otherwise, and picking a
  // window larger than the session really uses is the one setting that can
  // quietly break automatic compaction.
  ctx.logger?.info(
    `llm-qoder-cn: contextWindow=${resolved.contextWindowMode}`
    + (resolved.contextWindowMode === 'custom' ? ` (${resolved.contextWindowOverride} tokens)` : '')
    + `, compaction threshold ≈ ${Math.round(resolved.compactionThresholdHint * 100)}% of that window`,
  )
}
