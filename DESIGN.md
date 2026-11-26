# AutoRouter：DSH 单入口多订阅路由插件（设计 v0.1）

> 目标：DSH 的模型选择器里只出现一个 provider `autorouter`（显示名 **AutoRouter**）。所有请求按一条可配置的回退链，在已登记的 provider/model 之间做**额度感知**的选择与轮换；思考强度（reasoning effort）随请求继承到实际执行的路由；全部设置通过 **设置 → AutoRouter** 页面完成，不要求用户编辑 YAML。

状态：已实现（v0.4.0，2026-11-27）。

**实现与初稿的差异以本节为准：**

- 取消 `tier` / `weight` / `costHint` / `qualityHint` 与 balanced/efficiency/quality 轮换；
  链数组的顺序就是尝试顺序，第一条可用路由获胜。
- 新增 `policy.timeWindows`：按本地时间（默认 UTC+8）命中窗口时，`order` 就是该时段的
  完整回退链——列出的路由按它排前面，未列出的保持配置顺序排最后兜底，因此只换顺序、
  从不清空候选。新建时段默认复制当前链，再在时段标签页里独立排序。
- 一个时段可以覆盖多个不连续的时间段：窗口带 `ranges: [{ from, to }, …]`，命中任意一段
  即命中，共用同一条回退链；旧配置的单个 `{ from, to }` 在归一化时折算成一段，无需迁移。
- 保存的应答与随后的读回都以“刚写进去的那份配置”为准，不重新投影：`settings.describe()` 读的是
  loader 快照，可能比 `settings.replace()` 晚一个 tick，重新投影会把保存前的文档回给页面，
  表现就是“点了保存又弹回去”。`getConfig()` 在写入后 10 秒内直接返回写入值，文档更新事件到达即失效。
- 取消请求额度：`maxRequestsPerWindow` / `maxTokensPerWindow` / `windowMs`、状态里的
  `budget` 字段与 §5.5 的额度账本全部移除。本地账本只能猜上游配额，却会静默拦掉请求；
  真正的配额信号是上游的 429，冷却与失败计数才是本插件该记的东西。
- 实际 `Entry` 字段：`{ id, provider, model, enabled, cooldownMs, effortMap }`；
  `Profile` 字段：`{ id, name, enabled, description, chain, policy }`。页面不再暴露档位级
  `enabled` 开关：档位存在就参与路由，唯一的开关是每条路由前的勾选；手写 `enabled: false`
  仍生效，卡片头以「已停用」标出。
- 虚拟模型元数据按宿主校验器收口：`reasoning.efforts` 为空视为“上游没声明”，不下发空列表；
  `contextWindow` / `defaultMaxTokens` 取整且至少为 1。
- 继承的思考强度遇到「已知不声明思考」的目标（`resolveModelInfo` 返回 `reasoning: undefined`）
  直接丢弃，而不是先发出去再靠 `UNSUPPORTED_REASONING_EFFORT` 修一次——否则链尾的
  `deepseek-account/deepseek-flash` 会在最需要回退时整通失败。
- `/api/autorouter/try` 以 `finish.reason.kind` 判成功（宿主把终态报成 `{ kind, failure }`，
  旧的字符串比较会把失败读成成功）。
- 设置页「试一次」按钮与状态卡里的 `host vX.Y.Z` 版本行用于重启后自检：版本号与页面
  期望不一致就说明宿主仍在跑旧代码。
- 设置页卡片可收起/展开（点卡片头任意空白也算），折叠状态存 `localStorage`（`dsh-autorouter:collapsed`）。
- 时间段与策略不再放在独立 tab：每个档位一张卡片，标识 / 链 / 时间段 / 策略都在卡片内，
  随卡片收起，不再有"先选中某个档位"的概念（`selected` 状态已删除）。
- 设置页只有三个 tab：路由链、实时状态、JSON。实时状态单独成 tab，避免编辑链时被
  每 2 秒刷新的表打扰。
- 卡片内部由三个 `Section`（带分隔线的标题块）组成：路由链、时间段、策略，全部直接可见；
  时间段不再是 `<details>`（收起的详情看起来像"没有界面"），策略默认展开、可单独收起。
  时段顺序不再用勾选标签表达，而是"跟着回退顺序走"：路由链顶部一排时段按钮
  （`默认顺序` + 每个时段），切到某个时段后上下箭头改的就是那个时段自己的链。
- 保存按钮随时可点（不必先产生改动），写成功即刷新页面上的配置与 revision；
  "重新载入"改为"撤销"，是保存的本地逆操作（不重新请求服务器）。
- 提交后的失败也记账：半截回答不会被重放（调用方已经看到内容），但路由进入冷却、会话解除
  钉住，下一步换个起点——否则中途失联的供应商会一直排在最前面，每一步都先失败一次。
- 新增 `policy.attemptIdleMs`（默认 0，关闭）：尝试静默超过该值就由子 `AbortController` 中止，
  按 `NETWORK` 处理；未产出内容则换下一条，已产出内容则报错并记账。宿主的 abort 只转发、
  不归咎于路由，因为那是调用方的决定。
- 新增 `test/client-render.test.js`：用 React double 在纯 Node 下渲染三个 tab，
  `useState` 顺序表一旦错位即失败。
- 下文 §6/§7 的 `tier/weight/limits` 与 §5.5 保留为设计演进记录，不再代表实现。

---

## 1. 目标与非目标

### 1.1 目标

1. **单入口**：`autorouter` 一个 provider，模型选择器里是一个或多个虚拟模型（默认 `auto`），不再需要用户在多个订阅之间手动切换。
2. **结构化回退**：一条有序链，按 tier 分层；失败、冷却、额度耗尽时自动前进；会话内尽量粘住同一条路由以保住 prompt cache。
3. **额度轮换**：每条链目（route）可配置 RPM/TPM/日请求/日 token 预算；额度耗尽的链目退出选择，恢复后重新加入。等价于“按额度轮换 key”，但轮换单元是 DSH 的 provider 路由。
4. **思考强度继承**：会话选择的 `max/high/low/...` 传到实际路由；目标不支持时按显式策略降级或失败，并在状态里可见。
5. **设置即 UI**：链编辑、预算、冷却、触发码、粘性、实时状态、单路由测试，全部在设置页完成；写回仍是 DSH 的标准 settings 文档（带 revision 检查）。
6. **不改上游**：不代理、不翻译 DSH 与上游之间的协议。上游仍由 DSH 已安装的 provider 插件直接通信。

