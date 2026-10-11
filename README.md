# dsh-llm-qoder-cn

把 **Qoder CN 订阅**接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）
的 LLM 适配器插件，基于**官方** CN Agent SDK
[`@qodercn-ai/qodercn-agent-sdk`](https://www.npmjs.com/package/@qodercn-ai/qodercn-agent-sdk)。

它复用本机 `qoderclicn` 的登录态——**不需要 API key**——并把会话池、上下文窗口、
超时、模型过滤等全部开放为可在 DSH 设置页里直接修改的配置项。

## 为什么有这个东西

上游 [`@jiamingzang/dsh-llm-qoder`](https://github.com/JiamingZang/dsh-llm-qodersdk) 只依赖
国际版 SDK（`@qoder-ai/qoder-agent-sdk`），而那个包的品牌是**编译期硬编码**的：

```js
var xr = "global", zn = xr === "cn"          // ← 永远选不中 CN 分支
v = zn ? { cliCommands: ["qoderclicn", "qodercn"], configDirName: ".qoder-cn", ... }
       : { cliCommands: ["qodercli", "qoder"],     configDirName: ".qoder",     ... }
```

于是只装了 `qoderclicn`、登录态在 `~/.qoder-cn` 的机器上，它永远找不到 CLI，
模型选择器里什么都不出现。本插件改用官方 CN 包（`brand: cn`），从根上解决这个问题。

## 安装

前置：本机已安装并登录 Qoder CN CLI（`qoderclicn --version` 可运行）。

```sh
# 从 GitHub 装
dsh plugin --profile web add github:<your-name>/dsh-llm-qoder-cn

# 或从 npm 装（发布后）
dsh plugin --profile web add dsh-llm-qoder-cn
```

首次安装需批准 SDK 的 postinstall（它下载 `qoderclicn` worker runtime）。
pnpm 11+ 默认拦截并在 profile 的 `pnpm-workspace.yaml` 写入占位：

```yaml
allowBuilds:
  '@qodercn-ai/qodercn-agent-sdk': true    # ← 把占位改成 true
```

改完重跑 `add` 即可。这是 dsh 对任何带 postinstall 依赖的标准 fail-loud 流程。
不批准也能用：SDK 会回退到 PATH 上的系统 `qoderclicn`。

装完**重启 DSH**，模型选择器出现 `Qoder CN` 分组。

## 设置界面

装好后进 **设置 → Qoder CN**（与「通用设置 / 模型 / 内置插件」并列的独立一项）。

本插件自带 `client.js`，通过 `settings.section` slot 注册这一页——这是必需的，因为
DSH 虽然能从插件导出的 `Config` schema 自动生成配置页，但那个自动页渲染在**「内置插件」**
分区内部。若客户端 bundle 没有装载该分区，schema 注册了、设置服务也读得到，
但**既没有导航项也没有页面**。自带 `settings.section` 就绕开了这个依赖。

页面仍由宿主上报的 schema 驱动，所以表单不可能与 `src/config.ts` 的声明脱节。
读写走 `ctx.configForms`（与官方「模型」页同一个共享设置镜像）：
`get(ns)` 取表单，`subscribe` 推送快照，`set`/`unset` 提交带修订号的写入。
字段被用户层显式覆盖时会出现「恢复默认」。

### 身份

| 字段 | 默认 | 说明 |
|---|---|---|
| `displayName` | `Qoder CN` | 模型选择器里主分组名 |
| `byokDisplayName` | `Qoder CN 自定义` | 自定义模型分组名 |
| `byokRoute` | `separate` | 自定义模型独立成组，或 `inline` 并入主组 |

### 会话容量

| 字段 | 默认 | 说明 |
|---|---|---|
| `maxSessions` | `8` | 同时保持 warm 的内层 CLI 会话数；超出按 LRU 关闭。多开会话切换慢就调大，内存紧张就调小（每个 warm 会话是一个子进程） |
| `modelCacheTtlSeconds` | `300` | 模型目录缓存时长。调小能更快看到账号变化（新自定义模型、配额导致的模型停用） |

### 上下文窗口

| 字段 | 默认 | 说明 |
|---|---|---|
| `contextWindowMode` | `auto` | 见下 |
| `contextWindowOverride` | `200000` | 仅 `custom` 模式使用 |
| `compactionThresholdHint` | `0.8` | 仅启动日志提示，harness 掌握真实阈值 |
| `defaultMaxTokens` | `32000` | 模型未声明输出上限时的兜底 |

**`contextWindowMode` 的四个取值**，以及为什么默认不是 1M：

上游目录对每个模型同时报三个不同的数，混用是经典错误：

```
maxInputTokens: 180000                    ← 单次请求上限
defaultContextWindow: 200000              ← 会话实际使用的窗口
availableContextWindows: [200000, 400000, 1000000]   ← 可切换的窗口列表
```

| 模式 | 结果 | 何时用 |
|---|---|---|
| `auto` | 上游默认窗口（200K） | **默认**。与 provider 真实接受量对齐 |
| `default` | 同上，但语义固定 | 想锁死"跟随上游默认"而不受将来 `auto` 语义变化影响 |
| `max` | 最大可用窗口（1M） | 你确实需要 1M，并接受压缩变晚 |
| `custom` | `contextWindowOverride` | 指定固定值 |

**为什么 `auto` 不直接用 1M**：harness 用 `contextWindow` 当作自动压缩阈值的分母
（`阈值 = ratio × contextWindow`）。填 1M 会把阈值推到 800K，压缩永远不会在 provider
拒绝之前触发，长会话反而**更容易直接失败**。选 `max` 时建议同时把部署里
`dsh-compaction-basic` 的 `thresholdRatio` 调低（如 0.6）来补偿。

### 超时

| 字段 | 默认 | 说明 |
|---|---|---|
| `toolResultTimeoutSeconds` | `120` | 内层模型等待宿主返回工具结果的时限，超时取消该次工具调用 |
| `catalogFetchTimeoutSeconds` | `20` | 拉取模型目录的时限，超时回退静态列表 |
| `abortGraceSeconds` | `5` | 内层进程确认中断的宽限 |
| `coldMaxTurns` | `4` | 旁路请求（标题、压缩摘要）允许的内层轮次 |

### 模型

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabledModels` | `[]` | 允许清单；为空表示全部展示。**可用别名书写** |
| `disabledModels` | `[]` | 拒绝清单，在允许清单之后生效 |
| `modelAliases` | `{}` | 自定义 别名 → Qoder 模型 id 映射，覆盖内置的 `deepseek-v4-*` |

别名在允许清单里同样生效：写 `deepseek-v4-pro` 能命中目录里的 `dmodel`。

### 行为

| 字段 | 默认 | 说明 |
|---|---|---|
| `identityOverride` | `false` | 见下 |
| `defaultReasoningEffort` | `''` | 请求未指定思考档位时的默认值；空表示用上游默认 |

**关于 `identityOverride`**：打开后会给内层系统提示前置一段身份说明，要求模型以宿主
agent 的身份作答、不要自称 Qoder。**本插件默认关闭**，因为这会指示模型否认自身来源，
属于应当显式选择的产品决策。上游有一份等价的 `renderIdentityAppend`，但全仓库无调用点、
构建产物中也不存在（被 tree-shaking 移除）——即上游从未真正生效过；本插件把它接上了。

## 用 cordis.patch.yml 配置

设置页之外，也可以在 profile 的 `cordis.patch.yml` 里直接写：

```yaml
- id: llm-qoder-cn
  name: dsh-llm-qoder-cn
  config:
    displayName: Qoder CN (工作号)
    contextWindowMode: max
    maxSessions: 4
    disabledModels: [mmodel]
    enabledModels: []
```

## 实现要点

- **零凭据**：`qodercliAuth()` 复用本机登录态，插件不落任何密钥。
- **warm 会话**：每个宿主 session id 对应一个常驻内层 `query()` 子进程，对话延续与
  工具轮次都发生在会话内部，超出 `maxSessions` 按插入序 LRU 淘汰。
- **工具桥接**：宿主工具通过进程内 MCP server 暴露给内层模型，qodercli 一次执行一个
  调用、宿主一次回传整轮结果，二者以 callId 配对；超时按 `toolResultTimeoutSeconds` 取消。
- **旁路请求**：标题生成、压缩摘要走冷启动一次性调用，不占用 warm 会话。
- **溢出可恢复**：内层上下文超限时按 `CONTEXT_WINDOW_EXCEEDED` 上报，
  harness 的自动压缩可接管而不是让轮次报废。
- **不逆向协议**：全部走官方 SDK，无自建签名、无伪造客户端身份、无自动签到。

## 合规与风险

本插件通过官方 Agent SDK 复用你自己的 Qoder 账号登录态：

- **不**逆向私有协议、**不**伪造客户端身份或请求头、**不**自动化领取签到积分；
- 不向任何第三方域名发送数据（仅与 Qoder 官方服务通信）。

但请注意：

1. **"以订阅额度驱动第三方宿主"是否符合你的 Qoder 服务条款，需你自行判断。**
   本项目无法替 Qoder 作解释，也不保证账号不被限制。
2. 上游接口与 SDK 随时可能变更，届时本插件可能失效。
3. 请仅用于驱动**你自己的**账号，勿用于转售或超出个人合理使用的场景。

## 开发

```sh
pnpm install     # 首次会下载 qoderclicn worker runtime
pnpm run build   # tsc 出 .d.ts，tsdown 出 lib/index.js
pnpm test        # vitest
```

## 许可

MIT。本仓库是 [JiamingZang/dsh-llm-qodersdk](https://github.com/JiamingZang/dsh-llm-qodersdk)
（MIT）的衍生作品，上游版权声明与许可原文保留在 [`LICENSE.original`](./LICENSE.original)，
出处与改动清单见 [`NOTICE`](./NOTICE)。
