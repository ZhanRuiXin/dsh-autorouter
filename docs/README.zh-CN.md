# AutoRouter

[![powered by dsh](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness) [![DSH 0.2.x](https://img.shields.io/badge/DSH-0.2.x-4D6BFE?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness) [![license MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](../LICENSE)

**一个 DSH 插件：把你已经登记过的 provider 与 model 收成一个 provider，后面挂一条回退链。**

**版本 0.2.1** · **更新于 2026-11-26**

<p align="center"><a href="../README.md">English</a> · <strong>简体中文</strong></p>

---

## 概述

AutoRouter 注册一个原生 DSH provider `autorouter`（显示为 **AutoRouter**），把每个请求沿一条「已经存在于宿主里」的路由链走一遍。凭据、方言、模型登记都还是 DSH 原来那套；AutoRouter 只决定这次请求由哪条已登记路由接，以及那条路由失败之后怎么办。

它不是代理。每次尝试都通过 DSH 自己的 `llm.stream()` 派发给拥有该路由的适配器，所以图片、附件、工具历史与 replay state 都留在懂它们的适配器里。没有 HTTP 中转，没有第二份密钥库，也没有会丢字段的翻译层。

插件同时负责 **设置 → AutoRouter** 这一页：链、各时段自己的链、冷却与实时状态都在这里改。路由行为不会藏在只能手改的配置文件里。

## 一览

| | |
| --- | --- |
| **对外的面** | 一个 provider id `autorouter`；每个档位在模型选择器里是一行 `AutoRouter / <档位>` |
| **选路** | 链数组就是顺序：从上到下，第一条可用路由获胜。没有权重，没有成本/质量打分 |
| **失败切换** | 只在第一个输出块之前；`block-start` 与任何内容增量都会提交本次尝试。提交之后的失败原样转发，不换路由 |
| **花费记账** | `usage` 从不提交尝试；它被缓存，切换前补发，所以数字不会凭空消失 |
| **额度** | 本地不设额度。上游的 429 与每条路由的失败计数才是信号；一直失败的路由进入冷却 |
| **思考强度** | 继承：虚拟模型公布链上 effort 的并集，每次尝试把请求折算到目标上，默认 clamp |
| **时间段** | 一个时段由名字加若干不连续的钟点区间组成，并且拥有**自己完整的一条回退链** |
| **会话** | 按 `sessionId` 粘性，在 TTL 内落回上次成功的路由，保住上游 prompt cache |
| **运行时** | 原生 `LlmAdapter`；每次尝试都是对已登记路由的一次嵌套 `llm.stream()` |

## 适合谁

- 同一件事有多条路线——一份订阅、一个便宜镜像、一个自带额度的账号——而你想在模型选择器里只看到一个条目，而不是手动切。
- 项目跑到一半不能因为某条路由挂掉就停：`AUTH`、`QUOTA`、`RATE_LIMIT` 与网络失败会切到下一条，会话本身不用动。
- 希望同一批路由的峰谷顺序跟着时钟走，而不是每次手动调。
- 更愿意在设置页里点，而不是编辑 YAML。

**不适合：** 只有一个 provider、一把密钥的场景。只有一条路由的链只是多套一层，直接把模型指到那条路由即可。这也不是「把一份额度变成多份」的办法——DSH 一条路由绑一份凭据，所谓密钥池就是一串各有凭据的路由。

## 依赖

AutoRouter 是**profile 级 DSH bundle**。它不安装也不启用别的东西：它走的路由就是你 profile 里已有的那些。

| 能力 | 提供方 | 说明 |
| --- | --- | --- |
| DSH | [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) `0.2.x` | 开发基线 `0.2.2-rc.3`；它用到的 LLM 服务契约（`registerAdapter`、`resolveModelInfo`、`prepareCall`）在整个 0.2 系列稳定 |
| 至少一条已登记路由 | 你自己的 provider 行 | `autorouter` 走 `llm.listProviders()`；没有凭据的路由能解析，但会在真正请求时失败 |
| Node | `>= 22` | 由宿主运行；只有脱离 DSH 测试时才需要关心 |

**可选：** 不要求也不使用 `dsh-llm-fallbacks` 之类的回退链插件。两个都装时它们是彼此独立的 provider；请只把其中一个放进模型选择器，免得同一个请求被两层各路由一次。

如果 profile 里没有任何一条可用凭据，AutoRouter 仍然会加载、设置页仍然可用——**试一次** 会把真实请求会遇到的失败原因原样报回来。

## 安装

AutoRouter 以 DSH bundle 发行，npm 包名 `dsh-autorouter`。

### 从 DSH 插件页安装

1. 打开 **设置 → 插件**，点 **添加**。
2. 粘贴安装说明：npm 包用 `dsh-autorouter@0.2.1`，钉住源码用 `github:ZhanRuiXin/dsh-autorouter#v0.2.1`，本地检出用 `link:/absolute/path/to/dsh-autorouter`。
3. **重启 DSH。** 宿主侧在启动时注册适配器与 HTTP 路由，客户端侧随页面加载。
4. 打开 **设置 → AutoRouter**，新建档位，把你要的路由加进链。

### 从 CLI 安装

```text
dsh plugin add dsh-autorouter@0.2.1
```

钉住源码而不是 registry：

```text
dsh plugin add github:ZhanRuiXin/dsh-autorouter#v0.2.1
```

> 这是 profile 级 bundle：装进一个 profile 不会在另一个里启用，设置页也只出现在启用了这一行的 profile 里。

## 第一次运行

全新安装**故意不带任何路由方案**：在你用真实拥有的 provider 搭出链之前，它不路由任何请求。先打开 **设置 → AutoRouter**：

1. **+ 新建档位** —— 档位 id 就是模型 id（`auto` → `AutoRouter / auto`）。
2. **添加路由** —— 从已登记的 provider 与模型里挑。要几条就加几条，卡片里的顺序就是尝试顺序。
3. **保存**。头部版本行应显示 `host v0.2.1`；如果显示宿主没有报告版本，说明 DSH 还在跑旧进程。
4. 在实时状态页点 **试一次**：它通过 `autorouter/<档位>` 真发一条极小请求，返回命中的路由、耗时与文本。
5. 在模型选择器里选 `AutoRouter / <档位>`，或把 `agent-default-model` 指到 `{ "provider": "autorouter", "model": "auto" }`。

一条典型的链，按尝试顺序：

```text
AutoRouter / auto
├─ opendesign/deepseek-v4.1-flash-eco      便宜镜像，能用时先走它
├─ commandcode/deepseek/deepseek-v4.1-flash
└─ deepseek-account/deepseek-flash          不能随便烧的那个账号
```

## 请求怎么被路由

候选顺序是 `链顺序 → 可用性 → 命中的时段 → 粘性钉住`。可用性会剔除正在冷却的路由；时段重排剩下的；粘性命中时，把上次服务这个会话的路由提到最前。

适配器一旦产出 `block-start`、文本、思考或工具调用增量，这次尝试就算提交。提交之前，带触发码（`AUTH`、`QUOTA`、`RATE_LIMIT`、`NETWORK` 以及触发列表里的状态码）的终态失败会切到下一条。提交之后，失败按上游原样转发：半截的回答绝不会在另一个 provider 上悄悄重来。

失败会被记账并进入冷却（`cooldownMs`，默认 5 分钟，可加抖动）。`honorRetryAfter` 打开时尊重上游的 `Retry-After`；`failureWindowMs` 内反复失败会按 `backoffMaxMs` 封顶指数退避。冷却中的路由是被跳过而不是被删除，会自己回来；**实时状态** 页列出每一条，并能单独清掉。

`maxSwitches` 是保险丝而不是目标：一步之内切换到这个数就停下，报最后一次失败，而不是无限循环。

## 思考强度

DSH 的默认 agent 模型带 `reasoningEffort: max`，而一条链上各路由声明的 effort 集合并不相同，有的干脆不声明。AutoRouter 自己消化这件事，而不是让请求在任何 I/O 之前就死掉：

- 虚拟模型公布链上声明过的 effort 的**并集**，所以即使某条路由只声明 `low`/`high`，`max` 依然可选。
- 每次尝试按 `entry.effortMap[effort]` → 目标声明的 `defaultEffort` → 省略参数 的顺序折算。目标接不住时由 `effortPolicy` 决定：`clamp`（默认）用最接近的已声明 effort，`drop` 省略，`fail` 放弃这次尝试。
- 完全不声明 reasoning 的目标算「已知没有 reasoning」：参数直接丢掉而不是转发，因为转发会让 DSH 在适配器运行前就拒绝调用。如果上游仍然回 `UNSUPPORTED_REASONING_EFFORT`，去掉参数后对同一条路由重试一次——绝不因为一个调用方无从知道的参数而放弃一条路由。

## 时间段

一个时段是一个标签加一到多个本地钟点区间（`ranges`），并且拥有这个档位路由的完整一种排序。命中任意一个区间它就是当前时段，它的 `order` 就是链。时段没列出的路由保持配置顺序排在最后兜底，所以一个时段永远不会把候选清空。

```text
deepseek-offpeak   00:30–08:30、22:00–23:30   先走 deepseek-account/*，其余在后
默认顺序           在「默认顺序」标签下编辑的那条链
```

区间是半开区间（含 `from`、不含 `to`），`from > to` 时跨午夜环绕，`from === to` 表示全天。本地时间取档位的 `utcOffsetMinutes`（默认 UTC+8），所以机器时区变了方案也不会漂。旧配置里的单个 `{ from, to }` 会自动折算成一段。

设置页把时段按钮放在链的上方：点哪个按钮，上下箭头改的就是**那个时段**的链；点 `默认顺序` 改的是没有命中任何时段时用的链。新建时段时以当前链的一份副本作为起点。

## 设置页

只有三个标签：

- **路由链** —— 一个档位一张卡片，卡片头部即展开/收起。卡片内部用分隔线分成三块：**路由链**、**时间段**、**策略**。没有「当前选中档位」这个概念：每个设置都在它所属的卡片里，改动不可能落到你没在看的那个档位上。
- **实时状态** —— 每条路由的冷却与失败计数、粘性会话、请求计数、**试一次**，以及 `host vX.Y.Z` 那行。它故意不在路由链页：编辑链的时候不该有一张每两秒跳一次的表在旁边。
- **JSON** —— 完整配置，可直接改，应用后回填表单。

**保存** 随时可点，返回的是真正写进去的那份配置，随后再用服务器刷新页面。**撤销** 是保存的本地逆运算：丢弃未保存的改动、回到上次保存的配置，不发请求。写入走 `settings.replace(ns, value, revision)`，一个过期的标签页会拿到 `409`，而不是覆盖别人刚保存的内容。

## 设置存在哪里

配置就在 bundle 插入的那条 profile patch 行里，设置页也写回那里：

```yaml
- id: llm-autorouter
  name: dsh-autorouter
  config:
    enabled: true
    profiles:
      - id: auto
        name: Auto
        chain: [ … ]
        policy: { maxSwitches: 8, cooldownMs: 300000, sticky: true, … }
```

```text
%USERPROFILE%\.dsh\profiles\<profile>\cordis.patch.yml     ($DSH_HOME/profiles/<profile>/cordis.patch.yml)
```

- 行 id 是 `llm-autorouter`；bundle 自带的 patch 以 `include:llm-autorouter` 插入这一行，宿主按 `llm-autorouter`、`include:llm-autorouter`、`*:llm-autorouter` 依次匹配，而不是硬编码一个名字。
- 配置 schema 必须保持 `volatile`（`z.object({…}).extra('volatile', true)`）。`settings.describe()` 只投影带 volatile 字段的配置；没有它这一项会被整个跳过，保存时报 `no profile entry`。
- JSON 标签是手改文档的逃生口：AutoRouter 不认识的字段会被保留，非法路由由 `normalizeConfig` 丢弃而不是让走查崩掉。
- 冷却、计数与粘性会话都是**进程内**的：重启清零，而且它们描述的是本机看到的失败，不是上游真实配额。

## 配置参考

| 设置 | 位置 | 说明 |
| --- | --- | --- |
| `profiles[].id` | 配置 | 就是模型 id：`autorouter/<id>`，也是选择器里显示的名字 |
| `profiles[].chain[]` | 配置 | 有序路由；`provider` + `model` 必须存在于宿主。`cooldownMs` 与 `effortMap` 按路由设置 |
| `profiles[].policy.maxSwitches` | 配置 | 一步之内的切换上限，到点停下而不是循环 |
| `policy.cooldownMs` / `cooldownJitterRatio` | 配置 | 记账后的冷却，以及可选的抖动，避免多条路由同时回来 |
| `policy.sticky` / `stickinessTtlMs` | 配置 | 会话粘性与钉住的有效期，过期后重新选路 |
| `policy.triggerCodes` / `triggerStatuses` | 配置 | 什么算「切下一条」；其余原样转发 |
| `policy.honorRetryAfter` / `retryOnNetwork` | 配置 | 上游 `Retry-After`，以及传输失败是否可重试 |
| `policy.effortPolicy` / `contextPolicy` | 配置 | `clamp` / `drop` / `fail`；对外公布窗口取 `min` / `max` |
| `policy.timeWindows[]` | 配置 | `{ id, label, ranges[], utcOffsetMinutes, order[] }`；`order` 是该时段的完整链 |
| `/api/autorouter/*` | 宿主 | 页面用的同源 HTTP 面；在 DSH 已有端口上 `auth: 'required'` |

## 实现方式

- **适配器** —— `src/adapter.js` 继承 `LlmAdapter`，注册唯一的 provider `autorouter`。`listModels` 每个档位返回一行，`resolveModel` 用链拼出虚拟模型信息（effort 并集、已知最小上下文窗口、保守的 `toolUpdate`），`stream` 把请求交给走查。
- **走查** —— `src/router/walk.js` 遍历候选，每次尝试都是对真实 provider 的一次嵌套 `llm.stream()`，缓存 `usage`，只在「还没有任何输出」时重试；保险丝、参数修复与 replay 信封都在这里。
- **判定** —— `src/router/classify.js` 依据触发集合、状态码与 DSH 的请求级错误码，把终态结果判成切换/跳过/转发（请求太大不是路由坏了）。
- **强度** —— `src/router/effort.js` 求并集、折算单次尝试的 effort，并报告折算原因，让对话能解释一次被丢掉的 `max`。
- **状态** —— `src/state.js` 持有冷却、失败窗口、计数与会话钉住，全部在进程内、可丢弃。
- **HTTP 与客户端** —— `src/http.js` 提供 `/api/autorouter/{state,config,catalog,probe,cooldown,selection,try}`，`index.js` 装配适配器、路由与设置行，`client.js` 注册设置分区与导航图标。

`src/config.js`、`src/state.js`、`src/router/*` 不 import `@deepseek-ai/*`，因此路由核心可以脱离 DSH 运行与测试；`test/plugin.test.js` 为集成路径桩掉 peer，`test/client-render.test.js` 用一套极小的 React double 渲染真实页面。

## 排错

### 保存后页面又显示回旧值

页面在保存后会向宿主再要一次配置，而旧宿主是从一个落后于写入的投影里回答的。`0.1.9` 修掉了：保存的响应直接带上真正写进去的配置，页面之后不再用重新拉取的草稿覆盖它。如果仍然出现，看 `host vX.Y.Z` 那行——低于 `0.1.9` 的宿主跑的还是旧代码。

### 保存时报 `no profile entry "llm-autorouter"`

`settings.describe()` 里没有这个插件对应的项，写入无处可落。按可能性排序：

- 正在跑的宿主低于 `0.1.2`，也就是配置 schema 被打成 volatile 的那个版本；
- bundle 装了但这个 profile 里没启用。

更新后重启 DSH，并在 **设置 → 插件** 里确认该行已启用。

### 模型选择器里没有 `AutoRouter`

适配器由宿主侧在启动时注册。重启 DSH 并刷新页面；只刷新页面注册不了 provider。若仍然没有，用 `cordis_inspect` 查 `llm` 服务的 provider 列表里是否出现 `autorouter`。

### 路由链页说「还没有档位」

这是出货默认值：全新安装不路由任何东西。用 **+ 新建档位** 加路由再保存。升级永远不会改写已存在的配置。

### 试一次 返回 404

`/api/autorouter/try` 这条路由只在 `0.1.10` 之后存在。把 DSH 重启到当前版本；页面会明确提示这种情况，而不是给一个笼统的失败。

### 某条路由报 `UNSUPPORTED_REASONING_EFFORT`

`0.1.12` 已修：目标接不住的 effort 会被丢弃（或 clamp）而不是转发，仍然被拒的会在去掉参数后对同一路由重试一次。如果你在较新版本上还看到它，说明该档位的 `effortPolicy` 是 `fail`——那是设置在按你的意愿拒绝这次调用。

### 某条路由一直在冷却

冷却是按路由、按进程的。**实时状态** 页显示剩余时间并能单独清掉；重启会清空全部。它不持久化，所以升级或重启不会继承一个陈旧的冷却。

## 已知限制

- 助手消息来源记为 `autorouter/<档位>`，因此 DSH 不会保留上游的 `replayState`：每轮重发完整历史，上游 prompt cache 仍有帮助，但 replay 型适配器拿不到增量。要保住它需要「按路由打标签的信封 + 改写 source」，而目前的宿主契约没有暴露这一层。
- 冷却、计数与粘性钉住都在进程内：重启从零开始，数字是本机体验而不是上游配额账本。
- catalog 只列出 DSH 已登记的模型，不做联网发现，所以一个不常用但仍然登记着的 provider 依然可选。
- 模型选择器显示 `AutoRouter / <档位>`；档位 id 就是模型 id，改档位 id 就等于改会话要请求的模型。
- 没有 HTTP 门面：AutoRouter 是原生适配器，不是 OpenAI 兼容端点。让非 DSH 客户端共用同一条链的 `baseURL` 网关是另一套设计（`DESIGN.md` 第 9 节），尚未实现。

## 许可

MIT，见 [LICENSE](../LICENSE)。

## 致谢

构建在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [Cordis](https://github.com/cordiverse/cordis) 之上。失败切换的契约刻意沿用 `dsh-llm-fallbacks` 已经确立的那一套——只在输出前切换、给失败记账、绝不重启半截的回答——这样无论选择器里放的是哪个路由器，会话行为都一致。

设计说明、本插件所依赖的宿主契约与失败矩阵见 [DESIGN.md](../DESIGN.md)；版本历史见 [CHANGELOG.md](../CHANGELOG.md)。
