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

### 第一步：装插件

点侧边栏的 **插件 → 添加插件**，把 **`dsh-qoder-link`** 填进输入框，然后点「安装」。

也可以换成另外两种来源：

- `github:k1-h2/dsh-qoder-link`（或 `https://github.com/k1-h2/dsh-qoder-link`）——装仓库的最新提交
- 本地目录路径——装你自己改过的版本

**安装源**保持默认即可（中国大陆镜像源），它只决定插件及其 npm 依赖从哪里下载。

SDK 声明了安装脚本（下载它自己的 worker runtime），pnpm 默认不执行，所以界面会弹出
**「需要允许安装脚本」**——点「**允许这些脚本并重试**」就行。授权记在当前 profile 里，只问这
一次；不授权也能用，SDK 会回退到 PATH 上的系统 `qoderclicn`。

装完按界面提示**重启 DSH**（「已安装，下次启动后加载」）。重启后设置里出现 **Qoder CN** 一项。

### 第二步：装好并登录 Qoder CN CLI

插件不持有任何凭据，内层会话直接复用本机 CLI 的登录态（SDK 的 `qodercliAuth()`），所以 CLI
必须装好、登录，模型列表才有内容。

**设置 → Qoder CN**，页面底部「Qoder CN CLI」分组点 **一键配置**：跑的就是随包发布的
[`scripts/setup-qoderclicn.bat`](./scripts/setup-qoderclicn.bat)——缺 CLI 就装，未登录就拉起浏览器
授权，输出实时打在页面上；跑完 1 秒自动收起，点「查看输出」可以再翻出来，同时模型列表自动刷新。
**重新登录**只重跑授权那一步，用来换账号或补一次过期的登录。这一步只支持 Windows，因为脚本是
`.bat`；脚本自己的输出是英文——批处理里放中文时，`cmd.exe` 在没有控制台被调用（正是页面这种调用
方式）会算错文件位置，把半行当命令跑，详见 `NOTICE`。

不想点按钮，就自己按顺序执行——那个脚本做的正是这几步：

```bash
npm install -g @qodercn-ai/qoderclicn   # CLI 本体，官网 https://qoder.com/cli
qoderclicn --version                    # 能打印版本号才算装上
qoderclicn login                        # 拉起浏览器，用 Qoder CN 账号登录
qoderclicn status                       # 列出 Username / User Type 即登录成功
qoderclicn --list-models                # 列出订阅实际可用的模型
```

- 也可以直接双击 `scripts/setup-qoderclicn.bat`：一次做完上面全部，结尾停住等你看输出。
- `login` 没有非交互参数，走浏览器授权；成功后凭证落在 `~/.qoder-cn/.auth`（国际版是 `.qoder`，
  本插件只认 CN 这一份）。
- 登录过期或换账号：页面上点「重新登录」，或者自己重跑一次 `qoderclicn login` 覆盖旧凭证。
- CLI 自带升级：`qoderclicn update`，装坏了用 `qoderclicn rollback`。
- `status` 里没有 `Username`、或 `--list-models` 拉不出模型，DSH 里的模型列表就一定为空——
  先修这一步，再查插件。

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

**Qoder CN CLI** 分组在页面底部，管第二步那件事：「一键配置」「重新登录」两个按钮，加一块只在跑
的时候展开的输出区域——结束后 1 秒自动收起，「查看输出」可以随时再展开。模型列表拉不出来时，页面
直接红字说明是本机 CLI 没配置好，并把「一键配置」放在那句提示旁边。浏览器起不了本地进程，所以按钮
走的是宿主侧的 `POST /api/llm-qoder-cn/setup`（`mode` 只有 `configure` 和 `login` 两个取值），由
插件去跑随包发布的脚本。

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

**缓存命中一直显示 0%？** v1.0.5 已修。根因不在映射：CLI 每轮都算出了真实用量，但在把用量帧
送出来之前会**主动清零四个 token 计数**（`input_tokens` / `output_tokens` /
`cache_read_input_tokens` / `cache_creation_input_tokens`），只留 `credits` 与
`context_usage_ratio`；它自带一个开关（env 目录里的 `EXPOSE_TOKEN_USAGE`），打开后才原样送出。
[`src/cli.ts`](./src/cli.ts) 现在把这个开关随子进程环境一起交给 CLI——CN 包读
`QODERCN_EXPOSE_TOKEN_USAGE`，国际包读 `QODER_EXPOSE_TOKEN_USAGE`，两个都设，因为由哪个包应答
是查找决定的。