### 1.2 非目标

- 不做跨 provider 的密钥池（同一 provider 下挂多把 key）。DSH 的凭据按 provider 路由绑定，真正的 key 池需要网关自己持有密钥；见 §9 的 facade 方案。
- 不做 token 计费/账单。`dsh-cost-meter` 已存在，AutoRouter 只做选择与预算闸门。
- 不在 v0.1 做多用户/远程共享。设置页与状态接口都走本机已认证的 DSH Web 会话。
- 不替代 `llm-retry`：单路由内部的瞬时重试仍归它；AutoRouter 只决定“换不换路由”。

---

## 2. 事实基础（已核实）

| 事实 | 证据 |
|---|---|
| provider 由插件通过 `ctx.llm.registerAdapter(providers, adapter)` 注册，重复注册抛 `DUPLICATE_ADAPTER` | `llm` 服务契约，cordis_inspect |
| 虚拟 provider 可行：`dsh-llm-fallbacks` 注册 `FallbacksChain`，每个链是一个模型行 | fallbacks `dist/chain-walk.d.ts` |
| 适配器可对任意请求调用 `ctx.llm.stream({...options, provider, model})` | `llm.stream` 是公开服务方法 |
| `GenerateOptions` 带 `sessionId`，适配器可见 | 类型声明 |
| 失败以 `finish.reason.kind === 'error'` + `LlmFailure{code,status,providerRetryAfterMs}` 到达；`block-start` 之后不能再切换 | `StreamChunk` / `FinishReason` |
| `resolveModelInfo` 返回 `context.contextWindow`、`defaultMaxTokens`、`reasoning.efforts[]`、`toolUpdate` | 类型声明 |
| 适配器可声明 `providerInfo`、`listModels`、`resolveModel`、`prepareCall`、`stream` | `LlmAdapter` |
| 设置页扩展点 `settings.section` 存在且已被多个第三方插件使用 | client Slots 目录 + 实时 occupants |
| 设置写回有 `settings.describe/update/replace/mutate`，按 profile entry id + revision | host `settings` 服务 |
| 插件可在现有 DSH 端口上注册 HTTP 路由（`webServer.register`，支持 `auth: 'required'`） | host `webServer` 服务 |
| 现有 pi-ai 路由（opendesign / commandcode）声明 `off/low/high/max`；`llm-deepseek` 的模型配置**未声明** reasoning efforts（适配器是否内置默认值需运行时核对 `resolveModelInfo`） | `cordis.patch.yml` 28–142 行 |

一个直接推论：`max` 在链上并非处处可表达。官方 DeepSeek 路由没有声明 effort，pi-ai 路由声明了四档。因此“继承”必须是**映射 + 显式降级**，而不是原样透传。

---

## 3. 架构

### 3.1 三个部件

```
┌──────────────────────────── DSH host (single process) ────────────────────────────┐
│                                                                                   │
│  agent loop ──► llm.stream(provider=autorouter, model=auto, effort=max)           │
│                        │                                                          │
│                        ▼                                                          │
│              ┌──────────────────────┐        ┌──────────────────────────────┐     │
│              │ RouterAdapter        │        │ RouterCore                   │     │
│              │ (LlmAdapter)         │◄──────►│ select / book / sticky /     │     │
│              │ listModels           │        │ quota ledger / effort map    │     │
│              │ resolveModel         │        └──────────────┬───────────────┘     │
│              │ stream() ────────────┼───────────────────────┘                     │
│              └──────────┬───────────┘                                             │
│                         │ nested ctx.llm.stream(provider=opendesign|commandcode|…)│
│                         ▼                                                         │
│         existing provider adapters (pi-ai, deepseek-api-key, …) ──► upstream      │
│                                                                                   │
│  Settings UI ──► settings.describe/mutate(ns=llm-autorouter, revision)            │
│              └─► GET /api/autorouter/status  (webServer, auth=required)           │
└───────────────────────────────────────────────────────────────────────────────────┘

可选 Phase 4：外部客户端 ──► POST /api/autorouter/v1/chat/completions ──► RouterCore
```

- **RouterAdapter**：唯一的对外 provider 面。只做参数映射、元数据推导、流的中继与游走。
- **RouterCore**：纯逻辑。输入是请求意图 + 当前配置 + 运行时状态，输出“下一条候选路由”；可单测，不含 I/O。
- **Settings/Status**：host 内的设置页数据面。设置写入走 DSH settings（乐观并发），状态读取走只读 JSON 路由。

### 3.2 为什么 DSH 流量不走“一条 baseURL 的 HTTP 网关”

用户原始设想是：插件起一个聚合网关，DSH 侧配一条 `baseURL` 指向它。这个结构对外部客户端成立，但对 DSH 自身是纯损耗：

1. **replayState 丢失**。`llm.stream` 明确写着：只有“同一个适配器实例同时拥有历史 provider 与目标 provider”时才保留 replay state。HTTP/OpenAI JSON 无法携带 opaque 的 `ReplayEnvelope`，结果是每一轮都把完整历史重发，成本与首 token 延迟都上升。
2. **附件语义丢失**。`ImageBlock` 带 `ImageAttachmentRef`（attachmentId、尺寸、字节数、`offloaded` 标记）与 `FileBlock`。OpenAI 兼容体只能传 base64 或 URL，要么重复编码，要么依赖额外端点。
3. **类型化块丢失**。DSH 的 `tool-addition` / `tool-removal` 块、`ReasoningBlock` 与 pi-ai 的方言映射，在 OpenAI 体里没有一一对应；网关必须重新实现一套方言层，等于把 DSH 已经做对的事再做一遍。
4. **双重翻译**。DSH → OpenAI → 上游方言。每一层都是 bug 与延迟来源。
5. **凭据反而更远**。DSH 的 `credentials` 服务按 provider 解析密钥；网关若在进程外，就得自己再存一份密钥（明文 YAML 或第二套加密），安全性下降。

