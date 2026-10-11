import { CONTEXT_WINDOW_EXCEEDED_CODE, EMPTY_RESPONSE_CODE, LlmAdapter, LlmError, QUOTA_EXCEEDED_CODE, ReasoningEffortId, ToolCallId, fileHandleText, isContextWindowExceededError, isQuotaExceededError, offloadedImageText, textOnlyImageText } from "@deepseek-ai/dsh-llm";
import { createSdkMcpServer, qodercliAuth, query } from "@qodercn-ai/qodercn-agent-sdk";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isVolatile } from "@deepseek-ai/cosmokit";
import z$1 from "@deepseek-ai/schemastery";
//#region src/catalog.ts
/** Default combined context capacity assumed for Qoder-backed models. */
const DEFAULT_CONTEXT_WINDOW = 2e5;
/** Default per-request output cap assumed for Qoder-backed models. */
const DEFAULT_MAX_TOKENS = 32e3;
/** Every model the account exposed at capture time, in SDK display order. */
const QODER_MODELS = [
	{
		id: "auto",
		name: "Auto",
		description: "Qoder 自动路由"
	},
	{
		id: "ultimate",
		name: "Ultimate",
		description: "最强档位路由"
	},
	{
		id: "performance",
		name: "Performance"
	},
	{
		id: "efficient",
		name: "Efficient"
	},
	{
		id: "lite",
		name: "Lite"
	},
	{
		id: "cmodel",
		name: "Cantus"
	},
	{
		id: "qmodel_38max",
		name: "Qwen3.8-Max"
	},
	{
		id: "qmodel_latest",
		name: "Qwen3.7-Max"
	},
	{
		id: "qmodel",
		name: "Qwen3.7-Plus"
	},
	{
		id: "kmodel_latest",
		name: "Kimi-K3"
	},
	{
		id: "kmodel",
		name: "Kimi-K2.7-Code"
	},
	{
		id: "gmodel",
		name: "GLM-5.3"
	},
	{
		id: "gm51model",
		name: "GLM-5.2"
	},
	{
		id: "dmodel",
		name: "DeepSeek-V4-Pro"
	},
	{
		id: "dfmodel",
		name: "DeepSeek-V4-Flash"
	},
	{
		id: "mmodel",
		name: "MiniMax-M3"
	}
];
/**
* Convenience aliases so a dsh deployment can keep using its own DeepSeek
* model names against the Qoder route.
*/
const MODEL_ALIASES = {
	"deepseek-v4-flash": "dfmodel",
	"deepseek-v4-pro": "dmodel"
};
/**
* Map a dsh-side model id onto a Qoder SDK model value.
*
* Aliases are checked first (config-supplied aliases take precedence over the
* built-in ones), then any `qoder-` prefix is stripped, and an empty result
* falls back to `auto`.
*
* @param model - model id from {@link import('@deepseek-ai/dsh-llm').GenerateOptions.model}.
* @param extraAliases - user-configured aliases, merged over {@link MODEL_ALIASES}.
* @returns the Qoder model value; the CLI falls back to `auto` for unknown values.
*/
function resolveQoderModelId(model, extraAliases) {
	const key = model.toLowerCase();
	const configured = extraAliases?.[key] ?? extraAliases?.[model];
	if (configured !== void 0 && configured.length > 0) return configured;
	const aliased = MODEL_ALIASES[key];
	if (aliased !== void 0) return aliased;
	const stripped = model.startsWith("qoder-") ? model.slice(6) : model;
	return stripped.length > 0 ? stripped : "auto";
}
//#endregion
//#region src/live.ts
/**
* Resolve one {@link Live} option, falling back when it is absent.
*
* @param value - the plain value or thunk, possibly undefined.
* @param fallback - value used when the option is absent or resolves to undefined.
* @returns the option's current value.
*/
function readLive(value, fallback) {
	const current = typeof value === "function" ? value() : value;
	return current === void 0 ? fallback : current;
}
/**
* Resolve one {@link Live} option that may legitimately be undefined.
*
* Separate from {@link readLive} because an option whose "unset" state is
* itself meaningful (`defaultReasoningEffort`: empty means "follow upstream")
* has no fallback to apply.
*
* @param value - the plain value or thunk, possibly undefined.
* @returns the option's current value, or undefined when it is unset.
*/
function readLiveOptional(value) {
	return typeof value === "function" ? value() : value;
}
//#endregion
//#region src/models.ts
/** How long a fetched catalog stays fresh by default. */
const DEFAULT_MODEL_CACHE_TTL_MS = 3e5;
/** Give up on one CLI catalog fetch after this long by default. */
const DEFAULT_FETCH_TIMEOUT_MS = 2e4;
/**
* Last successful catalog, shared by every {@link QoderModelCatalog} in this
* process.
*
* A settings write does NOT restart this plugin — a volatile edit is committed
* into the running cells (see `live.ts`) — so the cache now only has to survive
* a real remount: enabling the plugin, a profile reload, or a DSH restart. It
* matters in exactly those cases, because the first settings read after the
* remount would otherwise cold-start the Qoder CLI and stall the page for
* seconds.
*
* The entry carries its own timestamp and is only used while it is still within
* the requesting catalog's TTL, so normal freshness is unchanged.
*/
let sharedSnapshot;
/** Cached live CLI catalog with a static fallback. */
var QoderModelCatalog = class {
	ttlMs;
	fetchTimeoutMs;
	cached;
	inflight;
	/**
	* @param ttlMs - how long a fetched catalog stays fresh before a re-fetch.
	*   Read per use, so a settings edit takes effect on the next read.
	* @param fetchTimeoutMs - how long one CLI catalog fetch may take before the
	*   static fallback takes over.
	*/
	constructor(ttlMs, fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS) {
		this.ttlMs = ttlMs;
		this.fetchTimeoutMs = fetchTimeoutMs;
	}
	/** Raw live entries; the stale snapshot when a refresh fails, else nothing. */
	async liveModels() {
		const ttlMs = readLive(this.ttlMs, DEFAULT_MODEL_CACHE_TTL_MS);
		const fresh = (snapshot) => snapshot !== void 0 && Date.now() - snapshot.at < ttlMs;
		const cached = this.cached ?? sharedSnapshot;
		if (fresh(cached) && cached !== void 0) {
			this.cached = cached;
			return cached.models;
		}
		this.inflight ??= this.fetch().finally(() => {
			this.inflight = void 0;
		});
		try {
			const models = await this.inflight;
			const snapshot = {
				at: Date.now(),
				models
			};
			this.cached = snapshot;
			sharedSnapshot = snapshot;
			return models;
		} catch {
			return (this.cached ?? sharedSnapshot)?.models ?? [];
		}
	}
	/** dsh catalog entries: the enabled live list, or the static fallback. */
	async models() {
		const live = (await this.liveModels()).filter((model) => model.isEnabled !== false);
		if (live.length === 0) return QODER_MODELS;
		return live.map((model) => ({
			id: model.value,
			name: model.displayName.length > 0 ? model.displayName : model.value,
			...model.description.length > 0 ? { description: model.description } : {},
			...model.source === void 0 ? {} : { source: model.source },
			...model.isVl === true ? { isVl: true } : {}
		}));
	}
	async fetch() {
		const q = query({
			prompt: inertInput(),
			options: {
				auth: qodercliAuth(),
				tools: [],
				allowedTools: [],
				settingSources: [],
				maxTurns: 1
			}
		});
		try {
			return await withTimeout(q.getAvailableModels({ fetchStrategy: "live" }), readLive(this.fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS));
		} finally {
			await q.close().catch(() => void 0);
		}
	}
};
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
function priceFactorOf(entry) {
	const value = entry.priceFactor;
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : void 0;
}
/** Streaming prompt that never yields, so no model turn runs during the fetch. */
async function* inertInput() {
	await new Promise(() => {});
}
function withTimeout(promise, ms) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(/* @__PURE__ */ new Error(`qoder model catalog fetch timed out after ${ms}ms`));
		}, ms);
		promise.then((value) => {
			clearTimeout(timer);
			resolve(value);
		}, (error) => {
			clearTimeout(timer);
			reject(error);
		});
	});
}
//#endregion
//#region src/render.ts
/**
* Render harness messages into the turns fed to the inner Qoder session.
* Tool calls and results need no protocol here — they travel through the
* in-process MCP server — so this layer handles conversational context: the
* host system prompt, user turns, and (for full rebuilds) prior history as
* compact text.
*
* A feed is plain text unless the *current* turn carries image occurrences,
* in which case it is a part list so those bytes can ride along. Historical
* images stay text: the harness has already replaced them with its own
* placeholder for text-only routes, and re-sending archived pixels on every
* rebuild would price a screenshot into every later request.
* @module dsh-llm-qoder/render
*/
/**
* Image references in block order, skipping occurrences the surface already
* offloaded: an offload is a durable fact the harness renders as path-bearing
* placeholder text on every route, so re-sending those pixels would undo it.
*/
function imageRefs(blocks) {
	const refs = [];
	for (const block of blocks) if (block.type === "image" && block.offloaded !== true) refs.push(block.attachment);
	return refs;
}
/** Render one content-block list as plain text; non-text blocks get handles. */
function renderBlocks(blocks) {
	const parts = [];
	for (const block of blocks) switch (block.type) {
		case "text":
			parts.push(block.text);
			break;
		case "reasoning": break;
		case "image":
			parts.push(block.offloaded === true ? offloadedImageText(block.attachment) : textOnlyImageText(block.attachment));
			break;
		case "file":
			parts.push(fileHandleText(block.attachment, void 0));
			break;
		case "tool-call":
			parts.push(`[调用了工具 ${block.name}(${block.arguments})]`);
			break;
		case "tool-addition":
			parts.push(`[工具启用 ${block.toolName}]`);
			break;
		case "tool-removal":
			parts.push(`[工具停用 ${block.toolName}]`);
			break;
		default: parts.push(JSON.stringify(block));
	}
	return parts.join("\n");
}
/** Role tag {@link renderMessage} uses, without the rendered content. */
function roleTag(message) {
	switch (message.role) {
		case "system": return "系统提示";
		case "developer": return "开发者";
		case "user": return "用户";
		case "assistant": return "助手";
		case "tool": return "工具结果";
	}
}
/**
* Render one request message with its role tag. A request-only user input has
* no durable identity or source, so it reads exactly like a user message.
*/
function renderMessage(message) {
	return `[${roleTag(message)}] ${renderBlocks(message.content)}`;
}
/** Preamble establishing the inner model's role as this agent's LLM backend. */
const BACKEND_ROLE = [
	"你在为一个编码 agent（宿主）充当 LLM API 后端：宿主把它的对话喂给你，你只输出\"下一条助手回复\"本身。",
	"宿主的工具已经通过 MCP 挂进来，需要用工具时直接调用，不要描述你会在别的环境里怎么调。",
	"不要复述对话，不要解释你的角色。"
].join("\n");
/**
* Join feed sections into one feed. While no section carries an image the
* result is the historical text shape, sections separated by a blank line;
* the first image turns the whole feed into parts, with the text around it
* merged into the parts before and after.
*/
function joinFeeds(sections) {
	const parts = [];
	const push = (part) => {
		if (part.type === "text" && part.text.length === 0) return;
		const previous = parts.at(-1);
		if (previous !== void 0 && previous.type === "text" && part.type === "text") {
			previous.text = `${previous.text}\n\n${part.text}`;
			return;
		}
		parts.push(part.type === "text" ? {
			type: "text",
			text: part.text
		} : {
			type: "image",
			attachment: part.attachment
		});
	};
	for (const section of sections) if (typeof section === "string") push({
		type: "text",
		text: section
	});
	else for (const part of section) push(part);
	if (parts.filter((part) => part.type === "image").length > 0) return parts;
	return parts.map((part) => part.type === "text" ? part.text : "").join("\n\n");
}
/** Render a block list as parts, keeping image occurrences as their references. */
function blockParts(blocks) {
	const parts = [];
	let pending = [];
	const flush = () => {
		if (pending.length === 0) return;
		parts.push({
			type: "text",
			text: pending.join("\n")
		});
		pending = [];
	};
	for (const block of blocks) {
		if (block.type === "image" && block.offloaded !== true) {
			flush();
			parts.push({
				type: "image",
				attachment: block.attachment
			});
			continue;
		}
		const text = renderBlocks([block]);
		if (text.length > 0) pending.push(text);
	}
	flush();
	return parts;
}
/** Prefix a label onto a feed, folding it into the leading text when there is any. */
function label(labelText, feed) {
	if (typeof feed === "string") return labelText + feed;
	const first = feed[0];
	if (first === void 0) return [{
		type: "text",
		text: labelText
	}];
	if (first.type === "text") return [{
		type: "text",
		text: `${labelText}${first.text}`
	}, ...feed.slice(1)];
	return [{
		type: "text",
		text: labelText
	}, ...feed];
}
/**
* Index where the message list's current turn starts: everything after the
* last assistant reply is new content the inner session has not seen, so its
* images are worth forwarding as bytes.
*/
function currentTurnStart(messages) {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i]?.role === "assistant") return i + 1;
	return 0;
}
/** Image references carried by a feed, in order. */
function feedImageRefs(feed) {
	if (typeof feed === "string") return [];
	return feed.filter((part) => part.type === "image").map((part) => part.attachment);
}
/** Flatten a feed back to text, replacing images with the harness handle text. */
function feedToText(feed) {
	if (typeof feed === "string") return feed;
	return feed.map((part) => part.type === "text" ? part.text : textOnlyImageText(part.attachment)).filter((text) => text.length > 0).join("\n\n");
}
/** Literal characters in a feed; images contribute their pixels, not text. */
function feedTextLength(feed) {
	if (typeof feed === "string") return feed.length;
	return feed.reduce((total, part) => total + (part.type === "text" ? part.text.length : 0), 0);
}
/**
* Compose the first feed for a fresh session: backend role, the host system
* prompt, and the existing conversation as compact context. Messages of the
* current turn keep their image references; earlier ones are handles.
*/
function renderInitialFeed(system, messages) {
	const from = currentTurnStart(messages);
	const history = [];
	for (const [index, message] of messages.entries()) {
		const entry = index >= from && imageRefs(message.content).length > 0 ? label(`[${roleTag(message)}] `, blockParts(message.content)) : renderMessage(message);
		if (feedToText(entry).length > 0) history.push(entry);
	}
	const sections = [BACKEND_ROLE];
	if (system !== void 0 && system.length > 0) sections.push(`---- 宿主系统提示（作为你的行为准则） ----\n${system}`);
	const first = history[0];
	if (first !== void 0) {
		sections.push(label("---- 宿主对话记录 ----\n", first));
		sections.push(...history.slice(1));
	}
	sections.push("---- 以上是背景。输出下一条助手回复。 ----");
	return joinFeeds(sections);
}
/** Render a brand-new host user turn; images stay references, text-only stays a string. */
function renderUserTurn(blocks) {
	if (imageRefs(blocks).length === 0) return `[用户] ${renderBlocks(blocks)}`;
	return label("[用户] ", blockParts(blocks));
}
/** Render an in-place-updated message (runtime-context snapshots and the like). */
function renderRefreshed(message) {
	return `${renderMessage(message)}\n（宿主原位刷新了这条消息）`;
}
/**
* Identity override appended to the qodercli preset system prompt: the inner
* model answers as the host's agent, never as Qoder itself.
*/
function renderIdentityAppend(hostSystem) {
	const parts = ["你当前作为一个宿主编码 agent 的内置 LLM 后端运行：对外身份以宿主的设定为准。", "当被问及“你是谁”这类身份问题时，按宿主系统提示中的身份回答；不要自称 Qoder，不要提及 qodercli、SDK 或你作为内部后端的事实。"];
	if (hostSystem !== void 0 && hostSystem.length > 0) parts.push(`---- 宿主系统提示（作为你的行为准则与对外身份） ----\n${hostSystem}`);
	return parts.join("\n\n");
}
//#endregion
//#region src/jsonschema.ts
/**
* Convert dsh `ToolSchema.parameters` (a JSON Schema object) into a zod raw
* shape for the SDK's in-process MCP `tool()` registration. Fidelity is
* one-directional on purpose: anything the converter does not recognize maps
* to `z.unknown()`, and objects stay loose (zod strips unknown keys instead
* of rejecting them), so a converted tool never rejects arguments the host
* tool would have accepted. Unmapped PROPERTY NAMES still appear in the shape
* (as `z.unknown()`), so nothing the model sends is silently stripped.
* @module dsh-llm-qoder/jsonschema
*/
/**
* Convert one JSON Schema node into one zod schema.
* @param schema - a JSON Schema node (object form expected).
* @param depth - recursion guard; past the cap every node becomes `z.unknown()`.
* @returns a zod schema covering the recognized constructs.
*/
function jsonSchemaToZod(schema, depth = 0) {
	if (schema === void 0 || depth > 6) return z.unknown();
	if (Array.isArray(schema.enum)) {
		const values = schema.enum.filter((v) => typeof v === "string");
		if (values.length === schema.enum.length && values.length > 0) return z.enum(values);
		return z.unknown();
	}
	const type = schema.type;
	const description = typeof schema.description === "string" ? schema.description : void 0;
	let base;
	switch (type) {
		case "string":
			base = z.string();
			break;
		case "number":
			base = z.number();
			break;
		case "integer":
			base = z.number().int();
			break;
		case "boolean":
			base = z.boolean();
			break;
		case "array": {
			const items = schema.items;
			base = z.array(jsonSchemaToZod(typeof items === "object" && items !== null && !Array.isArray(items) ? items : void 0, depth + 1));
			break;
		}
		case "object": {
			const properties = schema.properties;
			const required = Array.isArray(schema.required) ? schema.required.filter((v) => typeof v === "string") : [];
			const shape = {};
			if (typeof properties === "object" && properties !== null) for (const [key, node] of Object.entries(properties)) {
				const nodeSchema = typeof node === "object" && node !== null && !Array.isArray(node) ? node : void 0;
				shape[key] = required.includes(key) ? jsonSchemaToZod(nodeSchema, depth + 1) : jsonSchemaToZod(nodeSchema, depth + 1).optional();
			}
			base = z.object(shape);
			break;
		}
		default: base = z.unknown();
	}
	return description === void 0 ? base : base.describe(description);
}
/**
* Convert a tool's `parameters` JSON Schema into a zod raw shape for `tool()`.
* A non-object schema yields a single catch-all shape so registration stays valid.
* @param parameters - the JSON Schema object from a dsh `ToolSchema`.
* @returns the zod raw shape handed to the SDK MCP `tool()`.
*/
function jsonSchemaToShape(parameters) {
	const properties = parameters.properties;
	if (typeof properties !== "object" || properties === null) return {};
	const shape = {};
	const required = Array.isArray(parameters.required) ? parameters.required.filter((v) => typeof v === "string") : [];
	for (const [key, node] of Object.entries(properties)) {
		const nodeSchema = typeof node === "object" && node !== null && !Array.isArray(node) ? node : void 0;
		shape[key] = required.includes(key) ? jsonSchemaToZod(nodeSchema, 1) : jsonSchemaToZod(nodeSchema, 1).optional();
	}
	return shape;
}
//#endregion
//#region src/session.ts
/**
* One long-lived inner Qoder CLI session per host session id: a channel-fed
* `query()` subprocess whose model continuation streams out as harness
* `StreamChunk`s. Host tool calls travel through an in-process MCP server:
* the handler parks on a promise, the adapter finishes the turn with
* `tool-calls`, and the next host request (carrying tool results) resolves
* the parked promise so the inner model continues with the result in place.
* @module dsh-llm-qoder/session
*/
/** MCP server name this adapter exposes host tools under. */
const MCP_SERVER_NAME = "dsh-host";
/** Prefix qodercli uses for this server's tools inside `canUseTool`. */
const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;
/** How long an MCP tool handler waits for the host tool result before failing the call. */
const DEFAULT_TOOL_RESULT_TIMEOUT_MS = 12e4;
/** How long the inner process gets to acknowledge an abort before the turn is force-ended. */
const DEFAULT_ABORT_GRACE_MS = 5e3;
/** Inner turns allowed for one side-channel (title, compaction) request. */
const DEFAULT_COLD_MAX_TURNS = 4;
/** Minimal push-only async channel feeding the SDK's streaming-input mode. */
function createChannel() {
	const queue = [];
	let resolve = null;
	return {
		push(message) {
			if (resolve !== null) {
				const settle = resolve;
				resolve = null;
				settle({
					value: message,
					done: false
				});
			} else queue.push(message);
		},
		[Symbol.asyncIterator]() {
			return { next() {
				const message = queue.shift();
				if (message !== void 0) return Promise.resolve({
					value: message,
					done: false
				});
				return new Promise((settle) => {
					resolve = settle;
				});
			} };
		}
	};
}
/** Unbounded FIFO the consumer pushes into and the active turn pumps out. */
var TurnQueue = class {
	items = [];
	resolve = null;
	closed = false;
	push(item) {
		if (this.closed) return;
		if (this.resolve !== null) {
			const settle = this.resolve;
			this.resolve = null;
			settle({
				value: item,
				done: false
			});
		} else this.items.push(item);
	}
	close() {
		this.closed = true;
		if (this.resolve !== null) {
			const settle = this.resolve;
			this.resolve = null;
			settle({
				value: void 0,
				done: true
			});
		}
	}
	[Symbol.asyncIterator]() {
		return { next: () => {
			const item = this.items.shift();
			if (item !== void 0) return Promise.resolve({
				value: item,
				done: false
			});
			if (this.closed) return Promise.resolve({
				value: void 0,
				done: true
			});
			return new Promise((settle) => {
				this.resolve = settle;
			});
		} };
	}
	/** Whether the turn already ended; late pushes are dropped. */
	get isClosed() {
		return this.closed;
	}
};
/**
* The host tool runtime dispatches by the bare host name; the inner model
* only ever sees the namespaced MCP form, so strip the prefix on the way out.
*/
function hostToolName(name) {
	return name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name;
}
/** Deny native tools, allow this adapter's MCP tools. */
async function gateTools(toolName, _input, options) {
	const echo = options.toolUseID !== void 0 ? { toolUseID: options.toolUseID } : {};
	if (toolName.startsWith(MCP_TOOL_PREFIX)) return {
		behavior: "allow",
		...echo
	};
	return {
		behavior: "deny",
		message: "本会话是宿主 agent 的 LLM 后端，不直接执行工具。宿主的工具已通过 MCP 挂入，直接调用它们即可。",
		...echo
	};
}
/**
* One warm inner session. All mutation happens on the consumer fiber except
* the documented turn lifecycle driven by {@link stream}.
*/
var QoderSession = class {
	sessionId;
	channel = createChannel();
	/**
	* Lazy: the MCP SDK refuses tool registration after the transport connects,
	* so the inner process only spawns once {@link ensureTools} has registered
	* the host tools (the adapter does that immediately before each stream).
	*/
	q = null;
	/**
	* Tool-call pairing state. qodercli asks `canUseTool` (with the qodercli
	* tool-use id) once per call in execution order, then sends the MCP message;
	* the host sees tool calls as content blocks and delivers all results up
	* front on the next request. Tool-use ids therefore arrive in the handler in
	* canUseTool order, and host callIds map back to them via the content-block
	* ids — so handlers park under the exact tool-use id, never a shifted FIFO
	* slot. Results buffer by tool-use id until their handler fires.
	*/
	parked = /* @__PURE__ */ new Map();
	pendingResults = /* @__PURE__ */ new Map();
	/** qodercli tool-use ids in canUseTool (execution) order, claimed by MCP handlers. */
	toolUseQueue = [];
	/** Host callId (qoder-N) → qodercli tool-use id, from the content-block ids. */
	hostCallByToolUse = /* @__PURE__ */ new Map();
	mcp = createSdkMcpServer({
		name: MCP_SERVER_NAME,
		tools: []
	});
	registered = /* @__PURE__ */ new Map();
	queue = null;
	model;
	reasoningEffort;
	callCounter = 0;
	/**
	* Per-instance suffix for emitted host call ids. Ids must stay unique across
	* the whole host session log: a history divergence rebuilds this class, LRU
	* eviction recreates it, and the harness keys tool-call blocks by id, so a
	* fresh `qoder-1` would collide with the one its predecessor already stored.
	*/
	callNonce = randomUUID().slice(0, 8);
	abortPending = false;
	disposed = false;
	/** Previous request's messages for delta feeding. */
	fedMessages;
	fedSystem;
	/** This turn's fed characters, reset per turn for per-call token accounting. */
	turnInputChars = 0;
	/** Host system prompt captured before spawn for the boot-time systemPrompt. */
	hostSystem;
	/** Host session workspace; qodercli runs there so its preset reports the session cwd. */
	sessionCwd;
	blockIndex = 0;
	textBlock;
	reasoningBlock;
	openTool;
	toolCalls = [];
	outputChars = 0;
	reasoningChars = 0;
	/** Last real usage reported by the inner model for the active turn. */
	lastUsage;
	/**
	* Session-level input token estimate for the CURRENT request, priced the
	* same way the harness token meter prices the surface (4 chars per token
	* on the rendered conversation the inner session actually receives). The
	* qoder CLI zeroes its per-stream usage frames, so without this the harness
	* context meter would read ~0% and auto-compaction would never trigger.
	*/
	estimatedInputTokens;
	/** Per-session runtime knobs, resolved from the plugin config at creation. */
	toolResultTimeoutMs;
	abortGraceMs;
	identityOverride;
	constructor(sessionId, initialModel, runtime = {}) {
		this.sessionId = sessionId;
		this.model = initialModel;
		this.toolResultTimeoutMs = readLive(runtime.toolResultTimeoutMs, DEFAULT_TOOL_RESULT_TIMEOUT_MS);
		this.abortGraceMs = readLive(runtime.abortGraceMs, DEFAULT_ABORT_GRACE_MS);
		this.identityOverride = readLive(runtime.identityOverride, false) === true;
	}
	/** Spawn the inner process (first stream only) and attach the consumer. */
	ensureStarted() {
		if (this.q !== null) return this.q;
		const q = query({
			prompt: this.channel,
			options: {
				auth: qodercliAuth(),
				tools: [],
				allowedTools: [],
				canUseTool: this.canUseTool,
				settingSources: [],
				includePartialMessages: true,
				resolveModel: () => ({
					model: this.model,
					...this.reasoningEffort === void 0 ? {} : { parameters: { reasoningEffort: this.reasoningEffort } }
				}),
				mcpServers: { [MCP_SERVER_NAME]: this.mcp },
				allowedMcpServerNames: [MCP_SERVER_NAME],
				...this.hostSystem === void 0 ? {} : { systemPrompt: this.hostSystem },
				...this.sessionCwd === void 0 ? {} : { cwd: this.sessionCwd }
			}
		});
		this.q = q;
		this.consume(q);
		return q;
	}
	/** Point the session at a model and its per-request policy. */
	setModel(model, policy) {
		this.model = model;
		this.reasoningEffort = policy?.reasoningEffort;
	}
	/** Record the host system prompt; effective only before the process spawns. */
	/**
	* Record the host system prompt; effective only before the process spawns.
	*
	* When `identityOverride` is on, the identity block is prepended here rather
	* than in the adapter so it applies to the warm-session path and the cold
	* side-channel path alike, and so the prompt the harness believes it sent
	* stays untouched in its own records.
	*/
	setSystem(system) {
		this.hostSystem = this.identityOverride ? renderIdentityAppend(system) : system;
	}
	/**
	* Record the host session workspace; effective only before the process
	* spawns. qodercli inherits the host process cwd otherwise, which would
	* make its preset report the server's launch directory instead of the
	* session's workspace.
	*/
	setCwd(cwd) {
		this.sessionCwd = cwd;
	}
	/**
	* Permission gate for the inner process. Native tools are denied; MCP host
	* tools are allowed, and each allowed call's qodercli tool-use id is queued
	* so the matching MCP handler can park under the exact id (qodercli asks
	* once per call, in execution order, before sending the MCP message).
	*/
	canUseTool = (toolName, _input, options) => {
		if (toolName.startsWith(MCP_TOOL_PREFIX)) {
			if (options.toolUseID !== void 0) this.toolUseQueue.push(options.toolUseID);
			return Promise.resolve({
				behavior: "allow",
				...options.toolUseID === void 0 ? {} : { toolUseID: options.toolUseID }
			});
		}
		return Promise.resolve({
			behavior: "deny",
			message: "本会话是宿主 agent 的 LLM 后端，不直接执行工具。宿主的工具已通过 MCP 挂入，直接调用它们即可。",
			...options.toolUseID === void 0 ? {} : { toolUseID: options.toolUseID }
		});
	};
	/** Register any host tools whose schema this session's MCP server lacks. */
	ensureTools(tools) {
		for (const schema of tools) {
			const hash = JSON.stringify(schema.parameters ?? {});
			if (this.registered.get(schema.name) === hash) continue;
			const shape = jsonSchemaToShape(schema.parameters ?? {});
			try {
				this.mcp.instance.registerTool(schema.name, {
					description: schema.description.length > 0 ? schema.description : schema.name,
					inputSchema: shape
				}, async (args) => {
					const toolUseId = this.toolUseQueue.shift();
					let result;
					if (toolUseId !== void 0 && this.pendingResults.has(toolUseId)) {
						result = this.pendingResults.get(toolUseId);
						this.pendingResults.delete(toolUseId);
					} else {
						const key = toolUseId ?? `anon-${this.callCounter}-${this.parked.size}`;
						result = await new Promise((resolve) => {
							const timer = setTimeout(() => {
								this.parked.delete(key);
								resolve({
									content: [{
										type: "text",
										text: `宿主在 ${this.toolResultTimeoutMs / 1e3}s 内未返回工具结果（toolUseId=${key}），本次工具调用已取消`
									}],
									isError: true
								});
							}, this.toolResultTimeoutMs);
							this.parked.set(key, (payload) => {
								clearTimeout(timer);
								resolve(payload);
							});
						});
					}
					return {
						content: result.content,
						...result.isError ? { isError: true } : {}
					};
				});
			} catch {
				continue;
			}
			this.registered.set(schema.name, hash);
		}
	}
	/**
	* Deliver host tool results to parked or buffered handlers, keyed by call id.
	* @param tail - the host messages appended since the previous request.
	* @param images - adapter-resolved request images keyed by attachment id; an
	*   id missing from the map degrades to handle text.
	*/
	deliverToolResults(tail, images) {
		let freshUserTurn = false;
		for (const message of tail) {
			if (message.role === "user") {
				freshUserTurn = true;
				continue;
			}
			if (message.role !== "tool") continue;
			const callId = String(message.toolCallId);
			const payload = {
				content: renderResultContent(message.content, images),
				isError: message.isError === true
			};
			const key = this.hostCallByToolUse.get(callId) ?? callId;
			const resolve = this.parked.get(key);
			if (resolve !== void 0) {
				this.parked.delete(key);
				resolve(payload);
			} else this.pendingResults.set(key, payload);
		}
		if (freshUserTurn && this.parked.size > 0) {
			const stale = [...this.parked.entries()];
			this.parked.clear();
			for (const [, resolve] of stale) resolve({
				content: [{
					type: "text",
					text: "[宿主取消了这次工具执行]"
				}],
				isError: true
			});
		}
	}
	/**
	* Run one inner turn: feed (if any) then pump consumer chunks until finish.
	* @param options - the host request (signal; tools already registered).
	* @param feed - literal text, resolved content blocks (a vision turn), or
	*   null for a pure tool-result continuation.
	*/
	async *stream(options, feed) {
		if (this.queue !== null) throw new LlmError(`qoder session ${this.sessionId} already has a turn in flight`, "CONFLICT");
		if (this.disposed) throw new LlmError(`qoder session ${this.sessionId} was disposed`, "TRANSPORT");
		const q = this.ensureStarted();
		this.queue = new TurnQueue();
		this.resetTurnState();
		if (feed !== null) {
			const content = typeof feed === "string" ? [{
				type: "text",
				text: feed
			}] : [...feed];
			this.turnInputChars += contentChars(content);
			this.channel.push({
				type: "user",
				message: {
					role: "user",
					content
				},
				parent_tool_use_id: null
			});
		}
		const signal = options.signal;
		let abortTimer;
		const onAbort = () => {
			this.abortPending = true;
			q.interrupt().catch(() => void 0);
			abortTimer = setTimeout(() => this.endTurn({
				kind: "aborted",
				failure: {
					message: "qoder session aborted by host",
					code: "ABORTED"
				}
			}), this.abortGraceMs);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			for await (const item of this.queue) {
				if (item.kind === "chunk") {
					yield item.chunk;
					continue;
				}
				if (item.usage !== void 0) yield {
					type: "usage",
					usage: this.usage()
				};
				yield {
					type: "finish",
					reason: item.reason
				};
				return;
			}
		} finally {
			signal?.removeEventListener("abort", onAbort);
			if (abortTimer !== void 0) clearTimeout(abortTimer);
			this.queue = null;
			this.abortPending = false;
		}
	}
	/** Tear the inner process down; parked calls die with it. */
	close() {
		if (this.disposed) return;
		this.disposed = true;
		if (this.q !== null) this.q.close().catch(() => void 0);
	}
	resetTurnState() {
		this.blockIndex = 0;
		this.textBlock = void 0;
		this.reasoningBlock = void 0;
		this.openTool = void 0;
		this.toolCalls = [];
		this.turnInputChars = 0;
		this.outputChars = 0;
		this.reasoningChars = 0;
		this.toolUseQueue.length = 0;
		this.hostCallByToolUse.clear();
		this.lastUsage = void 0;
	}
	emit(chunk) {
		this.queue?.push({
			kind: "chunk",
			chunk
		});
	}
	usage() {
		const real = this.lastUsage;
		if (real !== void 0 && typeof real.input_tokens === "number" && typeof real.output_tokens === "number" && (real.input_tokens > 0 || real.output_tokens > 0)) {
			const cacheRead = typeof real.cache_read_input_tokens === "number" ? real.cache_read_input_tokens : 0;
			const cacheWrite = typeof real.cache_creation_input_tokens === "number" ? real.cache_creation_input_tokens : 0;
			return {
				inputTokens: Math.max(0, real.input_tokens - cacheRead - cacheWrite),
				outputTokens: real.output_tokens,
				...cacheRead > 0 ? { cacheReadTokens: cacheRead } : {},
				...cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {},
				...this.reasoningChars > 0 ? { reasoningTokens: Math.ceil(this.reasoningChars / 4) } : {}
			};
		}
		if (this.estimatedInputTokens !== void 0 && this.estimatedInputTokens > 0) return {
			inputTokens: this.estimatedInputTokens,
			outputTokens: Math.max(1, Math.ceil((this.outputChars + this.reasoningChars) / 4)),
			...this.reasoningChars > 0 ? { reasoningTokens: Math.ceil(this.reasoningChars / 4) } : {}
		};
		return {
			inputTokens: Math.max(1, Math.ceil(this.turnInputChars / 4)),
			outputTokens: Math.max(1, Math.ceil((this.outputChars + this.reasoningChars) / 4)),
			...this.reasoningChars > 0 ? { reasoningTokens: Math.ceil(this.reasoningChars / 4) } : {}
		};
	}
	/**
	* Record the input-token estimate for the CURRENT request, priced the same
	* way the harness token meter prices the surface: 4 chars per token over
	* the rendered conversation (system + messages) the inner session receives.
	* @param system - the host system prompt included in this request.
	* @param messages - the full host message list included in this request.
	*/
	recordRequestInput(system, messages) {
		const rendered = renderInitialFeed(system, messages);
		const imageTokens = feedImageRefs(rendered).reduce((total, ref) => total + estimateImageTokens(ref.width, ref.height), 0);
		this.estimatedInputTokens = Math.max(1, Math.ceil(feedTextLength(rendered) / 4) + imageTokens);
	}
	endTurn(reason, usage) {
		if (this.queue === null) return;
		if (this.textBlock !== void 0) this.emit({
			type: "block-end",
			index: this.textBlock.index,
			block: {
				type: "text",
				text: this.textBlock.text
			}
		});
		if (this.reasoningBlock !== void 0) this.emit({
			type: "block-end",
			index: this.reasoningBlock.index,
			block: {
				type: "reasoning",
				text: this.reasoningBlock.text
			}
		});
		this.queue.push({
			kind: "turn-end",
			reason,
			usage: usage ?? this.usage()
		});
		this.queue.close();
	}
	async consume(q) {
		try {
			const iterator = q[Symbol.asyncIterator]();
			while (true) {
				const next = await iterator.next();
				if (next.done) break;
				try {
					this.handle(next.value);
				} catch (error) {
					this.endTurn({
						kind: "error",
						failure: {
							message: `qoder session consumer failed: ${String(error)}`,
							code: "BACKEND_ERROR"
						}
					});
				}
			}
			this.endTurn({
				kind: "error",
				failure: {
					message: "qoder session stream ended unexpectedly",
					code: "STREAM_CLOSED"
				}
			});
		} catch (error) {
			this.endTurn({
				kind: "error",
				failure: {
					message: `qoder session died: ${String(error)}`,
					code: "TRANSPORT"
				}
			});
		}
	}
	handle(message) {
		if (message.type === "stream_event") {
			const event = message.event;
			if (event === void 0) return;
			if (event.usage !== void 0) this.lastUsage = event.usage;
			else if (event.message?.usage !== void 0) this.lastUsage = event.message.usage;
			switch (event.type) {
				case "content_block_start": {
					const block = event.content_block;
					if (block?.type === "tool_use") {
						if (this.queue === null || this.queue.isClosed) break;
						const callId = `qoder-${this.callNonce}-${++this.callCounter}`;
						if (typeof block.id === "string" && block.id.length > 0) this.hostCallByToolUse.set(callId, block.id);
						const chunkIndex = this.blockIndex++;
						this.openTool = {
							chunkIndex,
							callId,
							name: hostToolName(block.name ?? ""),
							arguments: block.input !== void 0 && block.input !== null && Object.keys(block.input).length > 0 ? JSON.stringify(block.input) : ""
						};
						this.emit({
							type: "block-start",
							index: chunkIndex,
							blockType: "tool-call"
						});
						this.emit({
							type: "tool-call-delta",
							index: chunkIndex,
							id: ToolCallId(callId),
							name: this.openTool.name,
							argumentsDelta: ""
						});
					}
					break;
				}
				case "content_block_delta": {
					const delta = event.delta;
					if (delta === void 0) return;
					if (delta.type === "text_delta" && typeof delta.text === "string" && delta.text.length > 0) {
						if (this.textBlock === void 0) {
							this.textBlock = {
								index: this.blockIndex++,
								text: ""
							};
							this.emit({
								type: "block-start",
								index: this.textBlock.index,
								blockType: "text"
							});
						}
						this.textBlock.text += delta.text;
						this.outputChars += delta.text.length;
						this.emit({
							type: "text-delta",
							index: this.textBlock.index,
							text: delta.text
						});
					} else if (delta.type === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking.length > 0) {
						if (this.reasoningBlock === void 0) {
							this.reasoningBlock = {
								index: this.blockIndex++,
								text: ""
							};
							this.emit({
								type: "block-start",
								index: this.reasoningBlock.index,
								blockType: "reasoning"
							});
						}
						this.reasoningBlock.text += delta.thinking;
						this.reasoningChars += delta.thinking.length;
						this.emit({
							type: "reasoning-delta",
							index: this.reasoningBlock.index,
							text: delta.thinking
						});
					} else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string" && this.openTool !== void 0) {
						this.openTool.arguments += delta.partial_json;
						this.emit({
							type: "tool-call-delta",
							index: this.openTool.chunkIndex,
							id: ToolCallId(this.openTool.callId),
							argumentsDelta: delta.partial_json
						});
					}
					break;
				}
				case "content_block_stop":
					if (this.openTool !== void 0) {
						this.emit({
							type: "block-end",
							index: this.openTool.chunkIndex,
							block: {
								type: "tool-call",
								id: ToolCallId(this.openTool.callId),
								name: this.openTool.name,
								arguments: this.openTool.arguments
							}
						});
						this.toolCalls.push(this.openTool);
						this.openTool = void 0;
					}
					break;
				case "message_stop": if (this.toolCalls.length > 0) this.endTurn({ kind: "tool-calls" });
			}
			return;
		}
		if (message.type === "assistant") {
			if (message.message?.usage !== void 0) this.lastUsage = message.message.usage;
			if (this.textBlock === void 0 && this.toolCalls.length === 0) {
				const text = (message.message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
				if (text.length > 0) {
					this.textBlock = {
						index: this.blockIndex++,
						text
					};
					this.outputChars += text.length;
					this.emit({
						type: "block-start",
						index: this.textBlock.index,
						blockType: "text"
					});
					this.emit({
						type: "text-delta",
						index: this.textBlock.index,
						text
					});
				}
			}
			return;
		}
		if (message.type === "result") {
			if (message.usage !== void 0) this.lastUsage = message.usage;
			if (this.abortPending) {
				this.endTurn({
					kind: "aborted",
					failure: {
						message: "qoder turn aborted by host",
						code: "ABORTED"
					}
				});
				return;
			}
			if (this.toolCalls.length > 0) {
				this.endTurn({ kind: "tool-calls" });
				return;
			}
			if (message.subtype === "success" || message.subtype === void 0) {
				if (this.textBlock === void 0 && this.reasoningBlock === void 0) this.endTurn({
					kind: "error",
					failure: {
						message: "qoder model returned a completed response with no content",
						code: EMPTY_RESPONSE_CODE
					}
				});
				else this.endTurn({ kind: "stop" });
				return;
			}
			const detail = `${message.subtype} ${safeErrors(message.errors)}`;
			this.endTurn({
				kind: "error",
				failure: {
					message: `qoder turn failed: ${detail}`,
					code: classifyTurnError(detail)
				}
			});
		}
	}
};
/**
* Render tool-result content blocks into the MCP content the inner model
* reads: text passes through, an image resolves from {@link images} into the
* MCP image shape or degrades to the harness's own handle text, and anything
* else is serialized.
*/
function renderResultContent(blocks, images) {
	const content = [];
	for (const block of blocks) if (block.type === "text") content.push({
		type: "text",
		text: block.text
	});
	else if (block.type === "image") {
		const resolved = images?.get(String(block.attachment.attachmentId));
		if (resolved !== void 0) content.push({
			type: "image",
			data: resolved.data,
			mimeType: resolved.mediaType
		});
		else content.push({
			type: "text",
			text: textOnlyImageText(block.attachment)
		});
	} else content.push({
		type: "text",
		text: JSON.stringify(block)
	});
	return content;
}
/**
* Vision tokens for one image, estimated with the tile formula the
* Claude-compatible wire shape this backend follows uses (width x height / 750).
* The inner CLI reports no usage for the pixels it consumed, so this estimate is
* the only image occupancy the harness context meter and compaction threshold
* can see. It is an estimate, not a provider metering figure.
*/
function estimateImageTokens(width, height) {
	if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return 1;
	return Math.max(1, Math.ceil(width * height / 750));
}
/** Literal characters one channel content list contributes to the fallback estimate. */
function contentChars(content) {
	return content.reduce((total, block) => total + (block.type === "text" ? block.text.length : 0), 0);
}
/** Safely stringify the SDK error payload for turn diagnostics. */
function safeErrors(errors) {
	if (errors === void 0) return "";
	if (typeof errors === "string") return errors;
	try {
		return JSON.stringify(errors);
	} catch {
		return String(errors);
	}
}
/**
* Classify an inner result-frame failure into a harness-routable code. The
* qoder backend reports context-window and quota rejections as generic
* per-turn errors, so their message text must be recognized through the shared
* dsh-llm classifiers; only then does the harness overflow recovery (or quota
* surfacing) fire instead of a dead-end BACKEND_TURN_ERROR.
*/
function classifyTurnError(detail) {
	if (isContextWindowExceededError(detail)) return CONTEXT_WINDOW_EXCEEDED_CODE;
	if (isQuotaExceededError(detail)) return QUOTA_EXCEEDED_CODE;
	return "BACKEND_TURN_ERROR";
}
/**
* Warm-session registry with insertion-order LRU eviction, plus the cold
* one-shot path for side-channel requests (titles, compaction).
*/
var QoderSessionManager = class {
	maxSessions;
	runtime;
	sessions = /* @__PURE__ */ new Map();
	/**
	* @param maxSessions - warm-session cap; read per eviction so a settings edit
	*   applies to the next session that overflows the pool.
	* @param runtime - per-session knobs, resolved when each session is created.
	*/
	constructor(maxSessions = 8, runtime = {}) {
		this.maxSessions = maxSessions;
		this.runtime = runtime;
	}
	/** Existing or fresh warm session for one host session id. */
	forSession(sessionId, model) {
		const existing = this.sessions.get(sessionId);
		if (existing !== void 0) {
			this.sessions.delete(sessionId);
			this.sessions.set(sessionId, existing);
			return existing;
		}
		const session = new QoderSession(sessionId, model, this.runtime);
		this.sessions.set(sessionId, session);
		const cap = readLive(this.maxSessions, 8);
		while (this.sessions.size > cap) {
			const oldest = this.sessions.keys().next();
			if (oldest.done === true) break;
			const victim = this.sessions.get(oldest.value);
			this.sessions.delete(oldest.value);
			victim?.close();
		}
		return session;
	}
	/** Drop one session (history diverged); the next request rebuilds it cold. */
	dispose(sessionId) {
		const session = this.sessions.get(sessionId);
		if (session === void 0) return;
		this.sessions.delete(sessionId);
		session.close();
	}
	closeAll() {
		for (const session of this.sessions.values()) session.close();
		this.sessions.clear();
	}
	/** One-shot turn with no warm state: side channels and cold rebuilds. */
	async *coldStream(options, prompt, model) {
		const systemPrompt = readLive(this.runtime.identityOverride, false) === true ? renderIdentityAppend(options.system) : options.system;
		const q = query({
			prompt,
			options: {
				auth: qodercliAuth(),
				tools: [],
				allowedTools: [],
				canUseTool: gateTools,
				settingSources: [],
				maxTurns: readLive(this.runtime.coldMaxTurns, DEFAULT_COLD_MAX_TURNS),
				...systemPrompt === void 0 ? {} : { systemPrompt },
				...model === void 0 ? {} : { model }
			}
		});
		const signal = options.signal;
		const onAbort = () => {
			q.interrupt().catch(() => void 0);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			let text = "";
			let failure;
			try {
				for await (const message of q) {
					const msg = message;
					if (msg.type === "assistant") {
						const chunk = (msg.message?.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
						if (chunk.length > 0) text += chunk;
					} else if (msg.type === "result" && msg.subtype !== "success" && msg.subtype !== void 0) {
						const detail = `${msg.subtype} ${safeErrors(msg.errors)}`;
						failure = {
							message: `qoder side-channel turn failed: ${detail}`,
							code: classifyTurnError(detail)
						};
					}
				}
			} catch (error) {
				if (signal?.aborted !== true) throw error;
			}
			if (signal?.aborted === true) {
				yield {
					type: "finish",
					reason: {
						kind: "aborted",
						failure: {
							message: "aborted by host",
							code: "ABORTED"
						}
					}
				};
				return;
			}
			if (failure !== void 0) {
				yield {
					type: "finish",
					reason: {
						kind: "error",
						failure
					}
				};
				return;
			}
			if (text.length === 0) {
				yield {
					type: "finish",
					reason: {
						kind: "error",
						failure: {
							message: "qoder side-channel returned no content",
							code: EMPTY_RESPONSE_CODE
						}
					}
				};
				return;
			}
			yield {
				type: "block-start",
				index: 0,
				blockType: "text"
			};
			for (let i = 0; i < text.length; i += 192) yield {
				type: "text-delta",
				index: 0,
				text: text.slice(i, i + 192)
			};
			yield {
				type: "block-end",
				index: 0,
				block: {
					type: "text",
					text
				}
			};
			yield {
				type: "usage",
				usage: {
					inputTokens: Math.max(1, Math.ceil(prompt.length / 4)),
					outputTokens: Math.max(1, Math.ceil(text.length / 4))
				}
			};
			yield {
				type: "finish",
				reason: { kind: "stop" }
			};
		} finally {
			signal?.removeEventListener("abort", onAbort);
			await q.close().catch(() => void 0);
		}
	}
};
//#endregion
//#region src/adapter.ts
/**
* `QoderAdapter`: route the harness LLM seam onto a local Qoder CLI account
* through the qoder-agent-sdk. One warm inner session per host session id
* carries the conversation (model turns and tool rounds live inside it); host
* tool schemas are exposed to the inner model through an in-process MCP
* server whose handlers park until the host delivers tool results on the next
* request. Side-channel requests (titles, compaction) run cold one-shots.
* @module dsh-llm-qoder/adapter
*/
/** Shared empty values, so an unset list or map allocates nothing per read. */
const NO_MODELS = [];
const NO_WINDOWS = {};
const NO_ALIASES = {};
/** The primary provider route (the qoder account's built-in models). */
const QODER_PROVIDER = "qoder-cn";
/** Secondary route advertising only the account's custom models. */
const QODER_BYOK_PROVIDER = "qoder-cn-byok";
/**
* Decide the context window to report for one live model.
*
* A per-model override wins when the user chose one; otherwise upstream's own
* `defaultContextWindow` is used, which is the window that model's session
* actually runs with. `maxInputTokens` is NOT a substitute — it is the ceiling
* for a single request and is often lower than the session window (e.g. 180 000
* against a 200 000 session), so falling back to it would understate capacity.
*
* @param live - the live catalog entry, when the CLI answered.
* @param override - the user's chosen window for this model, if any.
* @param fallback - window used when the catalog has nothing for this model.
* @returns the window in tokens.
*/
function pickContextWindow(live, override, fallback) {
	if (override !== void 0 && Number.isFinite(override) && override > 0) return override;
	if (live === void 0) return fallback;
	return live.defaultContextWindow ?? largestWindow(live.availableContextWindows) ?? live.maxInputTokens ?? fallback;
}
/** The largest window in a catalog entry's selectable list, or undefined. */
function largestWindow(available) {
	if (available === void 0 || available.length === 0) return void 0;
	return Math.max(...available);
}
function modelInfo(provider, entry) {
	return {
		provider,
		id: entry.id,
		name: entry.name,
		...entry.description === void 0 ? {} : { description: entry.description },
		inputModalities: entry.isVl === true ? ["text", "image"] : ["text"]
	};
}
/**
* Default selectable reasoning efforts for a Qoder model. The CLI catalog
* reports per-model `efforts`; this is the fallback when a model (or the
* static catalog) discloses none.
*/
const DEFAULT_REASONING_EFFORTS = [
	"low",
	"medium",
	"high",
	"max"
];
/** Human display name for the default effort ids. */
const EFFORT_NAMES = {
	low: "Low",
	medium: "Medium",
	high: "High",
	max: "Max"
};
/**
* Build the `reasoning` metadata block for a resolved model, or undefined
* when the model does not support reasoning.
* @param efforts - CLI-reported effort ids (absent for reasoning-less models).
* @param defaultEffort - CLI-reported default effort id.
* @param isReasoning - whether the model supports reasoning per the CLI.
* @returns the harness reasoning metadata, or undefined to omit it.
*/
function reasoningInfo(efforts, defaultEffort, isReasoning) {
	if (efforts === void 0 && isReasoning === false) return void 0;
	const ids = efforts !== void 0 && efforts.length > 0 ? efforts : DEFAULT_REASONING_EFFORTS;
	return {
		efforts: ids.map((id) => ({
			id: ReasoningEffortId(id),
			name: EFFORT_NAMES[id] ?? id
		})),
		...defaultEffort !== void 0 && ids.includes(defaultEffort) ? { defaultEffort: ReasoningEffortId(defaultEffort) } : {}
	};
}
/**
* The Qoder-backed adapter. Session continuity, tool parking, and feed
* planning live here; chunk synthesis lives in the session's consumer.
*/
var QoderAdapter = class extends LlmAdapter {
	/**
	* The options as given, read where they are used rather than copied here.
	*
	* A `.volatile()` field is a live cell DSH updates in place, and such an edit
	* does not restart the plugin, so a value captured in the constructor would
	* stay frozen for the lifetime of the process (see `src/live.ts`).
	*/
	options;
	sessions;
	catalog;
	readImage;
	/**
	* Memoized `Set` view of the disabled-model list.
	*
	* `updateVolatile` stores the freshly parsed array, so identity changes only
	* when the value does: caching on that identity keeps the per-model lookup a
	* hash probe instead of rebuilding a set per call, with no staleness.
	*/
	disabledCache;
	constructor(options = {}) {
		super();
		this.options = options;
		this.sessions = new QoderSessionManager(options.maxSessions ?? 8, {
			toolResultTimeoutMs: options.toolResultTimeoutMs,
			abortGraceMs: options.abortGraceMs,
			coldMaxTurns: options.coldMaxTurns,
			identityOverride: options.identityOverride
		});
		this.catalog = new QoderModelCatalog(options.modelCacheTtlMs ?? 3e5, options.catalogFetchTimeoutMs ?? 2e4);
		this.readImage = options.readImage;
	}
	get byokRoute() {
		return readLive(this.options.byokRoute, "separate");
	}
	get defaultMaxTokens() {
		return readLive(this.options.defaultMaxTokens, DEFAULT_MAX_TOKENS);
	}
	get modelContextWindows() {
		return readLive(this.options.modelContextWindows, NO_WINDOWS);
	}
	get disabledModels() {
		const source = readLive(this.options.disabledModels, NO_MODELS);
		const cached = this.disabledCache;
		if (cached !== void 0 && cached.source === source) return cached.set;
		const set = new Set(source);
		this.disabledCache = {
			source,
			set
		};
		return set;
	}
	get modelAliases() {
		return readLive(this.options.modelAliases, NO_ALIASES);
	}
	get defaultReasoningEffort() {
		return readLiveOptional(this.options.defaultReasoningEffort);
	}
	get displayName() {
		return readLive(this.options.displayName, "Qoder CN");
	}
	get byokDisplayName() {
		return readLive(this.options.byokDisplayName, "Qoder CN 自定义");
	}
	providerInfo(provider) {
		return {
			id: provider,
			name: provider === "qoder-cn-byok" ? this.byokDisplayName : this.displayName
		};
	}
	/**
	* Whether one catalog entry is enabled for the picker.
	*
	* Only the user's off-switch is consulted: a model the account adds later
	* appears enabled by default, which a stored allow-list could not do.
	*/
	isVisible(id) {
		return !this.disabledModels.has(id);
	}
	/**
	* The user's chosen window for one catalog id, honouring aliases.
	*
	* A window may be stored under either the Qoder id or a harness-side alias,
	* so both spellings are checked before giving up.
	*/
	windowOverride(id) {
		const direct = this.modelContextWindows[id];
		if (direct !== void 0) return direct;
		for (const [key, value] of Object.entries(this.modelContextWindows)) if (resolveQoderModelId(key, this.modelAliases) === id) return value;
	}
	/**
	* The live catalog as the page renders it.
	*
	* Unlike {@link listModels}, this is not filtered by the user's on/off
	* choices: the page must show a switched-off model in order to switch it
	* back on.
	*
	* @returns live catalog entries in upstream order.
	*/
	async describeCatalog() {
		return this.catalog.liveModels();
	}
	/** Whether the user switched one model off. */
	isModelDisabled(id) {
		return this.disabledModels.has(id);
	}
	/** The stored disabled-model set, as a list for rewriting the field. */
	disabledModelIds() {
		return [...this.disabledModels];
	}
	/** The user's window for one model, or undefined when following upstream. */
	contextWindowFor(id) {
		return this.windowOverride(id);
	}
	/** The stored per-model window map, for rewriting the field. */
	modelWindowChoices() {
		return this.modelContextWindows;
	}
	async listModels(provider) {
		const cliModels = await this.catalog.models();
		if (provider === "qoder-cn-byok") return cliModels.filter((entry) => entry.source === "user" || entry.source === "custom").filter((entry) => this.isVisible(entry.id)).map((entry) => modelInfo(provider, entry));
		return cliModels.filter((entry) => this.byokRoute === "inline" || entry.source !== "user" && entry.source !== "custom").filter((entry) => this.isVisible(entry.id)).map((entry) => modelInfo(provider, entry));
	}
	async resolveModel(provider, model, _signal) {
		const target = resolveQoderModelId(model, this.modelAliases);
		const live = (await this.catalog.liveModels()).find((entry) => entry.value === target);
		if (live !== void 0) {
			const reasoning = reasoningInfo(live.efforts, live.defaultEffort ?? this.defaultReasoningEffort, live.isReasoning);
			return {
				provider,
				id: model,
				name: live.displayName.length > 0 ? live.displayName : live.value,
				...live.description.length > 0 ? { description: live.description } : {},
				inputModalities: live.isVl === true ? ["text", "image"] : ["text"],
				context: { contextWindow: pickContextWindow(live, this.windowOverride(target), DEFAULT_CONTEXT_WINDOW) },
				defaultMaxTokens: live.maxOutputTokens ?? this.defaultMaxTokens,
				...reasoning === void 0 ? {} : { reasoning }
			};
		}
		const configured = QODER_MODELS.find((entry) => entry.id === target);
		const reasoning = reasoningInfo(void 0, this.defaultReasoningEffort, true);
		return Promise.resolve({
			...configured === void 0 ? {
				provider,
				id: model,
				name: model,
				inputModalities: ["text"]
			} : {
				...modelInfo(provider, configured),
				id: model
			},
			context: { contextWindow: this.windowOverride(target) ?? 2e5 },
			defaultMaxTokens: this.defaultMaxTokens,
			...reasoning === void 0 ? {} : { reasoning }
		});
	}
	/**
	* Bind one resolution generation to its dispatch, as the seam requires of a
	* dynamic adapter: the live catalog and the CLI login can change between the
	* harness preparing a call and the inner session running it, and a turn must
	* not mix one generation's declared capabilities with another's endpoint.
	*/
	async prepareCall(provider, model, signal) {
		const generation = await this.capture(provider, model, signal);
		return {
			model: generation.info,
			stream: (options) => this.dispatch(options, generation)
		};
	}
	async *stream(options) {
		yield* this.dispatch(options, await this.capture(options.provider, options.model, options.signal));
	}
	/** Resolve the exact route once and derive the capability facts from it. */
	async capture(provider, model, signal) {
		const info = await this.resolveModel(provider, model, signal);
		return {
			info,
			vision: info.inputModalities?.includes("image") === true
		};
	}
	async *dispatch(options, generation) {
		const model = resolveQoderModelId(options.model, this.modelAliases);
		if (options.sessionId === void 0 || options.purpose !== void 0) {
			const prompt = feedToText(renderInitialFeed(options.system, options.messages)) + "\n（这是一次性旁路请求，直接输出下一条助手回复。）";
			yield* this.sessions.coldStream(options, prompt, model);
			return;
		}
		const sessionId = String(options.sessionId);
		const policy = { ...options.reasoningEffort === void 0 ? {} : { reasoningEffort: options.reasoningEffort } };
		let session = this.sessions.forSession(sessionId, model);
		if (session.fedMessages === void 0) {
			yield* this.firstTurn(session, options, model, policy, generation.vision);
			return;
		}
		const tail = options.messages.slice(session.fedMessages.length);
		const images = await this.resolveTurnImages(tail, generation.vision, options.signal);
		session.deliverToolResults(tail, images);
		const plan = planContinuation(session.fedMessages, options.messages);
		if (plan.rebuild) {
			this.sessions.dispose(sessionId);
			session = this.sessions.forSession(sessionId, model);
			yield* this.firstTurn(session, options, model, policy, generation.vision);
			return;
		}
		session.setModel(model, policy);
		session.ensureTools(options.tools ?? []);
		session.recordRequestInput(options.system, options.messages);
		session.fedMessages = options.messages;
		session.fedSystem = options.system;
		yield* session.stream(options, plan.feed === null ? null : await this.buildFeed(plan.feed, generation.vision, images));
	}
	async *firstTurn(session, options, model, policy, vision) {
		session.setModel(model, policy);
		session.setSystem(options.system);
		const cwd = options.cwd;
		session.setCwd(cwd);
		session.ensureTools(options.tools ?? []);
		session.recordRequestInput(options.system, options.messages);
		session.fedMessages = options.messages;
		session.fedSystem = options.system;
		const feed = renderInitialFeed(options.system, options.messages);
		const images = await this.resolveImages(feedImageRefs(feed), vision, options.signal);
		yield* session.stream(options, await this.buildFeed(feed, vision, images));
	}
	/** Image references carried by a message tail, skipping assistant content. */
	async resolveTurnImages(tail, vision, signal) {
		const refs = tail.flatMap((message) => message.role === "assistant" ? [] : imageRefs(message.content));
		return this.resolveImages(refs, vision, signal);
	}
	/** Resolve image references into base64 request bytes; absent reader → none. */
	async resolveImages(refs, vision, signal) {
		const map = /* @__PURE__ */ new Map();
		if (!vision || this.readImage === void 0 || refs.length === 0) return map;
		for (const ref of refs) {
			const key = String(ref.attachmentId);
			if (map.has(key)) continue;
			try {
				const image = await this.readImage(ref, signal);
				if (image !== void 0) map.set(key, {
					data: Buffer.from(image.bytes).toString("base64"),
					mediaType: image.mediaType
				});
			} catch {}
		}
		return map;
	}
	/**
	* Turn a feed into channel content. A text feed passes through; a non-vision
	* feed flattens to the harness's own image handle text; an image the host
	* could not read keeps a note naming what was dropped, so the inner model
	* still knows the attachment was there.
	*/
	async buildFeed(feed, vision, images) {
		if (typeof feed === "string") return feed;
		if (!vision) return feedToText(feed);
		const content = [];
		let pixels = 0;
		for (const part of feed) {
			if (part.type === "text") {
				if (part.text.length > 0) content.push({
					type: "text",
					text: part.text
				});
				continue;
			}
			const resolved = images.get(String(part.attachment.attachmentId));
			if (resolved === void 0) {
				content.push({
					type: "text",
					text: `[图片附件 ${String(part.attachment.attachmentId)} 本次未能读取，请基于文字内容继续]`
				});
				continue;
			}
			pixels += 1;
			content.push({
				type: "image",
				source: {
					type: "base64",
					media_type: resolved.mediaType,
					data: resolved.data
				}
			});
		}
		return pixels === 0 ? content.map((block) => block.type === "text" ? block.text : "").join("\n\n") : content;
	}
	/** Tear down every warm inner session (plugin dispose). */
	close() {
		this.sessions.closeAll();
	}
};
/**
* Decide what to feed on a continuation request. The previous list must be a
* prefix (same length growth, index 0 untouched, at most two in-place
* mutations — the host refreshes runtime-context snapshots in place every
* turn). Tail tool-result messages were already resolved into parked handlers
* and never feed; fresh user turns and mutated messages do.
*/
function planContinuation(previous, current) {
	if (current.length <= previous.length) return {
		feed: null,
		rebuild: true
	};
	const mutated = [];
	for (let i = 0; i < previous.length; i++) if (JSON.stringify(previous[i]) !== JSON.stringify(current[i])) mutated.push(i);
	if (mutated.includes(0) || mutated.length > 2) return {
		feed: null,
		rebuild: true
	};
	const freshUser = current.slice(previous.length).filter((m) => m.role === "user");
	if (freshUser.length === 0 && mutated.length === 0) return {
		feed: null,
		rebuild: false
	};
	const parts = [];
	for (const index of mutated) {
		const message = current[index];
		if (message !== void 0) parts.push(renderRefreshed(message));
	}
	for (const message of freshUser) parts.push(renderUserTurn(message.content));
	const feed = joinFeeds(parts);
	return {
		feed: typeof feed === "string" && feed.length === 0 ? null : feed,
		rebuild: false
	};
}
//#endregion
//#region src/api.ts
/** Route prefix this plugin owns; the client resolves it relative to the page. */
const API_PREFIX = "/api/llm-qoder-cn";
/** Answer one request with JSON. */
function send(res, status, payload) {
	const body = JSON.stringify(payload);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"content-length": Buffer.byteLength(body)
	});
	res.end(body);
}
/**
* Build the model rows: the live catalog joined with the user's choices.
*
* @param adapter - the adapter owning the live catalog and the resolved config.
* @returns one row per model the account exposes, in catalog order.
*/
async function buildRows(adapter) {
	return (await adapter.describeCatalog()).map((entry) => {
		const override = adapter.contextWindowFor(entry.value);
		const upstream = entry.defaultContextWindow ?? (entry.availableContextWindows !== void 0 && entry.availableContextWindows.length > 0 ? Math.max(...entry.availableContextWindows) : entry.maxInputTokens) ?? 2e5;
		const choices = new Set(entry.availableContextWindows ?? []);
		choices.add(upstream);
		if (override !== void 0) choices.add(override);
		const priceFactor = priceFactorOf(entry);
		return {
			id: entry.value,
			name: entry.displayName.length > 0 ? entry.displayName : entry.value,
			...entry.description.length > 0 ? { description: entry.description } : {},
			enabled: !adapter.isModelDisabled(entry.value),
			vision: entry.isVl === true,
			...entry.source === void 0 ? {} : { source: entry.source },
			contextWindow: override ?? upstream,
			contextWindows: [...choices].sort((a, b) => a - b),
			defaultContextWindow: upstream,
			...override === void 0 ? {} : { override },
			...priceFactor === void 0 ? {} : { priceFactor },
			reasoning: entry.isReasoning !== false
		};
	});
}
/**
* Handle one request under {@link API_PREFIX}.
*
* @param req - the incoming request.
* @param res - the response this handler owns.
* @param adapter - the adapter whose live catalog backs the list.
*/
async function handleApi(req, res, adapter) {
	try {
		const path = new URL(req.url ?? "/", "http://localhost").pathname.slice(17) || "/";
		const method = req.method ?? "GET";
		if (path === "/models" && method === "GET") {
			send(res, 200, { models: await buildRows(adapter) });
			return;
		}
		send(res, method === "GET" ? 404 : 405, { error: method === "GET" ? "not found" : "只支持读取" });
	} catch (error) {
		send(res, 500, { error: error instanceof Error ? error.message : String(error) });
	}
}
//#endregion
//#region src/config.ts
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
* @module dsh-qoder-link/config
*/
/** How to treat the account's custom (user-added) models on the main route. */
const BYOK_ROUTES = ["separate", "inline"];
/** Human labels for {@link BYOK_ROUTES}. */
const BYOK_ROUTE_NAMES = {
	separate: "Separate route (qoder-cn-byok)",
	inline: "Merge into the main route"
};
/**
* The configuration schema. This is what DSH turns into the settings page, so
* the defaults and bounds here are user-visible documentation.
*
* ## Why every field is `.volatile()`
*
* DSH's settings service builds its form from `volatileForm(schema)`, which
* keeps a field ONLY when the node (or an ancestor) carries `meta.volatile`;
* an object whose fields are all non-volatile collapses to `undefined` and the
* whole namespace is dropped from `describe()` before any client sees it. A
* plugin with a plain schema therefore registers successfully, streams models
* correctly, and still shows no settings page anywhere — the namespace never
* reaches the wire.
*
* ## What `.volatile()` costs: read every field at use
*
* A volatile-only edit does not restart the plugin. The loader writes the new
* value into the *same* `Volatile` cell the running plugin already holds and
* skips the rest of the update lifecycle, so `apply()` is never called again
* (`Entry.update` → `_commitVolatile` in `cordis-plugin-loader`). Capturing a
* field in `apply()` therefore freezes it for the lifetime of the process, and
* the plugin answers with mount-time values while the settings page and the
* profile patch on disk show the new ones.
*
* That is why the whole plugin consumes its config through {@link liveConfig},
* which returns a thunk per field: the value is unwrapped from its volatile
* reference at every read, so an in-place edit is visible immediately. See
* `src/live.ts` for the full mechanism.
*/
const Config$1 = z$1.object({
	disabledModels: z$1.array(z$1.string()).default([]).description("已关闭的模型 ID 列表（以 Qoder 模型 ID 为准）。关闭的模型不会出现在模型选择器里。").volatile(),
	modelContextWindows: z$1.dict(z$1.number()).default({}).description("按模型指定上下文窗口（token 数）。未指定的模型使用上游声明的窗口。").volatile(),
	byokRoute: z$1.union(BYOK_ROUTES).default("separate").description("账号自定义模型的展示方式：独立分组，或并入主分组。").volatile(),
	displayName: z$1.string().default("Qoder CN").description("模型选择器里主分组的名称。同时使用多个 Qoder 账号时可区分。").volatile(),
	byokDisplayName: z$1.string().default("Qoder CN 自定义").description("自定义模型分组的名称，仅在「独立分组」时使用。").volatile(),
	maxSessions: z$1.number().step(1).min(1).max(64).default(8).description("同时保持的内层会话数上限，超出后按最久未使用关闭。每个会话是一个子进程。").volatile(),
	modelCacheTtlSeconds: z$1.number().step(1).min(10).max(86400).default(300).description("模型列表缓存时长（秒）。调小可更快看到账号侧变化。").volatile(),
	modelAliases: z$1.dict(z$1.string()).default({}).description("额外的模型别名映射：DSH 侧名称 → Qoder 模型 ID。内置 deepseek-v4-* 别名仍然生效。").volatile(),
	defaultReasoningEffort: z$1.string().default("").description("请求未指定思考档位时使用的默认档位；留空则用上游默认。").volatile(),
	identityOverride: z$1.boolean().default(false).description("让内层模型以宿主 Agent 的身份回答，且不透露自己是 Qoder。默认关闭：开启后助手会否认自身来源，请自行决定。").volatile(),
	defaultMaxTokens: z$1.number().step(1).min(1).default(32e3).description("模型未声明输出上限时使用的输出上限。").volatile(),
	toolResultTimeoutSeconds: z$1.number().step(1).min(5).max(3600).default(120).description("内层模型等待宿主返回工具结果的时限（秒），超时则取消该次工具调用。").volatile(),
	catalogFetchTimeoutSeconds: z$1.number().step(1).min(1).max(300).default(20).description("拉取模型列表的时限（秒），超时后回退到内置列表。").volatile(),
	abortGraceSeconds: z$1.number().step(1).min(1).max(120).default(5).description("内层进程确认中断的宽限时间（秒）。").volatile(),
	coldMaxTurns: z$1.number().step(1).min(1).max(32).default(4).description("旁路请求（生成标题、压缩摘要）允许的最大内层轮次。").volatile()
});
/**
* Wrap a parsed config as {@link LiveConfig}.
*
* Every normalizer {@link resolveConfig} applies is applied here too — the live
* wrapper is the same interpretation of the same raw fields, just deferred —
* and `resolveConfig` is implemented on top of it, so the two can never
* disagree about what a given input means.
*
* @param config - the parsed plugin config, possibly partial or absent.
* @returns one thunk per resolved field, each reading the live cell.
*/
function liveConfig(config) {
	const source = config ?? {};
	/**
	* One field's current value.
	*
	* The volatile unwrap happens on every call rather than once, which is the
	* entire point: the reference object outlives an edit, only its contents
	* change.
	*/
	const field = (key) => {
		const value = source[key];
		return isVolatile(value) ? value.get() : value;
	};
	return {
		displayName: () => nonEmpty(field("displayName"), "Qoder CN"),
		byokDisplayName: () => nonEmpty(field("byokDisplayName"), "Qoder CN 自定义"),
		byokRoute: () => field("byokRoute") === "inline" ? "inline" : "separate",
		maxSessions: () => positive(field("maxSessions"), 8),
		modelCacheTtlMs: () => positive(field("modelCacheTtlSeconds"), 300) * 1e3,
		defaultMaxTokens: () => positive(field("defaultMaxTokens"), 32e3),
		toolResultTimeoutMs: () => positive(field("toolResultTimeoutSeconds"), 120) * 1e3,
		catalogFetchTimeoutMs: () => positive(field("catalogFetchTimeoutSeconds"), 20) * 1e3,
		abortGraceMs: () => positive(field("abortGraceSeconds"), 5) * 1e3,
		coldMaxTurns: () => positive(field("coldMaxTurns"), 4),
		disabledModels: () => stringList(field("disabledModels")),
		modelContextWindows: () => numberMap(field("modelContextWindows")),
		modelAliases: () => stringMap(field("modelAliases")),
		identityOverride: () => field("identityOverride") === true,
		defaultReasoningEffort: () => {
			const raw = field("defaultReasoningEffort");
			const effort = typeof raw === "string" ? raw.trim() : "";
			return effort.length > 0 ? effort : void 0;
		}
	};
}
/**
* Apply defaults to a parsed config.
*
* A one-shot snapshot of {@link liveConfig}, for a caller that genuinely wants
* the values as they are right now (a report, a test) rather than a view that
* keeps following edits. The running plugin does not use it: every option it
* hands downstream is a thunk, so a volatile edit is never missed.
*
* @param config - the parsed plugin config, possibly partial.
* @returns the same values with every default filled in.
*/
function resolveConfig(config) {
	const live = liveConfig(config);
	return {
		displayName: live.displayName(),
		byokDisplayName: live.byokDisplayName(),
		byokRoute: live.byokRoute(),
		maxSessions: live.maxSessions(),
		modelCacheTtlMs: live.modelCacheTtlMs(),
		defaultMaxTokens: live.defaultMaxTokens(),
		toolResultTimeoutMs: live.toolResultTimeoutMs(),
		catalogFetchTimeoutMs: live.catalogFetchTimeoutMs(),
		abortGraceMs: live.abortGraceMs(),
		coldMaxTurns: live.coldMaxTurns(),
		disabledModels: live.disabledModels(),
		modelContextWindows: live.modelContextWindows(),
		modelAliases: live.modelAliases(),
		identityOverride: live.identityOverride(),
		defaultReasoningEffort: live.defaultReasoningEffort()
	};
}
function nonEmpty(value, fallback) {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}
function positive(value, fallback) {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
function stringList(value) {
	if (!Array.isArray(value)) return [];
	return value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim());
}
/**
* Keep only the positive, finite entries of a map.
*
* A window of zero or a negative number would be passed straight to the
* harness as a capacity, so invalid entries are dropped here rather than
* rejected — one bad row must not discard the user's other choices.
*/
function numberMap(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const out = {};
	for (const [key, entry] of Object.entries(value)) if (typeof entry === "number" && Number.isFinite(entry) && entry > 0) out[key] = entry;
	return out;
}
function stringMap(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
	const out = {};
	for (const [key, entry] of Object.entries(value)) if (typeof entry === "string" && entry.trim().length > 0) out[key] = entry.trim();
	return out;
}
//#endregion
//#region src/index.ts
/** Cordis plugin name; must match the `id` used by `cordis.patch.yml`. */
const name = "llm-qoder-cn";
/** The LLM registry must exist before an adapter can be registered on it. */
const inject = ["llm"];
/**
* Configuration namespace: the profile entry id this plugin is mounted under.
* The settings service and the configurable-provider directory both address the
* plugin by this key, and the exported {@link ConfigSchema} is the form source,
* so no page has to be registered by hand.
*/
const NS = "llm-qoder-cn";
/** Encoded-byte ceiling for one forwarded request image, before base64 expansion. */
const REQUEST_IMAGE_MAX_BYTES = 1048576;
/**
* Config fields whose value decides a registration shape rather than a runtime
* behaviour, and which therefore cannot be read lazily.
*
* `byokRoute` decides whether the custom-model provider route exists at all;
* the two display names are copied into the picker directory. Everything else
* is read where it is used, so a change to one of these three is the only thing
* that needs a republish.
*/
const STRUCTURAL_FIELDS = /* @__PURE__ */ new Set([
	"byokRoute",
	"displayName",
	"byokDisplayName"
]);
/**
* The provider routes one resolved `byokRoute` implies.
*
* `inline` merges the account's custom models into the primary route instead of
* giving them their own group, so the secondary route only exists for
* `separate`.
*/
function providersFor(byokRoute) {
	return byokRoute === "separate" ? [QODER_PROVIDER, QODER_BYOK_PROVIDER] : [QODER_PROVIDER];
}
/** The configurable-provider directory rows for the current display names. */
function directoryFor(live) {
	return [{
		provider: QODER_PROVIDER,
		displayName: live.displayName(),
		settingsNs: NS,
		settingsPath: []
	}, ...live.byokRoute() === "separate" ? [{
		provider: QODER_BYOK_PROVIDER,
		displayName: live.byokDisplayName(),
		settingsNs: NS,
		settingsPath: []
	}] : []];
}
/**
* The plugin's configuration schema, re-exported under the name the loader
* looks for. DSH reads `runtime.Config` off the plugin fiber to build the
* settings page, so this must stay the exported `Config` binding.
*
* Every field is `.volatile()`, which is what makes the namespace appear in
* `settings.describe()` at all — see the note on {@link ConfigSchema}.
*/
const Config = Config$1;
/**
* Mount the adapter for the lifetime of the plugin.
*
* @param ctx - the plugin's cordis context.
* @param config - parsed plugin config, whose volatile fields arrive as
*   references. {@link liveConfig} wraps them as thunks the adapter reads where
*   it uses them, so an edit applies without this function running again; an
*   empty object is a valid deployment.
*/
function apply(ctx, config) {
	const live = liveConfig(config);
	let attachments;
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
		readImage: (ref, signal) => {
			const store = attachments;
			if (store === void 0) return Promise.resolve(void 0);
			return store.readImageRequest(ref, {
				width: ref.width,
				height: ref.height,
				maxBytes: REQUEST_IMAGE_MAX_BYTES
			}, signal).then((image) => ({
				bytes: image.data,
				mediaType: image.mediaType
			}));
		}
	});
	ctx.inject(["attachments"], (scope) => {
		attachments = scope.attachments;
		scope.effect(() => () => {
			attachments = void 0;
		}, "llm-qoder-cn.attachments");
	});
	const routes = ctx.llm.registerAdapter(providersFor(live.byokRoute()), adapter);
	const directory = ctx.llm.registerConfigurableProviders(directoryFor(live));
	/**
	* Republish the routes and labels after a structural config edit.
	*
	* `byokRoute` decides whether the custom-model route exists at all and the
	* two display names label the picker groups, so none of the three can be
	* fixed at mount time. Everything else the adapter reads per use, which is
	* why this is the only reaction the plugin needs.
	*/
	ctx.on("loader/volatile-update", (paths) => {
		if (!paths.some((path) => STRUCTURAL_FIELDS.has(String(path[0])))) return;
		try {
			routes.replace(providersFor(live.byokRoute()));
			directory.replace(directoryFor(live));
		} catch (error) {
			ctx.logger?.warn(`llm-qoder-cn: 重新发布模型分组失败：${String(error)}`);
		}
	});
	ctx.effect(() => () => adapter.close(), "llm-qoder-cn.sessions");
	ctx.inject(["webServer"], (scope) => {
		const server = scope.webServer;
		if (server === void 0) return;
		scope.effect(() => server.register({
			kind: "prefix",
			path: API_PREFIX,
			handler: (req, res) => {
				handleApi(req, res, adapter);
			}
		}), "llm-qoder-cn: settings api");
		ctx.logger?.info(`llm-qoder-cn: 设置接口已挂载于 ${API_PREFIX}`);
	});
}
//#endregion
export { API_PREFIX, BYOK_ROUTES, BYOK_ROUTE_NAMES, Config, DEFAULT_CONTEXT_WINDOW, DEFAULT_MAX_TOKENS, MODEL_ALIASES, QODER_BYOK_PROVIDER, QODER_MODELS, QODER_PROVIDER, QoderAdapter, QoderModelCatalog, QoderSession, QoderSessionManager, apply, buildRows, handleApi, inject, liveConfig, name, pickContextWindow, priceFactorOf, readLive, readLiveOptional, resolveConfig, resolveQoderModelId };