实测（本插件跑通，同一段前缀连续两轮）：

| 轮 | CLI 报的 `input_tokens` | 其中 `cache_read` | 插件上报 | 界面 |
|---|---|---|---|---|
| 1 | 9 811 | 0 | 输入 9 811 / 输出 860 / 缓存 0 | 命中 0% |
| 2 | 10 686 | 9 805 | 输入 881 / 缓存读 9 805 / 输出 100 | 命中 92% |

第二轮那个 `input_tokens` 是**整个 prompt**（CLI 自己的 `context_usage_ratio` 就是
`input_tokens ÷ 窗口`），缓存的那部分含在里面，所以 [`meteredUsage()`](./src/session.ts) 把两个
cache 桶从 `inputTokens` 里减出去——DSH 的四个桶互不重叠，不减等于把缓存前缀算两遍。四个桶（含 0）
与 `totalTokens` 也必须齐全：harness 只在记账完整时展示每轮用量行，少一个桶又没有 `totalTokens`
佐证，整轮的用量详情都不显示。

**哪个用量帧能信？** CLI 会把用量记录挂在**好几个**帧上，
而只有一个是真的属于「这一次请求」：`message_delta`，即每次 provider 请求结束时发出的那一帧。
其余三个都是坑——`message_start` 与组装后的 `assistant` 消息里的四个计数**恒为 0**（请求没结束前
没有数）；`result` 帧则是**内层整轮的总和**，把这个回合里每一次 provider 请求的用量全部相加。

一个宿主 step 只对应一次 provider 请求，但内层的一"轮"要等模型不再调用工具才结束——宿主工具每往返
一次就是一次新请求，全部发生在同一个内层回合里。所以 `result` 帧的数在长 agentic 运行后会是真实
prompt 的若干倍：实测一个让模型连调四次工具的回合，各请求分别用 608/705/771/837，`result` 帧报
**2 921**。若把这个数当成当前上下文，长跑结束后 DSH 的上下文计量会被顶到
`~9.8M / 1M`（100%）并一直挂着，直到下一次取样才回正（开发中确实这么踩过一次）。

现在占用样本只由 [`requestUsageSample()`](./src/session.ts) 提供：仅接受带真实计数（至少一个桶 > 0）
的 `stream_event` 帧，`assistant` 与 `result` 帧一律不采信。`contextUsageRatio` 仍是每请求的
prompt 比率，所以回退路径不受影响。

仍然退回估算的只有三种情况：CLI 版本早于这个开关、SDK 回退到进程内 worker transport（拿不到自定义
环境）、某一轮在结果帧之前就结束了。那时 `usage()` 按「真实用量帧 → CLI 的 context 比率 → 字符
估算」三级回退，上游一旦有数就立刻切过去。

**上下文占用是按什么算的？** 拿到真实计量时就是 provider 自己数的**最后一次请求**的 prompt：
`inputTokens + cacheRead + cacheWrite`，除以窗口。拿不到时，上游每帧仍带 `context_usage_ratio`
——它自己量出的「上下文用了多少」——本插件把它乘上窗口换成 token，再交给 DSH 的计量环。

这条回退路径上有个坑（v1.0.1 踩过、v1.0.2 修）：**这个比率的分母是 CLI 实际运行的窗口，
不是你配置的窗口**。
CLI 只接受模型自己声明的窗口（见目录里的 `availableContextWindows`），配一个它不支持的窗口会被
**静默忽略**——例如给只支持 200K 的 `auto` 配 1M，CLI 仍按 200K 跑，若拿 1M 去乘就虚高 5 倍。
所以插件现在分两个窗口：给 DSH 的是你配置的值，给比率做分母的是 `cliContextWindow()`
（模型声明里匹配得上就用你的，匹配不上就用模型自己的）。同时窗口会经
`resolveModel.parameters.contextWindow` 真正下发给 CLI——在此之前它只告诉了 DSH，CLI 一直按默认
200K 跑，配了 1M 也白配。