因此 v0.1 的 DSH 面是**原生适配器**，零网络跳、零翻译。用户要的“一条 baseURL”在 Phase 4 以 **facade** 形式提供：同一个 RouterCore，面向 Claude Code/Cline 等外部客户端；DSH 自己不用它。这样两种诉求都满足，且各自拿到最优路径。

> 决策点 D1：若坚持 DSH 也必须经 HTTP baseURL，改动仅限 RouterAdapter 的实现（换成 OpenAI 客户端 + 本机回环），RouterCore 与设置页不变；代价是上述 1–4 条。默认不这么做。

### 3.3 与 `dsh-llm-fallbacks` 的关系

| 维度 | fallbacks | AutoRouter |
|---|---|---|
| 入口 | 每个命名链一个虚拟 provider 行 `FallbacksChain/<id>` | 一个 provider `autorouter`，链是模型 `auto/*` |
| 选择依据 | 失败驱动 + 时间槽重排 | 失败 + 额度 + tier + 粘性 |
| 额度 | 无 | RPM/TPM/日预算，耗尽退出 |
| 配置面 | YAML / 自身 RPC 卡 | 设置页，写标准 settings |
| 失败语义 | 仅 pre-output 触发码切换 | 同左，并补状态码分类与 request-scoped 记录 |
| 角色/子代理 | 有 | 不做，交给 DSH 原生 |

两者可共存：AutoRouter 的链目可以指向 `FallbacksChain/chain-1`（不推荐，会嵌套两套冷却），也可以完全替代它。迁移步骤见 §11。

---

## 4. Provider 契约映射

### 4.1 注册

```js
const handle = ctx.llm.registerAdapter(['autorouter'], adapter) // 随 fiber 释放
```

`providerInfo('autorouter')` → `{ id: 'autorouter', name: 'AutoRouter' }`。

不使用 `registerConfigurableProviders`：那是“由配置激活的真实端点”的目录，AutoRouter 的路由是虚拟的，登记进去会让“设置 → 模型”的添加流程误以为它有一个可编辑的 baseURL。代价是“设置 → 模型”不会为它生成可配置卡片；模型选择器仍然通过 `listProviders`/`listModels` 看到它（`FallbacksChain` 同此路径）。因此 §7.4 的 provider-card 摘要属于可选增强，派发键不匹配就不注册。

虚拟模型 id 来自配置的 profile id（默认 `auto`），校验 `^[a-z0-9][a-z0-9._-]*$`。profile 与虚拟模型 1:1：`profiles[].id` 就是选择器里的 model id，`profiles[].label` 是显示名。

### 4.2 `listModels('autorouter')`

每个启用的 profile 返回一行：

```js
{
  provider: 'autorouter',
  id: 'auto',
  name: 'AutoRouter',                 // profile.label
  description: 'opendesign/… → commandcode/… → deepseek-account/…',
  inputModalities: ['text','image'],  // 见 §4.4
  badge: { text: { en: 'Auto', zh: '自动' }, tone: 'info' },
}
```

`description` 由链目摘要生成，过长截断。`badge` 用于在模型菜单里把它和真实模型区分开。

### 4.3 `resolveModel('autorouter', model)`

按 profile 聚合链目元数据：

| 字段 | 规则 |
|---|---|
| `context.contextWindow` | profile 显式值；否则 `min(已知链目窗口)`；全部未知时用 `policy.defaultContextWindow`（默认 128000） |
| `defaultMaxTokens` | `min(链目 defaultMaxTokens)`；未知则省略 |
| `reasoning.efforts` | **并集**（按 `policy.effortOrder` 排序），保留每个 id 的展示名；`defaultEffort` 取 profile 配置或第一个非 `off` |
| `reasoning` 完全缺失 | 所有链目都未声明 efforts 时不返回 `reasoning`（选择器不出现强度选项） |
| `inputModalities` | **交集**；任一链目 text-only 则只报 text |
| `systemPromptUpdate` | 固定 `in-history`（契约只有这一个值） |
| `toolUpdate` | 任一链目为 `addition-only` 则 `addition-only`，否则 `in-history` |

聚合需要读取链目的 `resolveModelInfo`。加 **60s TTL 缓存**（key = provider/model），失败按“未知”处理并记录；不因单个链目不可解析而让整个虚拟模型不可用。

### 4.4 输入模态与工具更新为何取保守值

DSH 依据虚拟模型声明的 `inputModalities` 与 `toolUpdate` 构造历史。若声明成并集，用户贴图后路由落到 text-only 路由会直接失败；声明成交集/最严格值，则历史形状对所有链目都安全，代价是偶尔牺牲能力。能力差异通过状态页暴露：`auto` 旁标注“当前链含 text-only 路由，图片会被拒绝”。需要完整能力时，另建一个只含多模态链目的 profile（如 `auto-vision`）。

---

## 5. 路由引擎

### 5.1 数据模型

```ts
type RouteRef = `${string}/${string}`          // provider/model，按第一个 '/' 切分

interface Entry {
  id: string                                    // 稳定 id，UI 排序/状态用
  route: RouteRef
  tier: number                                  // 0 优先，数字越大越靠后
  weight: number                                // 同 tier 内的轮换权重
  enabled: boolean
  effortMap?: Record<string, string | null>     // 覆盖全局映射；null = 省略 effort
  limits?: { rpm?: number; tpm?: number; dailyRequests?: number; dailyTokens?: number }
  cooldownMs?: number                           // 覆盖全局
}

interface Profile {
  id: string                                    // 虚拟模型 id
  label: LocalizedText
  entries: Entry[]
  contextWindow?: number | 'auto'
  effortPolicy?: 'clamp' | 'drop' | 'fail'
}

interface Policy {
  sticky: 'session' | 'turn' | 'none'
  stickyTtlMs: number
  cooldownMs: number
  cooldownBackoff: boolean
  maxSwitches: number
  exhaustedPolicy: 'fail' | 'soonest'
  triggerCodes: string[]
  triggerStatuses: number[]
  requestScopedCodes: string[]
  effortOrder: string[]
  defaultContextWindow: number
}
```

