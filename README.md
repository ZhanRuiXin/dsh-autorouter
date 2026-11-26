# AutoRouter (`dsh-autorouter`)

一个 DSH 插件：把**已经登记在 DSH 里的** provider/model 聚合成一个虚拟 provider
`AutoRouter`，DSH 侧只看到 `autorouter` 一条路由。

它不代理 HTTP，也不接管密钥。每个上游尝试都通过 DSH 自己的 `llm.stream()` 派发，
所以各家的方言、凭据、图片/附件、工具历史与 replay state 仍由原来的适配器处理。

```
DSH ──► autorouter/<profile> ──► 回退链
                                  ├─ opendesign/deepseek-v4.1-flash-eco
                                  ├─ commandcode/deepseek/deepseek-v4.1-flash
                                  └─ deepseek-account/deepseek-flash
```

## 能力

- **一条虚拟路由，多条上游**：`AutoRouter / auto`（可再加 profile，每个 profile 是一条链）。
- **只在首个输出块之前切换**：`block-start`、文本、思考、工具调用增量都会提交本次尝试；
  提交后失败原样转发，不再换路由。`usage` 不提交，但会缓存并在切换前补发，花费不丢。
- **每路由额度与冷却**：固定窗口请求数/ token 数、冷却（指数退避 + 抖动 + `Retry-After`）、
  半开恢复；额度耗尽或冷却中的路由不会进候选。
- **会话粘性**：同一 `sessionId` 优先落回上次成功的路由，保住上游 prompt cache；
  会话超过 TTL 或该路由失败后才重新选路。
- **思考强度继承**：虚拟模型公布链上所有路由的 effort 并集；每次尝试按
  `effortMap` → 目标 `defaultEffort` → 省略 的顺序折算，默认 clamp（可改 fail/drop）。
  上游报 `UNSUPPORTED_REASONING_EFFORT` 时，去掉该参数对同一路由重试一次。
- **能力取交集/保守值**：输入模态取交集，上下文窗口取已知最小值，`toolUpdate` 只要有
  一个路由要求 `addition-only` 就声明 `addition-only`。

## 安装

本仓库通过 `link:` 安装进 profile：

```jsonc
// C:\Users\ADMIN\.dsh\profiles\desktop\package.json
"dependencies": { "dsh-autorouter": "link:E:/Repositories/Deepseek Harness/auto-provider-router" },
"dsh": { "profile": { "bundles": [ /* … 其他 bundle … */, "dsh-autorouter" ] } }
```

DSH 只在插件声明了 `peerDependencies` 时才会把 `@deepseek-ai/*` 解析到安装目录。
本包因此声明了 `@deepseek-ai/schemastery` 与 `@deepseek-ai/dsh-llm`；漏掉它们时
进程会报 `Cannot find package '@deepseek-ai/schemastery'`，插件行停在 `inactive`
（`cordis_inspect` 的 Config 状态不会是 `schema`）。

设置页出现的硬性条件在 schema 上，不在 profile 行上。`settings.describe()` 只投影
带 `meta.volatile` 的配置：`volatileForm()` 在整棵 schema 里找不到 volatile 字段时
返回 `undefined`，该行就被整个跳过，保存时报 `no profile entry`。所以 `Config` 必须
标成活的：

```js
export const Config = z.object({ /* … */ }).extra('volatile', true)
```

bundle 自带的 patch 插入的行 id 是 `include:llm-autorouter`，而 `describe()` 的 `ns`
沿用这个 id；宿主侧因此按 `llm-autorouter`、`include:llm-autorouter`、
`*:llm-autorouter` 依次匹配，而不是硬编码一个名字。profile 里再补一条同名行不是必需，
但可以覆盖默认 `config`：

```yaml
- id: llm-autorouter
  name: dsh-autorouter
  config: {}
```

装好后（或改了文件后）对插件行触发一次重组即可：`plugin_manager set_plugin { target: "include:llm-autorouter", enabled: true }`。
这只重组 bundle 行；宿主机 JS 的改动仍要重启进程才会生效，client bundle 刷新页面即可。
重启 DSH 后：

1. 设置 → **AutoRouter** 出现设置页；
2. 模型选择器出现 `AutoRouter / auto`；
3. 选择它，或把 `agent-default-model` 指到 `{ provider: "autorouter", model: "auto" }`。

