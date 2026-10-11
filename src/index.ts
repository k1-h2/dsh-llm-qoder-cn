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
 * ## Settings edits apply without a restart, and that shapes this module
 *
 * Every config field is volatile, and DSH commits a volatile-only edit into the
 * running plugin's config cells instead of restarting it — `apply()` is not
 * called again. The adapter is therefore handed {@link liveConfig} thunks and
 * reads each value where it uses it; the only things captured at mount are the
 * two registrations (`providersFor` / `directoryFor`), which are republished
 * through their `replace` handles when a field that decides a shape changes.
 * See `src/live.ts` for the mechanism.
 *
 * @module dsh-llm-qoder-cn
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ServerResponse, IncomingMessage } from 'node:http'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { QoderAdapter, QODER_BYOK_PROVIDER, QODER_PROVIDER } from './adapter.ts'
import { API_PREFIX, handleApi } from './api.ts'
import type { ByokRoute, LiveConfig, ParsedConfig } from './config.ts'
import { Config as ConfigSchema, liveConfig } from './config.ts'

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

  interface Events {
    /**
     * The loader committed a volatile-only config edit into this fiber.
     *
     * Emitted by `cordis-plugin-loader` from `Entry._commitVolatile` with the
     * config paths whose cells changed. The plugin does not restart for such an
     * edit, so this is the only notification that one happened; see
     * `src/live.ts`. Declared here because it is an internal loader event that
     * the framework's own `Events` interface does not carry.
     *
     * @param paths - one path array per committed field, e.g. `[['byokRoute']]`.
     */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

export { QoderAdapter, QODER_PROVIDER, QODER_BYOK_PROVIDER, pickContextWindow } from './adapter.ts'
export type { ImageRequestReader, QoderAdapterOptions } from './adapter.ts'
export { QoderSession, QoderSessionManager } from './session.ts'
export type { SessionRuntimeOptions } from './session.ts'
export { QODER_MODELS, MODEL_ALIASES, resolveQoderModelId, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './catalog.ts'
export { QoderModelCatalog, priceFactorOf } from './models.ts'
export { API_PREFIX, buildRows, handleApi } from './api.ts'
export type { Live } from './live.ts'
export { readLive, readLiveOptional } from './live.ts'
export { BYOK_ROUTES, BYOK_ROUTE_NAMES, liveConfig, resolveConfig } from './config.ts'
// The authoring shape is re-exported as `ConfigShape` because this module also
// exports the `Config` *schema* value the loader reads; one module cannot
// re-export a type and declare a value under the same name.
export type {
  Config as ConfigShape, LiveConfig, ParsedConfig, ResolvedConfig, ByokRoute,
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
 * Config fields whose value decides a registration shape rather than a runtime
 * behaviour, and which therefore cannot be read lazily.
 *
 * `byokRoute` decides whether the custom-model provider route exists at all;
 * the two display names are copied into the picker directory. Everything else
 * is read where it is used, so a change to one of these three is the only thing
 * that needs a republish.
 */
const STRUCTURAL_FIELDS: ReadonlySet<string> = new Set(['byokRoute', 'displayName', 'byokDisplayName'])

/**
 * The provider routes one resolved `byokRoute` implies.
 *
 * `inline` merges the account's custom models into the primary route instead of
 * giving them their own group, so the secondary route only exists for
 * `separate`.
 */
function providersFor(byokRoute: ByokRoute): string[] {
  return byokRoute === 'separate' ? [QODER_PROVIDER, QODER_BYOK_PROVIDER] : [QODER_PROVIDER]
}

/** The configurable-provider directory rows for the current display names. */
function directoryFor(live: LiveConfig): {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
}[] {
  return [
    { provider: QODER_PROVIDER, displayName: live.displayName(), settingsNs: NS, settingsPath: [] },
    ...live.byokRoute() === 'separate'
      ? [{ provider: QODER_BYOK_PROVIDER, displayName: live.byokDisplayName(), settingsNs: NS, settingsPath: [] }]
      : [],
  ]
}

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
  // Every field is read through this view rather than snapshotted, because a
  // volatile-only edit updates the config cells in place and never re-runs
  // `apply()` — see `live.ts`. A single resolved value taken here would be the
  // plugin's answer for the rest of the process lifetime.
  const live = liveConfig(config)
  let attachments: AttachmentStore | undefined

  const adapter = new QoderAdapter({
    maxSessions: live.maxSessions,
    modelCacheTtlMs: live.modelCacheTtlMs,
    toolResultTimeoutMs: live.toolResultTimeoutMs,
    abortGraceMs: live.abortGraceMs,
    coldMaxTurns: live.coldMaxTurns,
    catalogFetchTimeoutMs: live.catalogFetchTimeoutMs,
    byokRoute: live.byokRoute,
    modelContextWindows: live.modelContextWindows,
    defaultMaxTokens: live.defaultMaxTokens,
    disabledModels: live.disabledModels,
    modelAliases: live.modelAliases,
    defaultReasoningEffort: live.defaultReasoningEffort,
    displayName: live.displayName,
    byokDisplayName: live.byokDisplayName,
    identityOverride: live.identityOverride,
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

  // Routes and the provider directory are the two shapes a live value cannot
  // reach on its own: which provider ids exist, and the labels the selection
  // surfaces render. Both registrations return a handle that swaps its contents
  // atomically, so a structural edit is republished in place.
  const routes = ctx.llm.registerAdapter(providersFor(live.byokRoute()), adapter)

  // Declare the routes in the configurable-provider directory so selection
  // surfaces (the composer model seat, the Models settings page) render the
  // Qoder groups with their display names instead of anonymous routes.
  const directory = ctx.llm.registerConfigurableProviders(directoryFor(live))

  /**
   * Republish the routes and labels after a structural config edit.
   *
   * `byokRoute` decides whether the custom-model route exists at all and the
   * two display names label the picker groups, so none of the three can be
   * fixed at mount time. Everything else the adapter reads per use, which is
   * why this is the only reaction the plugin needs.
   */
  ctx.on('loader/volatile-update', (paths: readonly (readonly string[])[]) => {
    if (!paths.some(path => STRUCTURAL_FIELDS.has(String(path[0])))) return
    try {
      routes.replace(providersFor(live.byokRoute()))
      directory.replace(directoryFor(live))
    } catch (error) {
      ctx.logger?.warn(`llm-qoder-cn: 重新发布模型分组失败：${String(error)}`)
    }
  })

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