运行时状态（不落盘）：

```ts
interface EntryState {
  cooldownUntil?: number
  consecutiveFailures: number
  lastUsedAt?: number
  lastError?: { code: string; status?: number; at: number; message: string }
  window: { startedAt: number; requests: number; tokens: number }   // 60s 滑动
  day: { date: string; requests: number; tokens: number }           // 本地日历日
}
```

### 5.2 选择算法

每次 `stream()` 调用执行一次 **walk**：

```
candidates = profile.entries
  .filter(e => e.enabled && e.provider !== 'autorouter')
  .filter(e => route 在当前 llm.listProviders() 中存在)
  .filter(e => !inCooldown(e))
  .filter(e => !quotaExceeded(e))
  .sort(by tier, then rotateIndex)

if candidates is empty:
  if policy.exhaustedPolicy === 'soonest': candidates = [最早恢复的链目]
  else: terminal error AUTOROUTER_EXHAUSTED

sticky = state.bySession.get(sessionId)
if policy.sticky === 'session' && sticky ∈ candidates && !expired(sticky):
  order = [sticky, ...candidates without sticky]
else:
  order = candidates
```

`rotateIndex` 的实现：同 tier 内按 `lastUsedAt` 升序（LRU），权重用于“连续选择次数”偏置；不做跨 tier 的负载均衡（tier 表达优先级，不表达成本）。

**为什么 LRU 而不是随机**：同一 tier 的多条路由往往额度独立。LRU 让请求在订阅之间均匀铺开，同时避免随机的长尾（某条路由被连续抽中而提前耗尽）。粘性优先于 LRU，所以缓存命中不受影响。

### 5.3 粘性

- key = `sessionId`（缺失时不粘，退化为每次 LRU）。
- 成功一次即写入 `{entryId, since}`，TTL 默认 30 分钟；过期后重新选择。
- 切换发生时更新映射；子代理有独立 `sessionId`，天然各自粘住。
- 目的：保住上游的 prompt cache 与（若未来实现 replay 信封）会话状态。**不建议**按请求轮换，那会把缓存打成碎片，成本远高于额度均衡的收益。

### 5.4 失败分类与游走

一次尝试的边界：

```
attempt:
  committed = false
  for chunk of upstream:
    if chunk.type === 'block-start': committed = true
    yield chunk
  finish = 最后一个 chunk（必须是 finish）
```

判定：

- `finish.reason.kind === 'stop' | 'tool-calls' | 'max-tokens'`：成功，更新粘性，结束。
- `finish.reason.kind === 'aborted'`：原样转发，不记冷却（用户取消不是路由故障）。
- `finish.reason.kind === 'error'`：
  - 若 `committed === true`：**不能切换**（已产出的块无法撤回），记一次状态，原样转发。
  - 若 `committed === false`：
    - 命中 `triggerCodes` 或 `triggerStatuses`：记冷却（request-scoped code 只记 lastError，不冷却），推进到下一条；受 `maxSwitches` 限制。
    - 未命中：原样转发。400/404/422 这类请求形状错误盲目换路由只会浪费额度、掩盖问题。
- 上游在没有 `finish` 的情况下结束：合成 `error` finish，code `AUTOROUTER_UPSTREAM_TRUNCATED`，按 error 处理。

`maxSwitches`：一次 walk 最多切换 N 次，尝试数 ≤ N+1。默认 3。达上限时把最后一次失败原样转发。

冷却：默认 5 分钟；`cooldownBackoff: true` 时按连续失败次数指数退避（上限 30 分钟）。冷却结束进入半开：允许一次探测，成功清零，失败继续冷却。

### 5.5 额度账本（已废弃，保留为设计演进记录）

> v0.1.4 起不再实现。理由：本地账本只是对上游配额的猜测，猜低了会静默拦掉可用请求，
> 猜高了又拦不住真正超限的那一刻；上游的 429 与失败计数已经足够。现有配置里的这些键
> 被 `normalizeConfig` 直接忽略，不需要迁移。

- 窗口：`rpm`/`tpm` 用 60s 滑动窗口（环形桶，10s 粒度即可）；`dailyRequests`/`dailyTokens` 用本地日历日。
- 计数来源：请求发出即 `+1 req`；`usage` chunk 到达时累加 tokens（`totalTokens ?? input+output`）。失败且没有 usage 的请求仍计 1 次请求。
- 耗尽：该链目在窗口结束前不参与选择；UI 显示剩余时间。全部耗尽时按 `exhaustedPolicy`。
- **明确限制**：账本是本地估算，重启即清零；provider 的 429/配额错误才是最终事实。账本只用于“提前避让”，不能当作计费依据。

### 5.6 思考强度继承

请求里的 `reasoningEffort` 是 `ReasoningEffortId`（品牌化字符串）。对每个候选目标：

1. 读目标的 `resolveModelInfo(target).reasoning`。
2. 目标未声明 `reasoning`：按 `effortPolicy`：
   - `clamp`：省略 `reasoningEffort`（用上游默认），记 `effort-dropped`。
   - `drop`：同上，但不记警告。
   - `fail`：跳过该链目，记 `effort-unsupported`。
3. 目标声明了 efforts：
   - 精确命中 → 用原值。
   - 命中 `entry.effortMap[requested]` → 用映射值（`null` = 省略）。
   - 否则按 `policy.effortOrder` 找**不高于**请求档位的最近档（clamp）；找不到更低档时用目标 `defaultEffort`。
   - 记一条 `effort-coerced` 事件（会话日志/状态页可见）。
4. 全局 `effortOrder` 默认 `['off','minimal','low','medium','high','max']`；未知 id 排在 `max` 之后，按字符串稳定排序。

为何虚拟模型报**并集**而不是交集：选择器要能表达 `max`；交集会把 `max` 从 UI 里抹掉，用户失去“尽量高”的意图。真正的约束在派发时按目标解析，且降级可见。

### 5.7 上下文窗口

