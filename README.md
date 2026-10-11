# dsh-qoder-link

把 **Qoder CN 订阅**接入 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）
的 LLM 适配器插件。

- 基于**官方** CN Agent SDK [`@qodercn-ai/qodercn-agent-sdk`](https://www.npmjs.com/package/@qodercn-ai/qodercn-agent-sdk)，
  不逆向协议、不伪造客户端身份。
- **零凭据**：复用本机 `qoderclicn` 登录态，不需要 API key。
- 带独立设置页：模型逐个启用/关闭、逐个指定上下文窗口，改动即时生效。

## 为什么需要它

上游 [`@jiamingzang/dsh-llm-qoder`](https://github.com/JiamingZang/dsh-llm-qodersdk) 只依赖国际版
SDK `@qoder-ai/qoder-agent-sdk`，而那个包的品牌是**编译期硬编码**的：

```js
var xr = "global", zn = xr === "cn"          // ← 永远选不中 CN 分支
v = zn ? { cliCommands: ["qoderclicn"], configDirName: ".qoder-cn" }
       : { cliCommands: ["qodercli"],   configDirName: ".qoder"   }
```

于是只装了 `qoderclicn`、登录态在 `~/.qoder-cn` 的机器上，它永远找不到 CLI，模型选择器里
什么都不出现。本插件改用官方 CN 包（`brand: cn`），从根上解决。

## 安装

前置：本机已安装并登录 Qoder CN CLI（`qoderclicn --version` 可运行）。

点侧边栏的 **插件 → 添加插件**，把 **`dsh-qoder-link`** 填进输入框，然后点「安装」。

也可以换成另外两种来源：

- `github:k1-h2/dsh-qoder-link`（或 `https://github.com/k1-h2/dsh-qoder-link`）——装仓库的最新提交
- 本地目录路径——装你自己改过的版本

**安装源**保持默认即可（中国大陆镜像源），它只决定插件及其 npm 依赖从哪里下载。

SDK 声明了安装脚本（下载它自己的 worker runtime），pnpm 默认不执行，所以界面会弹出
**「需要允许安装脚本」**——点「**允许这些脚本并重试**」就行。授权记在当前 profile 里，只问这
一次；不授权也能用，SDK 会回退到 PATH 上的系统 `qoderclicn`。

装完按界面提示**重启 DSH**（「已安装，下次启动后加载」）。重启后模型选择器出现 `Qoder CN`
分组，设置里出现 **Qoder CN** 一项。

## 设置页

**设置 → Qoder CN**（与「通用设置 / 模型 / 内置插件」并列的独立一项）。整页就是一张模型清单：

```
模型                              启用      上下文窗口
☑  Qwen3.8-Max · x0.5             ▢         [默认 · 200K  ▾]     （200K / 400K / 1M）
☑  Qwen3.8-Flash · 免费           ▢         [默认 · 200K  ▾]
☐  Kimi-K3 · x1.4                 ▢         [默认 · 200K  ▾]
```

- **列表来自账号实时目录**，不是写死的：上游新增的模型自动出现且默认启用。这也是「关闭」用
  拒绝清单而不是允许清单存储的原因——允许清单会把后来新增的模型静默藏掉。
- **倍率取自上游 `priceFactor`**：`0` 显示为「免费」；上游没给倍率的模型不显示后缀，不凭空补数。
- **窗口下拉列出上游为该模型声明的所有可选窗口**，默认档跟随上游声明的会话窗口。
  窗口越大，DSH 的自动压缩触发得越晚。
- 顶部有搜索、只看已启用、刷新列表、全部启用 / 全部关闭，并显示 `已启用 N / 总数`。

**高级设置**（可折叠，默认收起）收纳其余 10 个标量参数：分组名称、并发会话数、列表缓存、默认
思考档位、输出上限、三个超时（工具结果 / 模型列表 / 中断宽限）、旁路轮次、模型别名。每项带中文
说明，改过的项旁边会出现「恢复默认」。

**只服务官方模型。** Qoder CN 也提供「账号自己添加的模型」（自带 API Key 的 BYOK 路线，上游另用
一条 `qoder-byok` 路由承载），但 DSH 这边用不上——插件只走订阅自己的目录，因此只注册一个 provider
路由 `qoder-cn`，并在目录层丢弃上游标记为 `user`/`custom` 的条目。模型选择器里因此只有一个
`Qoder CN` 分组，没有第二个自定义分组。

## 用 YAML 配置

设置页之外，也可以直接在 profile 的 `cordis.patch.yml` 里写：

```yaml
- id: llm-qoder-cn
  name: dsh-qoder-link
  config:
    displayName: Qoder CN (工作号)
    maxSessions: 4
    disabledModels: [mmodel]              # 关闭的模型，不出现在选择器里
    modelContextWindows:
      qmodel_38max: 1000000               # 按模型指定窗口（token）
```

## 常见问题

**缓存命中一直显示 0%？** 上游没有数据，不是映射错误。实测多轮会话逐帧检查，所有用量帧的
`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation_input_tokens`
**全为 0**，`getUsageInfo()` 返回 `null`，`getContextUsage()` 直接超时。本插件能做的是
`usage()` **先读真实用量帧、读不到才回退本地估算**（4 字符/token），这样上游一旦开始上报就会
立刻显示出来。上下文占用用本地估算填报，否则计量环一直显示 0%、自动压缩也永不触发。

**设置点了没反应、一直「保存中」？** v0.6.0 已修。原因是 `.volatile()` 字段的改动**不会重启
插件**，而适配器在挂载时把配置抄进了自己的字段，于是永远按旧值作答——写入成功、磁盘正确、
插件读不到。详见下方「开发须知」。

## 实现要点

- **warm 会话**：每个宿主 session id 对应一个常驻内层 `query()` 子进程，对话延续与工具轮次都
  发生在会话内部，超出 `maxSessions` 按插入序 LRU 淘汰。
- **工具桥接**：宿主工具经进程内 MCP server 暴露给内层模型，qodercli 一次执行一个调用、宿主
  一次回传整轮结果，以 callId 配对；超过 `toolResultTimeoutSeconds` 取消该次调用。
- **旁路请求**：标题生成、压缩摘要走冷启动一次性调用，不占用 warm 会话。
- **溢出可恢复**：内层上下文超限按 `CONTEXT_WINDOW_EXCEEDED` 上报，交给 harness 自动压缩，
  而不是让整轮报废。

## 开发须知

改这个仓库前，有两点 DSH 行为必须先知道，否则会「毫无提示地坏掉」。

**1. 字段不 `.volatile()`，设置页就永远不出现。** DSH 用 `volatileForm(schema)` 构造表单，它
**只保留带 `meta.volatile` 的节点**；字段全是非 volatile 的 object 会塌缩成 `undefined`，
`describe()` 随即 `return []` 丢掉整个命名空间——插件照常加载、模型照常可用，但命名空间
**从未下发到客户端**。此外，DSH 的自动配置页渲染在「内置插件」分区内部，要独立顶层导航项就得
自带 `client.js` 注册 `settings.section`。

**2. `.volatile()` 的值必须在「用的时候」读，不能在挂载时读。** 一次只改 volatile 字段的写入，
loader 会把新值写进运行中插件**已经持有的那个 `Volatile` 引用**，然后**跳过重启**——`apply()`
不会再被调用（`cordis-plugin-loader` 的 `Entry.update` → `_commitVolatile`）：

```js
const pending = volatileOnly && this._commitVolatile() ? [] : changes
if (!pending.length && !force) return          // 不重启，不重新 apply
```

在 `apply()`（或构造函数）里把配置抄进自己的字段，就等于**永久冻结**。本插件的做法：

- [`src/live.ts`](./src/live.ts)：`Live<T>`（值或 thunk）+ `readLive()`，选项既接受普通值，也
  接受读取实时单元格的 thunk。
- [`src/config.ts`](./src/config.ts) 的 `liveConfig()`：每个字段返回 thunk，每次读取才从
  `Volatile` 取值；`resolveConfig()` 在它之上实现，两者语义不会漂移。
- 适配器、会话池、模型目录一律按需读。`updateVolatile()` 只把新值写进**同一个**引用，所以
  thunk 天然看到新值——不用重启，也不丢 warm 会话。
- 只有 `displayName` 会被复制进选择器的分组目录，无法惰性化；插件监听
  `loader/volatile-update`，只在这个字段变化时用 `replace()` 就地重发。

[`test/live.test.ts`](./test/live.test.ts) 精确复现 loader 的就地提交并断言适配器**在不重新
`apply()` 的情况下**跟着变；用 0.5.0 的构建跑同一段代码会失败。

**本插件的读写链路。** 读走插件自建路由 `GET /api/llm-qoder-cn/models`（模型目录来自 CLI，进
不了配置表单）；写走 `ctx.configForms`，与官方「模型」页共用带修订号的写入队列，并发编辑会被
拒绝而不是静默覆盖。宿主**提交完成后**才回应写入，页面因此先按新状态显示、随后核对，核对不
通过才报错；单次写入 20 秒未落定会放弃并解除控件禁用，避免一个卡住的调用锁死整页。

**构建与测试**

```sh
pnpm install     # 首次会下载 qoderclicn worker runtime
pnpm run build   # tsc 出 .d.ts，tsdown 出 lib/index.js
pnpm test        # vitest
```

## 合规与风险

本插件通过官方 Agent SDK 复用**你自己**的 Qoder 账号登录态：不逆向私有协议、不伪造客户端身份
或请求头、不自动化领取签到积分，也不向任何第三方域名发送数据（只与 Qoder 官方服务通信）。

但请自行判断：

1. **「以订阅额度驱动第三方宿主」是否符合你的 Qoder 服务条款，由你自行判断。** 本项目无法替
   Qoder 解释，也不保证账号不被限制。
2. 上游接口与 SDK 随时可能变更，届时本插件可能失效。
3. 请仅用于驱动你自己的账号，勿转售或超出个人合理使用范围。

## 许可

MIT。本仓库是 [JiamingZang/dsh-llm-qodersdk](https://github.com/JiamingZang/dsh-llm-qodersdk)
（MIT）的衍生作品，上游许可原文与版权声明保留在 [`LICENSE.original`](./LICENSE.original)，
出处与改动清单见 [`NOTICE`](./NOTICE)。
