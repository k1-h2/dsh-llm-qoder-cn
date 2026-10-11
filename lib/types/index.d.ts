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
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { Config as QoderConfig } from './config.ts';
export { QoderAdapter, QODER_PROVIDER, QODER_BYOK_PROVIDER, pickContextWindow } from './adapter.ts';
export type { ImageRequestReader, QoderAdapterOptions } from './adapter.ts';
export { QoderSession, QoderSessionManager } from './session.ts';
export type { SessionRuntimeOptions } from './session.ts';
export { QODER_MODELS, MODEL_ALIASES, resolveQoderModelId, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS } from './catalog.ts';
export { QoderModelCatalog } from './models.ts';
export { CONTEXT_WINDOW_MODES, CONTEXT_WINDOW_MODE_NAMES, BYOK_ROUTES, BYOK_ROUTE_NAMES, isContextWindowMode, resolveConfig, } from './config.ts';
export type { Config as QoderConfigShape, ResolvedConfig, ContextWindowMode, ByokRoute, } from './config.ts';
/** Cordis plugin name; must match the `id` used by `cordis.patch.yml`. */
export declare const name = "llm-qoder-cn";
/** The LLM registry must exist before an adapter can be registered on it. */
export declare const inject: string[];
/**
 * The plugin's configuration schema, re-exported under the name the loader
 * looks for. DSH reads `runtime.Config` off the plugin fiber to build the
 * settings page, so this must stay the exported `Config` binding.
 */
export declare const Config: z<QoderConfig>;
/**
 * Mount the adapter for the lifetime of the plugin.
 *
 * @param ctx - the plugin's cordis context.
 * @param config - parsed plugin config; every field is defaulted by
 *   {@link resolveConfig}, so an empty object is a valid deployment.
 */
export declare function apply(ctx: Context, config: QoderConfig): void;
