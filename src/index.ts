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
import type { ServerResponse, IncomingMessage } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { QoderAdapter, QODER_BYOK_PROVIDER, QODER_PROVIDER } from './adapter.ts'
import { API_PREFIX, handleApi } from './api.ts'
import type { ParsedConfig } from './config.ts'
import { Config as ConfigSchema, resolveConfig } from './config.ts'

/**
 * The web carrier this plugin mounts its settings API on.
 *
 * Declared locally rather than imported from `@deepseek-ai/dsh-host-webserver`
 * so the plugin keeps only the peer dependencies it actually needs: a
 * deployment that boots without a web server must still load this plugin, and
 * an import of the carrier package would make it a hard requirement.
 */
interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only in web compositions; reached through a nested inject. */
    webServer?: WebServerService
  }
}

export { QoderAdapter, QODER_PROVIDER, QODER_BYOK_PROVIDER, pickContextWindow } from './adapter.ts'
export type { ImageRequestReader, QoderAdapterOptions } from './adapter.ts'
export { QoderSession, QoderSessionManager } from './session.ts'
export type { SessionRuntimeOptions } from './session.ts'
export { QODER_MODELS, MODEL_ALIASES, resolveQoderModelId, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './catalog.ts'
export { QoderModelCatalog, priceFactorOf } from './models.ts'
export { API_PREFIX, buildRows, handleApi } from './api.ts'
export { BYOK_ROUTES, BYOK_ROUTE_NAMES, resolveConfig } from './config.ts'
// The authoring shape is re-exported as `ConfigShape` because this module also
// exports the `Config` *schema* value the loader reads; one module cannot
// re-export a type and declare a value under the same name.
export type {
  Config as ConfigShape, ParsedConfig, ResolvedConfig, ByokRoute,
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
 *
 * Every field is `.volatile()`, which is what makes the namespace appear in
 * `settings.describe()` at all — see the note on {@link ConfigSchema}.
 */
export const Config = ConfigSchema

/**
 * Mount the adapter for the lifetime of the plugin.
 *
 * @param ctx - the plugin's cordis context.
 * @param config - parsed plugin config, whose volatile fields arrive as
 *   references; {@link resolveConfig} unwraps and defaults them, so an empty
 *   object is a valid deployment.
 */
export function apply(ctx: Context, config: ParsedConfig): void {
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
    modelContextWindows: resolved.modelContextWindows,
    defaultMaxTokens: resolved.defaultMaxTokens,
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

  // The settings page's data source: the live catalog joined with the user's
  // on/off and window choices. Served from its own route because the catalog
  // comes from the CLI and cannot ride the config form.
  //
  // `webServer` publishes after plugin load, so this pends on a nested fiber
  // rather than reading the service at apply time — a `ctx.get('webServer')`
  // here answers undefined in a real web composition.
  ctx.inject(['webServer'], (scope) => {
    const server = scope.webServer
    if (server === undefined) return
    scope.effect(
      () => server.register({
        kind: 'prefix',
        path: API_PREFIX,
        handler: (req, res) => { void handleApi(req, res, adapter) },
      }),
      'llm-qoder-cn: settings api',
    )
    ctx.logger?.info(`llm-qoder-cn: 设置接口已挂载于 ${API_PREFIX}`)
  })
}
