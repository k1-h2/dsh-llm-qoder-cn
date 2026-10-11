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
dsh plugin --profile web add github:k1-h2/dsh-llm-qoder-cn

# 或从 npm 装（发布后）
dsh plugin --profile web add dsh-llm-qoder-cn
```

首次安装需批准 SDK 的 postinstall（它下载 `qoderclicn` worker runtime）。
pnpm 11+ 默认拦截，并在 profile 的 `pnpm-workspace.yaml` 写入占位：

```yaml
allowBuilds:
  '@qodercn-ai/qodercn-agent-sdk': true    # ← 把占位改成 true
```

> ⚠️ **请先写好 `allowBuilds` 再执行 `add`。**
>
> 如果直接 `add` 并在这一步失败，pnpm 已经把依赖装进 `node_modules` 了；此时**重跑
> `add` 会显示 "Already up to date" 并跳过 bundle 注册**，结果是插件装了但**没有生效**
> （`--dump-config` 里看不到它）。这是 pnpm 的幂等行为，不是本插件的缺陷，但很容易踩。
>
> 推荐的顺序：先建好 profile（任一次 `dsh` 调用即可），把上面那行改成 `true`，再 `add`。
>
> **已经踩了怎么办？** 删掉 profile 的 `node_modules/` 与 `pnpm-lock.yaml`，保留
> `pnpm-workspace.yaml` 里的 `allowBuilds`，然后重跑 `add`。

这是 dsh 对任何带 postinstall 依赖的标准 fail-loud 流程。不批准也能用：
SDK 会回退到 PATH 上的系统 `qoderclicn`。

装完**重启 DSH**，模型选择器出现 `Qoder CN` 分组，设置里出现 **Qoder CN** 一项。

## 设置界面

装好后进 **设置 → Qoder CN**（与「通用设置 / 模型 / 内置插件」并列的独立一项）。

页面就是一张**模型清单**：账号下所有模型自动列出，每行一个启用开关 + 一个上下文窗口
下拉，模型名后跟着账号实际计费倍率，全中文。改动即时生效，不用重启。

```
模型                              启用      上下文窗口
☑  Qwen3.8-Max · x0.5             ▢         [默认 · 200K  ▾]
   qmodel_38max                            （200K / 400K / 1M）
☑  Qwen3.8-Flash · 免费           ▢         [默认 · 200K  ▾]
☑  Qwen3.7-Plus · x0.1            ▢         [默认 · 200K  ▾]
☐  Kimi-K3 · x1.4                 ▢         [默认 · 200K  ▾]
```

- **列表来自账号实时目录**，不是写死的：新增的模型自动出现，且默认启用。
  这也是「关闭」用拒绝清单而不是允许清单存储的原因——允许清单会把后来新增的模型静默藏掉。
- **倍率来自上游目录的 `priceFactor` 字段**。`0` 显示为「免费」而不是 `x0`；
  上游没给倍率的模型**不显示后缀**，不会凭空补一个数。
- **上下文窗口下拉列出上游为该模型声明的所有可选窗口**（如 `200K / 400K / 1M`），
  默认档跟随上游声明的会话窗口。
- 顶部有**搜索**、**只看已启用**、**刷新列表**、**全部启用 / 全部关闭**，并显示
  `已启用 N / 总数`。
- 窗口下方有一行提示：窗口越大，DSH 的自动压缩触发得越晚。

### 高级设置

列表下方是可折叠的「高级设置」，收纳其余 13 个标量参数（分组名称、并发会话数、
列表缓存、工具结果等待、模型别名等）。默认收起，不打扰使用者；每个字段仍带中文说明，
被显式改过的字段旁会出现「恢复默认」。

### 这页为什么需要自带 client.js

两个条件缺一个都会**毫无提示地什么都不显示**：

**1. 每个字段必须 `.volatile()`。** DSH 的 settings 服务用 `volatileForm(schema)`
（`dsh-settings/lib/types/schema.js`）构造表单，它**只保留带 `meta.volatile` 的节点**；
字段全是非 volatile 的 object 会塌缩成 `undefined`，`describe()` 随即 `return []`
丢掉整个命名空间——插件照常加载、模型照常可用，但命名空间**从未下发到客户端**。

**2. 必须自带 `client.js` 注册 `settings.section`。** DSH 的自动配置页渲染在
**「内置插件」分区内部**；自带 `settings.section` 才有独立的顶层导航项。

v0.1.x 只满足第 2 条：`client.js` 正确注册了，但 `whileServed` 门控等的是命名空间下发，
而命名空间因 volatile 缺失永远不来。修复见 v0.2.0；本页改为模型清单是 v0.3.0。

### 数据与写入

- **读**：`GET /api/llm-qoder-cn/models`（插件自建的宿主路由）把实时模型目录与你的
  选择合并成上表。模型目录来自 Qoder CLI，无法放进配置表单，所以单独一条只读路由。
- **写**：走 `ctx.configForms`——与官方「模型」页同一个共享设置镜像，`set`/`unset`
  提交带修订号的写入，并发编辑会被拒绝而不是静默覆盖。写完再读一次列表，保证显示的是
  适配器**实际解析出的状态**，而不是点击时的期望。

### 关于「缓存命中 0%」

DSH 的 token 计量把命中率算自 `usage.cacheReadTokens`，而 **Qoder CN CLI 在这条链路上
从不发送真实用量**。实测（多轮会话，逐帧检查）所有用量帧的
`input_tokens`、`output_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens`
**全部为 0**；SDK 的 `getUsageInfo()` 返回 `null`，`getContextUsage()` 直接超时。

所以 0% 是**上游没有数据**，不是本插件映射错误——没有任何客户端改动能显示出 provider
从未发送的数字。本插件能做的两件事都做了：

1. **`usage()` 先读真实用量帧，读不到才回退到本地估算**（按 harness 口径 4 字符/token）。
   这样将来上游开始上报（含缓存字段）就会立刻显示出来，而不会被估算掩盖。
2. 上下文占用用**本地估算**填报，否则计量环会一直显示约 0%，自动压缩也永不触发。

CLI 唯一真实上报的每请求数字是 `context_usage_ratio`（实测随输入长度增长，如
30 字符→0.0149、22K 字符→0.0309），但它是「占窗口的比例」而非缓存统计，本插件目前
未用它替换估算——它的分母是上游会话窗口，与 DSH 侧的窗口口径未必一致。

## 用 cordis.patch.yml 配置

设置页之外，也可以在 profile 的 `cordis.patch.yml` 里直接写：

```yaml
- id: llm-qoder-cn
  name: dsh-llm-qoder-cn
  config:
    displayName: Qoder CN (工作号)
    maxSessions: 4
    # 关闭的模型（不会出现在模型选择器里）
    disabledModels: [mmodel]
    # 按模型指定上下文窗口（token 数）
    modelContextWindows:
      qmodel_38max: 1000000
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