## 设置页

- **Routes**：增删 profile、增删/排序/启停路由；从已登记 provider 与模型里选；
  `Probe` 只做元数据可达性检查（列模型 + 解析模型信息），不发真实请求。
- **Policy**：`maxSwitches`、冷却与退避、粘性 TTL、失败窗口、effort/context 策略、
  触发错误码与状态码，以及**时间段**（峰值/低谷重排，见下）。
- **JSON**：直接编辑完整配置再回填表单。

页面通过同源 `/api/autorouter/*` 与宿主通信，配置写入仍走
`settings.replace(ns, value, revision)`，因此有版本冲突保护（409 时提示重载）。

## 配置

配置存放在 profile 行 `llm-autorouter` 的 `config` 里，由设置页写回。
归一化入口是 `src/config.js` 的 `normalizeConfig`：所有数值有边界，非法/自指/重复路由会被丢弃，
每个 profile 至少要有一条链。

```jsonc
{
  "enabled": true,
  "debug": false,
  "profiles": [{
    "id": "auto", "name": "Auto", "enabled": true,
    "policy": { "maxSwitches": 8, "cooldownMs": 300000, "sticky": true,
                "effortPolicy": "clamp", "contextPolicy": "min",
                "timeWindows": [
                  { "id": "offpeak", "label": "低谷", "from": "00:30", "to": "08:30",
                    "order": ["deepseek-account/deepseek-flash"] }
                ] },
    "chain": [
      { "id": "od", "provider": "opendesign", "model": "deepseek-v4.1-flash-eco",
        "cooldownMs": 300000 },
      { "id": "cc", "provider": "commandcode", "model": "deepseek/deepseek-v4.1-flash",
        "cooldownMs": 300000 },
      { "id": "ds", "provider": "deepseek-account", "model": "deepseek-flash",
        "cooldownMs": 300000 }
    ]
  }]
}
```

## 选路顺序

链数组就是尝试顺序：从头到尾，第一条可用路由获胜；没有加权轮换，也没有质量/成本打分。
一次尝试只有在**输出前**失败、且错误码或状态码命中触发条件时才会切到下一条；
一旦收到第一个内容块，失败会原样上报，不再切换。

**时间段**只做重排、不做过滤：命中当前本地时间（默认 UTC+8）的窗口会把 `order` 里列出的
路由键排到最前面，其余路由保持链上的相对顺序。设置页提供「DeepSeek 峰谷」一键预设：
00:30–08:30 让 `deepseek-account/*` 优先，08:30–00:30 让其余路由优先。

## 宿主接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/autorouter/state` | revision、脱敏配置、运行时状态（冷却/额度/统计/粘性会话） |
| GET/PUT | `/api/autorouter/config` | 读/写配置；PUT 带 `{value, revision}` |
| GET | `/api/autorouter/catalog` | 已登记的 provider 与模型（排除 `autorouter`） |
| POST | `/api/autorouter/probe` | `{provider, model}` 元数据可达性检查 |
| POST | `/api/autorouter/cooldown` | `{key}` 清除单条冷却，`{}` 清全部 |
| GET | `/api/autorouter/selection` | 当前各 profile 的候选顺序与阻塞原因 |

全部路由 `auth: 'required'`，监听在 DSH 已有的端口上，不新开 listener。

## 已知限制

- 助手消息的来源记为 `autorouter/<profile>`，上游的 `replayState` 因此不会被 DSH 保留；
  每轮会重发完整历史（上游 prompt cache 仍有帮助，但 replay 型适配器拿不到增量）。
- 额度账本是进程内的，重启 DSH 后清零；它约束的是本机路由，不是上游真实额度。
- catalog 只反映 DSH 已登记的模型，不做联网探测。

## 开发

```bash
node --test "test/*.test.js"
```

`src/config.js`、`src/state.js`、`src/router/*` 不依赖 `@deepseek-ai/*`，可以脱离 DSH 单测。
`test/plugin.test.js` 用 `test/stubs/hooks.mjs` 把 `@deepseek-ai/dsh-llm` 与
`@deepseek-ai/schemastery` 映射到本地桩，因此 `apply()`、六个 HTTP 路由的收发
（含 409 revision 冲突）和 `client.js` 的注册形状也能在纯 Node 下验证。
真实页面渲染与一次真实补全仍要在 DSH 里确认。
