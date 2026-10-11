/**
 * The settings page's data source, served same-origin.
 *
 * The page cannot read the model catalog from the config form: the catalog is
 * fetched live from the Qoder CLI, while the form only carries what the user
 * stored. So the host answers one read-only JSON route that joins the two:
 *
 * - `GET <prefix>/models` — every model the account exposes, each with its
 *   enabled state, the window it will use, and the windows it may use.
 *
 * Writes deliberately do NOT come through here. The browser half already holds
 * a revision-fenced form for this plugin's config namespace
 * (`ctx.configForms.get(ns)`), and routing every change through it means one
 * write path, one revision fence, and no second owner of the same document. A
 * host-side write would have to reach into the settings service and could race
 * the form.
 *
 * @module dsh-qoder-link/api
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { QoderAdapter } from './adapter.ts';
/** Route prefix this plugin owns; the client resolves it relative to the page. */
export declare const API_PREFIX = "/api/llm-qoder-cn";
/** One model row as the page renders it. */
interface ModelRow {
    /** Qoder model id, the identity every write uses. */
    id: string;
    /** Display name. */
    name: string;
    /** Model description, when upstream provides one. */
    description?: string;
    /** Whether the user currently allows this model in the picker. */
    enabled: boolean;
    /** Whether the model accepts image input. */
    vision: boolean;
    /** Where the model came from; `user`/`custom` mark account-added models. */
    source?: string;
    /** Window the requests will actually use, in tokens. */
    contextWindow: number;
    /** Windows the user may choose from, ascending. Always contains the current one. */
    contextWindows: number[];
    /** Upstream's own window for this model, i.e. what "default" means here. */
    defaultContextWindow: number;
    /** The user's explicit choice, or undefined when following upstream. */
    override?: number;
    /**
     * Credit multiplier upstream quotes for this model; `0` means free. Absent
     * when upstream quoted none, so the page shows no suffix rather than a
     * fabricated one.
     */
    priceFactor?: number;
    /** Whether the model supports a reasoning-effort choice. */
    reasoning: boolean;
}
/**
 * Build the model rows: the live catalog joined with the user's choices.
 *
 * @param adapter - the adapter owning the live catalog and the resolved config.
 * @returns one row per model the account exposes, in catalog order.
 */
export declare function buildRows(adapter: QoderAdapter): Promise<ModelRow[]>;
/**
 * Handle one request under {@link API_PREFIX}.
 *
 * @param req - the incoming request.
 * @param res - the response this handler owns.
 * @param adapter - the adapter whose live catalog backs the list.
 */
export declare function handleApi(req: IncomingMessage, res: ServerResponse, adapter: QoderAdapter): Promise<void>;
export {};