- `auto` 默认报 `min(已知窗口)`。理由是 DSH 用它决定何时压缩；报最大值会让请求在真正落到小窗口路由时才溢出，而那时可能已经产生输出。
- 需要长上下文时，建一个只含大窗口链目的 profile（如 `auto-long`），它自然报更大的窗口。
- 窗口未知的链目视作“未知”，不参与 min；全部未知时用 `defaultContextWindow`。
- 可选触发码 `CONTEXT_WINDOW_EXCEEDED`：默认**不**列入 `triggerCodes`，让 DSH 的压缩先处理；用户明确希望“溢出就换大窗口路由”时再开启，并作为 request-scoped 记账（不冷却）。

### 5.8 并发与重入

- 递归守卫：任何 `entry.route` 的 provider 等于 `autorouter` 时跳过并记错误。UI 在保存时也拒绝这种配置。
- 同一会话的并发请求（并行工具调用）各自独立 walk；粘性映射可能被后完成的请求覆盖，属于可接受的近似。
- 不引入全局串行化：模型调用本身是并发的，串行会让整个会话变慢。
- `AbortSignal` 透传到嵌套调用；外层取消时，内层随之中止，已产出的块按 aborted 转发。

---

## 6. 配置模型

配置存放在插件自己的 Loader 条目里（entry id = 设置命名空间 = `llm-autorouter`）。`apply(ctx, config)` 拿到的可能是 `{get()}` 形式的 live ref（fallbacks 已记录该协议），每次请求读 `.get()`，因此设置保存后无需重载插件。

```yaml
- id: llm-autorouter
  name: dsh-autorouter
  config:
    enabled: true
    defaultProfile: auto
    profiles:
      - id: auto
        label: { en: AutoRouter, zh: 自动路由 }
        entries:
          - id: r-opendesign-eco
            route: opendesign/deepseek-v4.1-flash-eco
            tier: 0
            weight: 1
            limits: { rpm: 60, dailyRequests: 400 }
          - id: r-commandcode-flash
            route: commandcode/deepseek/deepseek-v4.1-flash
            tier: 0
            weight: 1
            # effortMap 只在目标档位与请求不一致时需要；例：{ max: high }
          - id: r-deepseek-official
            route: deepseek-account/deepseek-flash
            tier: 1
            weight: 1
            # 该路由若未声明 efforts，按 §5.6 省略 effort 并记录 effort-dropped
        effortPolicy: clamp
      - id: auto-long
        label: { en: AutoRouter Long, zh: 长上下文路由 }
        entries:
          - id: r-deepseek-official-l
            route: deepseek-account/deepseek-flash
            tier: 0
        contextWindow: 1000000
    policy:
      sticky: session
      stickyTtlMs: 1800000
      cooldownMs: 300000
      cooldownBackoff: true
      maxSwitches: 3
      exhaustedPolicy: soonest
      triggerCodes: [AUTH, QUOTA, RATE_LIMIT]
      triggerStatuses: [401, 402, 403, 429, 500, 502, 503, 504]
      requestScopedCodes: [CONTEXT_WINDOW_EXCEEDED, UNSUPPORTED_REASONING_EFFORT]
      effortOrder: [off, minimal, low, medium, high, max]
      defaultContextWindow: 128000
    facade:
      enabled: false
      path: /api/autorouter/v1
```

默认值要点：

- `triggerCodes` 与现役 fallbacks 一致（`AUTH`/`QUOTA`/`RATE_LIMIT`），降低迁移认知成本。
- `triggerStatuses` 是补充判据：不同上游的 code 字符串并不统一，HTTP 状态更稳定。两者取并集。
- 敏感信息**不**进这份配置：链目只写 `provider/model`，密钥仍由 DSH `credentials` 按 provider 解析。

---

## 7. 设置页

### 7.1 注册

客户端模块（`client.js`，由 `window.__ModuleLoader__.load` 注册）声明：

```js
inject: ['slots', 'remote.settings']
apply(ctx) {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'autorouter',
    order: 16,
    label: () => t('autorouter.settings.title'),
  }, AutoRouterSection))
}
```

- `id: 'autorouter'`，`order: 16`（`plugins` 15 与 `agent-presets` 20 之间），避开已被占用的 id。
- 可选：在 `settings.models.provider-card` 注册 key `autorouter`，在“设置 → 模型”的 AutoRouter 卡片里显示一行健康摘要 + “打开设置”。该槽的 key 由 `settingsNs` 派发，若 `autorouter` 不是 configurable provider 的 `settingsNs`，则以实际派发键为准（实现时用一次 console 探针确认，不猜）。
- 文案全部走 Client locale（`zh`/`en` 两份 `locale/*.json`），主题色沿用宿主变量。

### 7.2 页面结构

页面只有三个 tab，默认进入"路由链"：

```
AutoRouter                                   [撤销] [保存]
一个 provider、一条回退链：严格按顺序在已登记的 provider / model 之间尝试…

[ 路由链 ] [ 实时状态 ] [ JSON ]
每个档位一张卡片：标识、路由链、时间段与策略都在里面。

┌ ▾  auto   Auto   [已启用]                                  [删除] ┐   ← 点卡片头收起
│  标识 [auto]   显示名 [Auto]                                       │
│  启用档位 [●]                                                    │
│  ┌ od  OpenDesign · Flash Eco ─ 5 分钟 ──────────────── [删除] ┐   │
│  │  provider [opendesign ▾]   model [deepseek-v4.1-flash-eco ▾] │   │
│  │  冷却（分钟）[5]                                             │   │
│  │  ▶ 思考强度映射                                              │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌ cc  CommandCode … ┐  ┌ ds  DeepSeek Account · Flash ┐           │
│  [默认顺序] [● 谷时] [标准]        ← 切到哪个时段就在编哪条链      │
│  [+ 增加路由]                                                       │
│  ── 时间段 · 1 ───────────────────────────────────────  [+ 时段] ──  │
│  标签 [谷时]                              [删除时段]              │
│  00:30 → 08:30  [✕]    22:00 → 23:30  [✕]        [+ 时间段]      │
│  本时段的回退顺序                                                │
│  deepseek-account/deepseek-flash  →  opendesign/flash-eco        │
│  在「回退链」上方的时段按钮里调整顺序。                            │
│  ── 策略 ─────────────────────────────────────────────── ▾ ────  │
│  maxSwitches / 冷却 / 退避 / 粘性 / 失败窗口 / effort / context / │
│  时区 / 触发码                                                    │
└─────────────────────────────────────────────────────────────────────┘

[ 实时状态 ]   ┌ ▾ 实时状态  3 条路由              [刷新] [清空冷却] ┐
               │ profile | provider | model | health |               │
               │ 统计 / 粘性会话                                     │

[ JSON ]       直接编辑完整配置，[应用] / [撤销]
```