比率本身是**可信的**：实测在 257/1007/2257 字符三档下，`比率 × 窗口` 与 CLI 自报的
`getContextUsage().usedPercentage` 在量化误差内一致，且随内容线性增长。注意 DSH 环上的总数
（`inputTokens + cacheRead + cacheWrite`）**包含 qodercli 自身的开销**——它自己的系统提示、skills
与工具定义，约 120–200 token。环里「系统提示词 / 工具定义 / 对话消息」三项是 DSH 自己按
`4 字符/token` 估的**本地分类**，合计会低于总数，这是正常的，不是虚高。

**tok/s 为什么偏低？** DSH 算 `tok/s = 输出 token ÷ 解码耗时`，而输出 token 由本插件上报。
v1.0.5 起这个数是 provider 自己数的 `output_tokens`（同一个计量开关），所以下面的估算修正只在拿不到
计量时生效——**凡是模型生成的内容都必须计入**，估算那一侧曾是两个原因，v1.0.3 与 v1.0.4 各修一个：

1. **换算率**（v1.0.3）。实测本后端的分词器：**中文 1.77 字符/token、英文 5.20 字符/token**，
   而原先统一按 `4 字符/token` 估，中文因此被低估 **2.26 倍**。现在按字符集分别计价。
2. **工具调用参数**（v1.0.4）。原先只统计正文与思考，**工具调用的 name/arguments 一个字符都没算**，
   而 agentic 回合里输出的大头正是它——实测一个三次工具调用的回合中占 **86%** 的字符。DSH 自己的
   计量器是把工具调用计价为 `name + arguments` 的（`dsh-token-meter` 的 `estimateContent`），
   漏掉它会让多步任务的 tok/s 低到十分之一量级。

实测效果：同一段中文回复 20.9 → 45.8 tok/s；一个工具调用回合 72.5 → 311.2 tok/s。
计数逻辑在 `src/tokens.ts` 的 `TurnOutputAccounting`，由 14 个单元测试钉住，其中一条专门断言
「工具参数必须计入」。

**设置点了没反应、一直「保存中」？** v0.6.0 已修。原因是 `.volatile()` 字段的改动**不会重启
插件**，而适配器在挂载时把配置抄进了自己的字段，于是永远按旧值作答——写入成功、磁盘正确、
插件读不到。详见下方「开发须知」。

## 实现要点

- **warm 会话**：每个宿主 session id 对应一个常驻内层 `query()` 子进程，对话延续与工具轮次都
  发生在会话内部，超出 `maxSessions` 按插入序 LRU 淘汰。
- **工具桥接**：宿主工具经进程内 MCP server 暴露给内层模型，qodercli 一次执行一个调用、宿主
  一次回传整轮结果，以 callId 配对；超过 `toolResultTimeoutSeconds` 取消该次调用。
- **旁路请求**：标题生成、压缩摘要走冷启动一次性调用，不占用 warm 会话。
- **真实计量**：CLI 默认把用量帧里的 token 计数清零，插件在启动子进程时带上它的
  `EXPOSE_TOKEN_USAGE` 开关；总量、缓存命中与 tok/s 因此都是 provider 实测值，只有拿不到计量时才
  按「context 比率 → 字符估算」兜底。占用样本只取自**每次请求结束**的那一帧（`requestUsageSample()`
  ，见「哪个用量帧能信？」），内层整轮的合计值不参与上下文计算。
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
pnpm install          # 首次会下载 qoderclicn worker runtime
pnpm run build:clean   # 清掉 lib/ 再构建；tsc 出 .d.ts，tsdown 出 lib/index.js
pnpm test              # vitest
```

**别用 `pnpm build` 验证改动。** 它的命令是 `tsc && tsdown`：类型一错，`&&` 就短路，`tsdown`
根本不跑，于是 `lib/index.js` **保持旧内容**——而 `lib/` 才是 DSH 真正加载、npm 真正发布的东西。
如果只盯着源码或只跑测试，会误以为改动已生效。发布路径上的 `prepublishOnly` 用的是
`build:clean`（先删 `lib/` 再构建），所以类型错误会让发布失败而不是发出陈旧包。

注意 **`pnpm build` 与 `pnpm run build` 在 PowerShell 里可能给出不同的退出码**（前者经
`pnpm` 的内置脚本别名，后者经 `run`）。判断构建是否成功请直接看 `lib/index.js` 的时间戳，
或跑 `build:clean`——不要只信退出码。

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