交互细节（与实现一致）：

- 卡片头即展开/收起开关（`cursor:pointer`，点空白切换；点内部按钮/输入框不切换），
  右侧 chevron 单独可点且带 `aria-expanded`；折叠状态按卡片 id 记在 `localStorage`。
- 时间段与策略属于本档位，是卡片内的 `Section`：时间段常显，策略默认展开、标题行可单独收起。
- 每个时段有自己的回退链：路由链顶部的时段按钮（`默认顺序` + 每个时段，命中当前时段的
  带 `●`）决定上下箭头在编辑哪一条链。时段里未列出的路由保持配置顺序排在最后兜底，
  所以一个时段从不会把候选清空；新增路由会同时追加到每个时段的链尾。
- 时间段卡片里只读预览该时段的顺序，避免同一件事有两个编辑入口。
- 路由可从已登记 provider / model 里选；`Probe` 只做元数据可达性检查，不发真实请求。
- 保存随时可点（`disabled: busy`），成功后用返回的配置与 revision 刷新页面。
- 撤销丢弃未保存的改动、回到上次保存的配置，不重新请求服务器。
- 空态：没有可用路由时提示先到 设置 → 模型 配置 provider，而不是给一个空链。
- 只读态：插件被禁用或 `llm` 服务不可用时显示原因，入口不隐藏。

### 7.3 数据面

- **读配置**：`remote.settings.describe()` 中筛出 `ns === 'llm-autorouter'`，取 `value` 与 `revision`。`describe` 的远程调用默认脱敏，正好；本配置不含密钥。
- **写配置**：`remote.settings.mutate('llm-autorouter', ops, revision)`。数组整体 `set`（避免索引移位竞态），字段级 `set` 用于开关。
- **读状态**：`GET /api/autorouter/status`（host `webServer.register({kind:'prefix', path:'/api/autorouter', auth:'required'})`）。返回：

```json
{
  "configRevision": 7,
  "profiles": [{ "id": "auto", "label": "AutoRouter", "entries": ["r-1","r-2","r-3"] }],
  "routes": [{
    "entryId": "r-2", "provider": "commandcode", "model": "deepseek/deepseek-v4.1-flash",
    "healthy": true, "cooldownUntil": null,
    "window": { "requests": 3, "tokens": 8123 },
    "day": { "requests": 12, "tokens": 300123 },
    "lastError": null, "lastUsedAt": 1760000000000
  }],
  "sessions": [{ "sessionId": "…", "entryId": "r-1", "since": 1760000000000 }],
  "catalog": [{
    "provider": "opendesign",
    "models": [{ "id": "deepseek-v4.1-flash-eco", "name": "…", "efforts": ["off","low","high","max"],
                "contextWindow": 200000, "inputModalities": ["text","image"] }]
  }]
}
```

`catalog` 与状态同包返回，链编辑器不需要第二次往返。页面可见时每 2s 轮询；`document.hidden` 时暂停；请求失败退避到 10s 并保留最后一次数据。

- **测试**：`POST /api/autorouter/test` `{ entryId }`。host 侧走同一条 `ctx.llm.stream`，`maxTokens: 1`，超时 20s；返回 `{ ok, firstTokenMs, totalMs, code?, status? }`。不把测试写进账本（否则用户点几下就把预算烧掉）。

### 7.4 Models 页联动

`settings.models.provider-card` 是一个 keyed 槽：在 AutoRouter 的 provider 卡片上追加一行：

```
AutoRouter   auto · 2/3 正常 · 当前 opendesign/…   [打开设置]
```

实现上只读 `/api/autorouter/status`，不复制链编辑逻辑。若该槽的派发键不是 `autorouter`，就不注册，避免出现无主内容。

---

## 8. 故障语义矩阵

| 场景 | 已产出块 | 记账 | 行为 |
|---|---|---|---|
| 401/403 | 否 | 冷却（AUTH） | 下一条 |
| 402/429 | 否 | 冷却（QUOTA/RATE_LIMIT，带 `providerRetryAfterMs` 优先） | 下一条 |
| 5xx/408 | 否 | 冷却（按配置，默认开） | 下一条 |
| 400/404/413/422 | 否 | 只记 lastError | 原样转发（不换） |
| 上下文溢出（若列入 trigger） | 否 | request-scoped，不冷却 | 下一条 |
| 未声明 effort 的目标（fail 策略） | 否 | 记 effort-unsupported | 跳过 |
| 任意错误 | 是 | 记 lastError；触发码仍冷却 | 原样转发，不切换 |
| 用户取消 | 任意 | 不记账 | 转发 aborted |
| 全部冷却/耗尽 | 否 | — | `AUTOROUTER_EXHAUSTED`（或 `soonest` 兜底） |
| 上游流无 finish 结束 | 任意 | 按 error | 合成 `AUTOROUTER_UPSTREAM_TRUNCATED` |

补充：

- 冷却以 `entryId` 为键，不按模型；同一路由的不同模型共享额度与健康度（凭据是同一个）。
- `providerRetryAfterMs` 存在时取 `max(cooldownMs, retryAfter)`。
- 半开探测失败会重新进入冷却；连续失败计数不清零，除非成功。

---

## 9. 可选 HTTP facade（Phase 4）

### 9.1 目的

让外部客户端（Claude Code、Cline、脚本）复用同一套路由与额度逻辑，而不需要理解 DSH 的凭据与 provider 配置。这就是用户设想的“一条 baseURL”。

### 9.2 接口

- `GET  /api/autorouter/v1/models` → OpenAI 风格 `{ object: 'list', data: [{id:'auto', ...}] }`
- `POST /api/autorouter/v1/chat/completions` → 支持 `stream: true`（SSE）与 `stream: false`
- 鉴权：`Authorization: Bearer <token>`；`auth` 用函数式 `WebAuthenticationRule`，token 从 DSH credentials 的 `AUTOROUTER_FACADE_TOKEN` 读取（`ctx.credentials.resolve`），不写进配置。未配置 token 时 facade 拒绝启用。

### 9.3 映射与明确不支持

| OpenAI 字段 | 映射 |
|---|---|
| `messages[].role/content` | `GenerateOptions.messages`（user/assistant/system） |
| `tools` / `tool_choice` | `ToolSchema[]`（只保留函数工具） |
| `max_tokens` / `temperature` / `stop` | 同名控制 |
| `reasoning_effort` | `reasoningEffort`，走 §5.6 映射 |
| 流式 `delta.content` / `delta.tool_calls` | `text-delta` / `tool-call-delta` |
| `usage` | `usage` chunk |

不支持（文档明示）：图片/文件输入、`replayState`、DSH 的 tool-addition/removal 块、并行工具调用的精确重建。外部客户端拿到的是一条“普通 OpenAI 兼容”能力面，不是 DSH 的全部能力。

### 9.4 为什么不把 DSH 也接上去

同 §3.2。facade 是给外部客户端的适配层，不是 DSH 的内部总线。

---

## 10. 安全、隐私与可观测性

- **密钥**：插件配置不出现任何 key；链目只引用 provider/model。上游密钥由各 provider 插件通过 DSH credentials 解析。facade 的 token 单独存在 credentials，UI 只显示“已配置/未配置”。
- **日志**：请求只记录 `provider/model/entryId/latency/usage/错误码`，不记录 prompt 或响应正文。错误 message 截断 200 字符，且不包含 header。
- **状态接口**：`auth: 'required'`，仅本机已认证的 Web 会话可读；不返回密钥或完整 prompt。
- **写路径**：设置页写标准 settings，带 revision；插件不直接改 `cordis.patch.yml`。
- **可观测性**：
  - 状态页：每条路由的健康、冷却剩余、窗口/日用量、最近错误、最近使用时间。
  - 结构化事件（host 日志）：`route-selected`、`route-switched`、`route-cooldown`、`effort-coerced`、`quota-exhausted`、`walk-exhausted`。
  - 计数器：按 entry 的请求数、tokens、切换次数、失败码分布；重启清零并在 UI 标注。

---

## 11. 工程形态、安装与迁移

### 11.1 形态

v0.1 采用**零构建 ESM JavaScript + JSDoc 类型**，与 dsh-doc 的 `templates/decoration` 一致：

```
dsh-autorouter/
  package.json          # dsh.bundle.patch + dsh.client
  cordis.patch.yml      # - insert: [{ id: llm-autorouter, name: dsh-autorouter, config: {...} }]
  index.js              # host: apply(ctx, config)
  src/router-core.js    # 纯函数：选择、分类、effort、聚合
  src/adapter.js        # LlmAdapter 实现
  src/status-route.js   # webServer 路由
  src/config.js         # 默认值 + 校验
  client.js             # window.__ModuleLoader__ 设置页
  locale/zh.json, en.json
  icon.svg
  test/*.test.js        # node --test
```

发布版再迁到 TypeScript + tsdown（参照 fallbacks 的构建链）。零构建让 P0 当天可跑，类型通过 `// @ts-check` + `@type {import('@deepseek-ai/dsh-llm').LlmAdapter}` 获得编辑器提示。

### 11.2 安装（本地 bundle）

1. 把仓库装进 profile：`package.json` 的 `dependencies` 用 `link:<repo>`，并把
   `dsh-autorouter` 追加进 `dsh.profile.bundles`；`node_modules` 里要有指向仓库的
   junction（实测：`<DSH_HOME>/profiles/<profile>/node_modules/dsh-autorouter` → 本仓库）。
2. 插件的 `package.json` 必须声明它导入的 `@deepseek-ai/*` 包为 `peerDependencies`
   （本包为 `@deepseek-ai/dsh-llm` 与 `@deepseek-ai/schemastery`）。linked bundle
   的导入解析只认 peer：漏声明时进程报
   `ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/schemastery'`，
   插件行停在 `inactive`。
3. 对插件行触发一次重组即可生效，不必重启：
   `plugin_manager set_plugin { target: "include:llm-autorouter", enabled: true }`。
   改动 `client.js` 后仍需重启（第三方 client 半没有 HMR）。
4. 验证：`cordis_inspect` 的 Config 状态应为 `schema`（不是 `inactive`），client
   `Slots.listSubTree` 的 `settings.section` 下出现 `autorouter`/16；设置 →
   AutoRouter 出现，模型选择器出现 `AutoRouter / auto`。
5. 把 `agent-default-model` 的 `provider/model` 改为 `autorouter` / `auto`（或某个 profile）。

### 11.3 从 fallbacks 迁移

1. 保留 `dsh-llm-fallbacks` 安装，先不删。
2. 打开 AutoRouter 设置页 → “从 fallbacks 导入”，生成同序链目。
3. 把 `agent-default-model` 切到 `autorouter/auto`，跑一周。
4. 确认稳定后再决定是否停用 fallbacks；两者同时挂在同一条链上会叠加冷却，不建议。

---

## 12. 测试计划

### 12.1 单元（纯函数，无 DSH）

- `selectEntries`：tier 排序、LRU、粘性命中/过期、冷却过滤、额度过滤、全部耗尽时 `fail`/`soonest`。
- `classifyFailure`：code、status、`providerRetryAfterMs`、request-scoped 组合。
- `mapEffort`：精确/映射/降档/无 efforts/未知 id；`clamp|drop|fail` 三种策略。
- `aggregateModelInfo`：窗口 min、模态交集、toolUpdate 保守值、efforts 并集与排序。
- `quotaLedger`：60s 滑动窗口跨桶、日切、失败请求计数。

### 12.2 集成（假适配器）

注册两个 `LlmAdapter` 测试替身 `fake-a` / `fake-b`，按脚本产出：正常流、pre-output 401、post-output 500、停滞流。断言：

- 401 后落到 `fake-b`，且 `fake-a` 进入冷却；
- 已产出 `block-start` 后不切换；
- `usage` 不阻止切换；
- `maxSwitches` 达上限后转发最后一个错误；
- 粘性：同 `sessionId` 第二次调用仍走 `fake-b`（成功后的粘性），不同 session 走 LRU。

### 12.3 端到端（GUI）

- 设置页注册、导航顺序、locale 切换；
- 链增删改排序写回 YAML（revision 增长）；
- 冲突写入（外部改 YAML 后页面保存）提示并恢复；
- 状态轮询在页面隐藏时暂停；
- 真实路由：`autorouter/auto` 一轮对话，强制把首条路由置为冷却，观察落到第二条；
- 失败注入：把 `triggerStatuses` 设为 `[418]`，用测试替身返回 418，验证切换。

### 12.4 验收门槛

- `npx dsh-standards <dir> --scope entry` 通过（ENTRY 层）。
- 单测 + 集成测试全绿；`node --test` 无跳过。
- 手工 e2e 记录：至少一次真实切换、一次额度耗尽、一次设置冲突。

---

## 13. 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| P0 | 脚手架、注册 `autorouter`、`listModels/resolveModel`、单条固定路由的 `stream` 直通、status 路由 | 选择器出现 AutoRouter/auto，能正常对话，流式不丢块 |
| P1 | RouterCore：链、tier、冷却、粘性、失败分类、maxSwitches、usage 记账 | 集成测试全绿；注入 401 能切换 |
| P2 | 设置页：链编辑、策略、状态、测试按钮、locale | e2e 全绿；配置写回带 revision |
| P3 | 额度账本、导入 fallbacks、Models 页 provider-card 摘要 | 额度耗尽可见且能恢复 |
| P4 | HTTP facade（可选）、token 鉴权、OpenAI 映射 | 外部 curl 流式与非流式均可用 |
| P5 | 打磨：replay 信封、指标、成本估算、TS 迁移 | 设计评审通过 |

P0–P2 是一个可用闭环；P3 是“按额度轮换”的完整体；P4 才是字面意义的单 baseURL 网关。

---

## 14. 风险与未决

| # | 风险 | 影响 | 处置 |
|---|---|---|---|
| R1 | 助手消息的 source 记成 `autorouter/auto`，上游 replayState 被丢弃 | 每轮全量重发，成本上升 | v0.1 接受并在文档标注；P5 研究 replay 信封 + source 重写 |
| R2 | 嵌套 `ctx.llm.stream` 会再次经过 `llm/stream` 中间件（如 cost-meter） | 可能双记用量 | P0 用探针验证；必要时给嵌套调用加标记并在中间件侧识别（需上游配合） |
| R3 | 上游 `resolveModelInfo` 慢或抛错 | 选择延迟、元数据缺失 | 60s 缓存；失败按未知处理；不阻塞整个虚拟模型 |
| R4 | DSH 适配器契约随版本变化 | 插件失效 | 锁定 peer 版本；`dsh-standards --scope entry` + 运行时探针 |
| R5 | “一个 provider 一把 key”的假设不总成立（OAuth 路由、插件内部轮换） | 额度语义偏差 | 文档说明；额度单元仍是路由，不假装是 key |
| R6 | 配置改动后模型列表不刷新 | 选择器看不到新 profile | 设置页保存后提示“若未出现，重开模型菜单”；P2 验证 `llm/adapters-updated` 事件 |
| R7 | 账本重启清零 | 预算短时失效 | UI 明示“本地估算”；以 provider 429 为准 |
| R8 | 与 fallbacks 同时启用导致叠加冷却 | 路由抖动 | 迁移期二者只留一个作为默认入口 |
| R9 | `settings.models.provider-card` 的派发键不确定 | 卡片摘要不出现 | 实现时探针确认；不匹配就不注册，页面本身不受影响 |
| R10 | 禁用/卸载插件后，已有会话仍保存着 `autorouter/auto` | 这些会话的模型调用失败 | 文档写明；卸载前先把会话/默认模型切回真实路由；错误信息给出可操作提示 |

未决问题：

1. **D1**：DSH 是否必须经 HTTP baseURL？默认否（§3.2）。
2. 官方 DeepSeek 路由未声明 reasoning efforts，是否需要为其补一个 `effortMap`（例如 `max → 省略` 并显式标注“该路由不支持强度控制”）？默认按 §5.6 处理。
3. 默认链是否直接用现役 fallbacks 的三条（opendesign-eco → commandcode-flash → deepseek-flash）？默认是。
4. facade 是否在 v1 就做？建议 P4。

---

## 15. 附录：请求生命周期（成功 + 一次切换）

```
agent loop
  └─ llm.stream({provider:'autorouter', model:'auto', effort:'max', sessionId:S, messages, tools})
       └─ RouterAdapter.stream
            ├─ profile = config.profiles['auto']
            ├─ candidates = eligible(profile, state)          # r1, r2（r3 冷却中）
            ├─ order = [sticky(S)=r1, r2]
            ├─ attempt r1 (opendesign/…-eco)
            │    ├─ modelInfo = resolveModelInfo('opendesign','…-eco')   # efforts: off/low/high/max
            │    ├─ effort = 'max'                                      # 精确命中
            │    ├─ upstream = llm.stream({provider:'opendesign', model:'…-eco', effort:'max', …})
            │    └─ finish error 429 (no block-start)
            │         ├─ book: r1 cooldown 5m / quota window +1
            │         └─ next
            ├─ attempt r2 (commandcode/deepseek/deepseek-v4.1-flash)
            │    ├─ modelInfo efforts: off/low/high/max → 'max'
            │    ├─ stream → block-start, text-delta, …, usage, finish stop
            │    └─ sticky[S] = r2；usage 累加
            └─ return chunks as-is (r1's failed attempt yielded nothing)
```

---

*本设计以当前安装的 DSH 契约（`llm`、`settings`、`webServer`、client Slots）为依据；实现前用 `cordis_inspect` 再核对一次签名，避免版本漂移。*
