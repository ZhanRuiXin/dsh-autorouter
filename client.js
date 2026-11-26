/**
 * AutoRouter settings page.
 *
 * Seat: `settings.section` (id "autorouter", order 16). It talks to the host
 * half over same-origin JSON under `/api/autorouter` — no `remote.settings`
 * dependency, so the page keeps working on any DSH build that serves the
 * plugin's routes.
 *
 * No build step: this file is loaded verbatim by the ModuleLoader.
 */

window.__ModuleLoader__.load({
  id: 'dsh-autorouter',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useRef } = React

    const NS = 'settings.autorouter'
    const EFFORTS = ['off', 'minimal', 'low', 'medium', 'high', 'max']
    
    const CSS = `
.ar-root{display:flex;flex-direction:column;gap:14px;padding:2px 2px 40px;font-size:13px;line-height:1.45;color:inherit;max-width:900px}
.ar-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.ar-title{margin:0;font-size:16px;font-weight:600}
.ar-sub{margin:3px 0 0;opacity:.62;font-size:12px}
.ar-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ar-btn{border:1px solid rgba(128,128,128,.32);background:rgba(128,128,128,.08);color:inherit;border-radius:7px;padding:4px 10px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
.ar-btn:hover:not([disabled]){background:rgba(128,128,128,.17)}
.ar-btn[disabled]{opacity:.42;cursor:not-allowed}
.ar-btn.primary{background:#3b82f6;border-color:#3b82f6;color:#fff}
.ar-btn.primary:hover:not([disabled]){background:#2f6fd8}
.ar-btn.danger{color:#e5484d;border-color:rgba(229,72,77,.40)}
.ar-btn.tiny{padding:1px 7px;font-size:11px;border-radius:5px}
.ar-card{border:1px solid rgba(128,128,128,.22);border-radius:10px;padding:11px 12px;background:rgba(128,128,128,.035);display:flex;flex-direction:column;gap:9px}
.ar-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;cursor:pointer;min-height:24px;padding:2px 0;margin:-2px 0}
.ar-card-head:hover .ar-chevron{opacity:1}
.ar-card-body{display:flex;flex-direction:column;gap:9px}
.ar-chevron{all:unset;cursor:pointer;width:15px;flex:0 0 auto;padding:5px 0;text-align:center;font-size:12px;line-height:1;opacity:.62}
.ar-chevron:hover{opacity:1}
.ar-chevron:focus-visible{outline:2px solid rgba(59,130,246,.60);border-radius:4px}
.ar-card-title{font-weight:600;font-size:13px}
.ar-muted{opacity:.60}
.ar-hint{opacity:.55;font-size:11.5px}
.ar-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.ar-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px 12px}
.ar-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.ar-label{font-size:11.5px;opacity:.68}
.ar-input,.ar-select{background:rgba(128,128,128,.08);border:1px solid rgba(128,128,128,.30);color:inherit;border-radius:6px;padding:3px 6px;font:inherit;font-size:12px;min-width:0}
.ar-root{color-scheme:inherit}
.ar-root[data-scheme="dark"]{color-scheme:dark}
.ar-root[data-scheme="light"]{color-scheme:light}
.ar-select option{background:#ffffff;color:#1c1c1c}
.ar-root[data-scheme="dark"] .ar-select option{background:#242424;color:#eaeaea}
.ar-textarea{color-scheme:inherit}
.ar-input:focus,.ar-select:focus{outline:2px solid rgba(59,130,246,.45);outline-offset:0}
.ar-input.num{width:82px}
.ar-input.wide{width:100%}
.ar-select.grow{flex:1;min-width:130px}
.ar-check{display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;user-select:none;white-space:nowrap}
.ar-chain{border:1px solid rgba(128,128,128,.16);border-radius:8px;overflow:hidden}
.ar-entry{display:flex;flex-direction:column;gap:7px;padding:8px 9px;border-top:1px solid rgba(128,128,128,.16)}
.ar-entry:first-child{border-top:none}
.ar-entry.off{opacity:.52}
.ar-entry-main{display:flex;align-items:center;gap:7px;flex-wrap:wrap}
.ar-dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex:none}
.ar-badge{font-size:10.5px;padding:0 6px;border-radius:99px;border:1px solid rgba(128,128,128,.30);opacity:.75;white-space:nowrap}
.ar-badge.warn{color:#b7791f;border-color:rgba(183,121,31,.45)}
.ar-badge.bad{color:#e5484d;border-color:rgba(229,72,77,.45)}
.ar-badge.ok{color:#2f9e44;border-color:rgba(47,158,68,.40)}
.ar-table{width:100%;border-collapse:collapse;font-size:12px}
.ar-table th{text-align:left;font-weight:500;opacity:.55;padding:3px 6px;border-bottom:1px solid rgba(128,128,128,.20);white-space:nowrap}
.ar-table td{padding:4px 6px;border-bottom:1px solid rgba(128,128,128,.12);vertical-align:top}
.ar-banner{border-radius:8px;padding:7px 10px;font-size:12px;border:1px solid transparent}
.ar-banner.err{background:rgba(229,72,77,.10);border-color:rgba(229,72,77,.35);color:#e5484d}
.ar-banner.ok{background:rgba(47,158,68,.10);border-color:rgba(47,158,68,.32);color:#2f9e44}
.ar-banner.info{background:rgba(59,130,246,.08);border-color:rgba(59,130,246,.28)}
.ar-tabs{display:flex;gap:2px;border-bottom:1px solid rgba(128,128,128,.22)}
.ar-tab{border:none;background:none;color:inherit;opacity:.55;font:inherit;font-size:12.5px;padding:6px 11px;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.ar-tab.on{opacity:1;border-bottom-color:#3b82f6}
.ar-json{width:100%;min-height:420px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:1.5;background:rgba(128,128,128,.07);border:1px solid rgba(128,128,128,.28);color:inherit;border-radius:8px;padding:9px;resize:vertical}
.ar-details summary{cursor:pointer;font-size:11.5px;opacity:.62;user-select:none}
.ar-details[open] summary{opacity:.85}
.ar-details[open]>.ar-stack,.ar-details[open]>.ar-window,.ar-details[open]>.ar-hint,.ar-details[open]>.ar-muted,.ar-details[open]>.ar-row{margin-top:7px}
.ar-stack{display:flex;flex-direction:column;gap:8px}
.ar-window{display:flex;flex-direction:column;gap:6px;padding:8px;border:1px solid rgba(128,128,128,.16);border-radius:8px}
.ar-section{display:flex;flex-direction:column;gap:8px;padding-top:10px;border-top:1px solid rgba(128,128,128,.18);margin-top:1px}
.ar-card-body>.ar-section:first-child{padding-top:0;border-top:none}
.ar-section-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-height:22px}
.ar-section-head.clickable{cursor:pointer}
.ar-section-head:hover .ar-chevron{opacity:1}
.ar-section-title{font-size:12px;font-weight:600;letter-spacing:.01em}
.ar-section-actions{display:flex;align-items:center;gap:6px;margin-left:auto}
.ar-section-body{display:flex;flex-direction:column;gap:8px}
.ar-order-tabs{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.ar-order-preview{font-size:11.5px;line-height:1.5;word-break:break-word}
`

    const ZH = {
      nav: 'AutoRouter',
      title: 'AutoRouter 聚合路由',
      subtitle: '一个 provider、一条回退链：严格按顺序在已登记的 provider / model 之间尝试，失败才往后走，思考强度按目标映射。',
      enabled: '启用 AutoRouter',
      save: '保存',
      saving: '保存中…',
      saveHint: '立即写入配置；已生效的档位会被新配置替换',
      undo: '撤销',
      undoHint: '放弃未保存的改动，回到上次保存的配置',
      reverted: '已撤销未保存的改动',
      dirty: '有未保存的改动',
      saved: '已保存，新配置已生效',
      duplicateProfile: '档位 id 不能重复，否则保存时会丢掉其中一个档位',
      profileIdRequired: '档位 id 不能为空',
      failed: '保存失败',
      conflict: '配置已被其他窗口修改。载入服务器版本后重试。',
      retry: '重试',
      loading: '载入中…',
      unavailable: '无法读取 AutoRouter 状态',
      routes: '路由链',
      policy: '策略',
      json: 'JSON',
      profile: '档位',
      routesHint: '每个档位一张卡片：标识、路由链、时间段与策略都在里面。',
      addProfile: '新建档位',
      removeProfile: '删除档位',
      profileId: '标识',
      profileName: '显示名',
      profileDisabled: '已停用',
      profileEmpty: '空链',
      chain: '回退顺序',
      chainHint: '从上到下依次尝试；勾选控制是否参与。顺序即优先级，冷却中的路由会被跳过。',
      addRoute: '添加路由',
      add: '添加',
      provider: 'Provider',
      model: 'Model',
      cooldownMin: '冷却（分钟）',
      effortMap: '思考强度映射',
      effortInherit: '继承',
      effortDrop: '丢弃',
      test: '探测',
      testing: '探测中…',
      testOk: '可达',
      testBad: '不可达',
      up: '上移',
      down: '下移',
      remove: '删除',
      policyHint: '这些策略只作用于本档位。',
      timeWindows: '时间段',
      addWindow: '添加时段',
        collapseCard: '收起',
      expandCard: '展开',
      timeWindowHint: '每个时段有自己的回退链：在「回退链」里切到该时段，用上下箭头调整顺序。',
      noWindows: '未设置时段，始终按链顺序尝试。',
      windowLabel: '名称',
      windowOrderHint: '本时段的回退顺序',
      addRange: '时间段',
      removeRange: '删除这个时间段',
      removeWindow: '删除时段',
      rangeHint: '同一时段可以有多个不连续的时间段，命中任意一段都算。',
      defaultOrder: '默认顺序',
      orderTabHint: '正在编辑该时段的回退顺序：上下箭头只改这个时段，未列出的路由仍然排在最后兜底。',
      orderEditHint: '在「回退链」上方的时段按钮里调整顺序。',
      noRoutes: '尚未添加路由',
      sticky: '会话粘性',
      stickyHint: '同一会话尽量复用上一次成功的路由，保护提示缓存。',
      stickinessTtl: '粘性 TTL（分钟）',
      maxSwitches: '单步最大切换',
      cooldown: '失败冷却（分钟）',
      jitter: '冷却抖动比例',
      recovery: '恢复策略',
      recoveryTimer: '定时半开',
      recoveryNever: '永不恢复',
      failureWindow: '失败窗口（分钟）',
      failureThreshold: '失败阈值',
      backoff: '退避基数（毫秒）',
      backoffMax: '退避上限（毫秒）',
      honorRetryAfter: '遵从 Retry-After',
      retryNetwork: '网络错误也重试',
      effortPolicy: '思考强度策略',
      effortPolicyClamp: '收敛（clamp）',
      effortPolicyDrop: '丢弃（drop）',
      effortPolicyFail: '报错（fail）',
      contextPolicy: '上下文窗口策略',
      contextMin: '取最小值（保守压缩）',
      contextMax: '取最大值',
      defaultContext: '未知窗口默认值',
      triggerCodes: '触发切换的错误码',
      triggerCodesHint: '逗号分隔，例如 AUTH,QUOTA,RATE_LIMIT',
      triggerStatuses: '触发切换的 HTTP 状态',
      triggerStatusesHint: '逗号分隔，例如 429,500,503',
      timezone: '时区',
      utcOffset: 'UTC 偏移（分钟）',
      advanced: '高级',
      jsonHint: '整份配置的权威视图。保存时由宿主再次校验并裁剪越界值。',
      applyJson: '应用到表单',
      jsonError: 'JSON 解析失败',
      status: '实时状态',
      stats: '尝试 / 成功 / 失败 / 切换',
    hostVersionHint: '页面与新宿主一致；版本不一致说明宿主还没重启',
    hostVersionUnknown: '宿主没有报告版本，说明运行的还是旧代码',
      lastRoute: '最近路由',
      noSessions: '当前没有固定会话',
      session: '会话',
      age: '距今',
      health: '健康',
      cooling: '冷却中',
      cooled: '冷却',
      healthy: '正常',
      failures: '失败',
      tokens: 'Token',
      clearCooldown: '清除冷却',
      clearAll: '全部清除',
      refresh: '刷新',
    tryOnce: '试一次',
    tryOk: '打通',
    tryFailed: '未打通',
    tryOutdated: '宿主还没重启：这条检查要新版本才有',
      emptyChain: '链路为空。至少添加一条路由后才能接管调用。',
      entryInvalid: 'provider / model 不能为空',
    }

    const EN = {
      nav: 'AutoRouter',
      title: 'AutoRouter gateway',
      subtitle: 'One provider, one fallback chain: try registered providers and models strictly in order, move on only after a failure, and map reasoning effort per target.',
      enabled: 'Enable AutoRouter',
      save: 'Save',
      saving: 'Saving…',
      saveHint: 'Write the config now; the running profiles pick it up immediately',
      undo: 'Undo',
      undoHint: 'Drop unsaved edits and go back to the last saved config',
      reverted: 'Unsaved edits dropped',
      dirty: 'Unsaved changes',
      saved: 'Saved. The new config is live.',
      duplicateProfile: 'Profile ids must be unique, or saving drops one of them.',
      profileIdRequired: 'A profile id cannot be empty.',
      failed: 'Save failed',
      conflict: 'This config was changed in another window. Load the server version first.',
      retry: 'Retry',
      loading: 'Loading…',
      unavailable: 'Cannot read AutoRouter state',
      routes: 'Chain',
      policy: 'Policy',
      json: 'JSON',
      profile: 'Profile',
      routesHint: 'One card per profile: identity, chain, time windows and policy all live inside it.',
      addProfile: 'New profile',
      removeProfile: 'Delete profile',
      profileId: 'Id',
      profileName: 'Name',
      profileDisabled: 'disabled',
      profileEmpty: 'empty',
      chain: 'Fallback order',
      chainHint: 'Tried top to bottom. Check to include. Position is priority; a cooling route is skipped.',
      addRoute: 'Add route',
      add: 'Add',
      provider: 'Provider',
      model: 'Model',
      cooldownMin: 'Cooldown (min)',
      effortMap: 'Effort map',
      effortInherit: 'inherit',
      effortDrop: 'drop',
      test: 'Probe',
      testing: 'Probing…',
      testOk: 'reachable',
      testBad: 'unreachable',
      up: 'Up',
      down: 'Down',
      remove: 'Remove',
      policyHint: 'Applies to this profile only.',
      timeWindows: 'Time windows',
      addWindow: 'Add window',
        collapseCard: 'Collapse',
      expandCard: 'Expand',
      timeWindowHint: 'Each window has its own fallback chain: switch to it in the chain tabs and reorder with the arrows.',
      noWindows: 'No windows configured; the chain order always applies.',
      windowLabel: 'Label',
      windowOrderHint: 'Fallback order in this window',
      addRange: 'Segment',
      removeRange: 'Remove this segment',
      removeWindow: 'Remove window',
      rangeHint: 'One window may cover several disjoint stretches; any of them keeps it active.',
      defaultOrder: 'Default order',
      orderTabHint: 'Editing this window’s own fallback order: the arrows change this window only, and routes it omits still run last.',
      orderEditHint: 'Reorder it from the window buttons above the chain.',
      noRoutes: 'No routes yet',
      sticky: 'Session stickiness',
      stickyHint: 'Reuse the last successful route for a session to protect the prompt cache.',
      stickinessTtl: 'Stickiness TTL (min)',
      maxSwitches: 'Max switches per step',
      cooldown: 'Cooldown after failure (min)',
      jitter: 'Cooldown jitter ratio',
      recovery: 'Recovery',
      recoveryTimer: 'Half-open on timer',
      recoveryNever: 'Never',
      failureWindow: 'Failure window (min)',
      failureThreshold: 'Failure threshold',
      backoff: 'Backoff base (ms)',
      backoffMax: 'Backoff cap (ms)',
      honorRetryAfter: 'Honor Retry-After',
      retryNetwork: 'Retry network errors',
      effortPolicy: 'Effort policy',
      effortPolicyClamp: 'Clamp',
      effortPolicyDrop: 'Drop',
      effortPolicyFail: 'Fail',
      contextPolicy: 'Context window policy',
      contextMin: 'Minimum (conservative compaction)',
      contextMax: 'Maximum',
      defaultContext: 'Default when unknown',
      triggerCodes: 'Trigger error codes',
      triggerCodesHint: 'Comma separated, e.g. AUTH,QUOTA,RATE_LIMIT',
      triggerStatuses: 'Trigger HTTP statuses',
      triggerStatusesHint: 'Comma separated, e.g. 429,500,503',
      timezone: 'Time zone',
      utcOffset: 'UTC offset (min)',
      advanced: 'Advanced',
      jsonHint: 'The authoritative view of the whole config. The host re-validates and bounds it on save.',
      applyJson: 'Apply to form',
      jsonError: 'JSON parse failed',
      status: 'Live status',
      stats: 'attempts / successes / failures / switches',
    hostVersionHint: 'page and host agree; a mismatch means the host was not restarted',
    hostVersionUnknown: 'the host reports no version, so it is still running the old code',
      lastRoute: 'Last route',
      noSessions: 'No pinned sessions',
      session: 'Session',
      age: 'age',
      health: 'Health',
      cooling: 'cooling',
      cooled: 'cooled',
      healthy: 'healthy',
      failures: 'failures',
      tokens: 'tokens',
      clearCooldown: 'Clear cooldown',
      clearAll: 'Clear all',
      refresh: 'Refresh',
    tryOnce: 'Try once',
    tryOk: 'worked',
    tryFailed: 'failed',
    tryOutdated: 'the host has not been restarted: this check needs the new build',
      emptyChain: 'The chain is empty. Add at least one route before it can take over.',
      entryInvalid: 'provider / model must not be empty',
    }

    function minutesToClock(value) {
      if (typeof value === 'string') {
        const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
        if (match === null) return ''
        return `${match[1].padStart(2, '0')}:${match[2]}`
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) return ''
      const total = ((Math.round(value) % 1440) + 1440) % 1440
      return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
    }

    /** `HH:MM` or minutes → minutes, so window edges compare as numbers. */
    function clockToMinutes(value) {
      if (typeof value === 'number' && Number.isFinite(value)) return ((Math.round(value) % 1440) + 1440) % 1440
      if (typeof value !== 'string') return 0
      const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
      if (match === null) return 0
      return (Number(match[1]) * 60 + Number(match[2])) % 1440
    }

    /** Same rule as the host: `from === to` means all day, wrap-around included. */
    function rangeMatches(range, minutes) {
      const from = clockToMinutes(range.from)
      const to = clockToMinutes(range.to)
      if (from === to) return true
      return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to
    }

    /**
     * A window may be spread over several disjoint stretches (e.g. 00:30–08:30
     * and 22:00–23:30); it is active when any of them matches.
     */
    function windowMatches(window, utcOffsetMinutes) {
      const shifted = new Date(Date.now() + (utcOffsetMinutes ?? 480) * 60_000)
      const minutes = shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
      const ranges = Array.isArray(window.ranges) ? window.ranges : [{ from: window.from, to: window.to }]
      return ranges.some((range) => rangeMatches(range, minutes))
    }

    /** `00:30–08:30`, or `00:30–08:30 · 22:00–23:30` for a multi-range window. */
    function windowCaption(window) {
      if (typeof window.label === 'string' && window.label.trim() !== '') return window.label.trim()
      const ranges = Array.isArray(window.ranges) ? window.ranges : [{ from: window.from, to: window.to }]
      return ranges.map((range) => `${minutesToClock(range.from)}–${minutesToClock(range.to)}`).join(' · ')
    }

    /** The window's ranges, normalized for editing, including the legacy shape. */
    function windowRanges(window) {
      const ranges = Array.isArray(window.ranges) ? window.ranges : [{ from: window.from, to: window.to }]
      return ranges.map((range) => ({ from: minutesToClock(range.from) || '00:00', to: minutesToClock(range.to) || '00:00' }))
    }

    /**
     * A window's order is a complete chain: keys it lists come first in that
     * order, routes it does not list keep their configured order behind them.
     * Same rule the host applies, so the page shows what the host will do.
     */
    function orderByKeys(chain, order) {
      const rank = new Map((order ?? []).map((key, index) => [key, index]))
      const rankOf = (entry) => {
        const key = `${entry.provider}/${entry.model}`
        return rank.has(key) ? rank.get(key) : rank.has(entry.id) ? rank.get(entry.id) : undefined
      }
      return [...chain].sort((left, right) => {
        const leftRank = rankOf(left)
        const rightRank = rankOf(right)
        if (leftRank !== undefined && rightRank !== undefined) return leftRank - rightRank
        if (leftRank !== undefined) return -1
        if (rightRank !== undefined) return 1
        return 0
      })
    }

    const S = {
      dot: (color) => ({ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block', flex: 'none' }),
      grow: { flex: 1, minWidth: 0 },
      right: { marginLeft: 'auto' },
      tableWrap: { overflowX: 'auto' },
    }

    async function api(path, init) {
      const response = await fetch(path, {
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        cache: 'no-store',
        ...init,
      })
      let body = {}
      try {
        body = await response.json()
      } catch {
        body = {}
      }
      if (!response.ok) {
        const error = new Error(body?.error || `HTTP ${response.status}`)
        error.status = response.status
        error.body = body
        throw error
      }
      return body
    }

    const num = (value, fallback = 0) => {
      const parsed = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(parsed) ? parsed : fallback
    }
    const splitList = (text) =>
      String(text ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '')
    const fmtAge = (ms) => {
      const seconds = Math.max(0, Math.round(num(ms) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.round(seconds / 60)
      if (minutes < 60) return `${minutes}m`
      return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`
    }

    /**
     * Native select popups are painted by the browser, so they follow the
     * element's `color-scheme`, not our CSS. Prefer an explicit scheme declared
     * by the host, then its dark/light marker, then the page's actual paint,
     * then the OS preference.
     */
    function backgroundLuminance(element) {
      if (element === null || element === undefined) return undefined
      const color = String(getComputedStyle(element).backgroundColor ?? '')
      const match = color.match(/rgba?\(([^)]+)\)/)
      if (match === null) return undefined
      const parts = match[1].split(',').map((part) => Number(part.trim()))
      if (parts.length < 3 || parts.some((part) => !Number.isFinite(part))) return undefined
      if ((parts[3] ?? 1) < 0.5) return undefined
      return (0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]) / 255
    }

    function detectScheme() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return 'light'
      try {
        const root = document.documentElement
        const body = document.body
        const declared = String(getComputedStyle(root).colorScheme ?? '').toLowerCase()
        if (declared.includes('dark') && !declared.includes('light')) return 'dark'
        if (declared.includes('light') && !declared.includes('dark')) return 'light'
        for (const element of [root, body]) {
          if (element === null || element === undefined) continue
          const theme = String(element.getAttribute?.('data-theme') ?? '').toLowerCase()
          if (theme === 'dark') return 'dark'
          if (theme === 'light') return 'light'
          if (element.classList?.contains('dark')) return 'dark'
          if (element.classList?.contains('light')) return 'light'
        }
        // DSH may switch themes without declaring color-scheme or a class we can
        // see. The painted background is the last theme-bearing signal.
        for (const element of [body, root]) {
          const luminance = backgroundLuminance(element)
          if (luminance !== undefined) return luminance < 0.5 ? 'dark' : 'light'
        }
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      } catch {
        return 'light'
      }
    }

    function Field(props) {
      return h(
        'label',
        { className: 'ar-field' },
        h('span', { className: 'ar-label' }, props.label),
        props.children,
        props.hint ? h('span', { className: 'ar-hint' }, props.hint) : null,
      )
    }

    const COLLAPSE_KEY = 'dsh-autorouter:collapsed'

    function readCollapsed() {
      try {
        const raw = window.localStorage?.getItem(COLLAPSE_KEY)
        const parsed = raw ? JSON.parse(raw) : []
        return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [])
      } catch {
        return new Set()
      }
    }

    function writeCollapsed(set) {
      try {
        window.localStorage?.setItem(COLLAPSE_KEY, JSON.stringify([...set]))
      } catch {
        // A sandboxed frame may refuse storage; collapsing still works per render.
      }
    }

    /**
     * A card with a disclosure chevron. Collapse state lives in the page, so a
     * profile card keeps its identity by position rather than by its editable id.
     */
    function Card({ t, open, onToggle, style, head, actions, children }) {
      // The whole head row is the target, not just the chevron: a 15px glyph is
      // a miss-prone click. Controls inside the head keep their own behaviour,
      // which also stops the chevron from toggling twice through bubbling.
      const toggleFromHead = (event) => {
        const target = event?.target
        if (target !== null && typeof target?.closest === 'function' && target.closest('button, input, select, textarea, a, label')) return
        onToggle?.()
      }
      return h(
        'div',
        { className: `ar-card${open ? '' : ' collapsed'}`, style },
        h(
          'div',
          {
            className: 'ar-card-head',
            onClick: toggleFromHead,
            title: open ? t('collapseCard') : t('expandCard'),
          },
          h(
            'button',
            {
              className: 'ar-chevron',
              type: 'button',
              'aria-expanded': open,
              'aria-label': open ? t('collapseCard') : t('expandCard'),
              onClick: onToggle,
            },
            open ? '▾' : '▸',
          ),
          head,
          actions === undefined || actions === null
            ? null
            : h('span', { style: S.right, onClick: (event) => event.stopPropagation() }, actions),
        ),
        open ? h('div', { className: 'ar-card-body' }, children) : null,
      )
    }

    function Toggle(props) {
      return h(
        'label',
        { className: 'ar-check', title: props.title ?? undefined },
        h('input', { type: 'checkbox', checked: !!props.checked, onChange: (event) => props.onChange(event.target.checked) }),
        h('span', null, props.label),
      )
    }

    function Tabs(props) {
      const items = [
        ['routes', props.t('routes')],
        ['status', props.t('status')],
        ['json', props.t('json')],
      ]
      return h(
        'div',
        { className: 'ar-tabs', role: 'tablist' },
        items.map(([id, label]) =>
          h(
            'button',
            {
              key: id,
              role: 'tab',
              'aria-selected': props.tab === id,
              className: `ar-tab${props.tab === id ? ' on' : ''}`,
              onClick: () => props.onTab(id),
            },
            label,
          ),
        ),
      )
    }

    function HealthBadge({ row, t }) {
      const cooling = row.coolingUntil && row.coolingUntil > Date.now()
      if (cooling) return h('span', { className: 'ar-badge bad' }, `${t('cooling')} · ${fmtAge(row.coolingUntil - Date.now())}`)
      if (row.failures > 0) return h('span', { className: 'ar-badge warn' }, `${t('failures')} ${row.failures}`)
      return h('span', { className: 'ar-badge ok' }, t('healthy'))
    }

    function EntryRow({ entry, index, count, profileIndex, t, onChange, onMove, onRemove, onProbe, probe, catalog }) {
      const provider = catalog.providers.find((item) => item.id === entry.provider)
      const models = provider?.models ?? []
      const effortMap = entry.effortMap ?? {}
      const setEffort = (requested, value) => {
        const next = { ...effortMap }
        if (value === '') delete next[requested]
        else if (value === '-') next[requested] = null
        else next[requested] = value
        onChange({ effortMap: next })
      }
      return h(
        'div',
        { className: `ar-entry${entry.enabled === false ? ' off' : ''}` },
        h(
          'div',
          { className: 'ar-entry-main' },
          h('input', {
            type: 'checkbox',
            checked: entry.enabled !== false,
            onChange: (event) => onChange({ enabled: event.target.checked }),
          }),
          h(
            'select',
            {
              className: 'ar-select',
              value: entry.provider,
              onChange: (event) => {
                const nextProvider = event.target.value
                const nextModel = catalog.providers.find((item) => item.id === nextProvider)?.models[0]?.id ?? entry.model
                onChange({ provider: nextProvider, model: nextModel })
              },
            },
            catalog.providers.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            catalog.providers.some((item) => item.id === entry.provider)
              ? null
              : h('option', { value: entry.provider }, entry.provider || '—'),
          ),
          h('span', { className: 'ar-muted' }, '·'),
          h(
            'select',
            {
              className: 'ar-select grow',
              value: entry.model,
              onChange: (event) => onChange({ model: event.target.value }),
            },
            models.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            models.some((item) => item.id === entry.model) ? null : h('option', { value: entry.model }, entry.model || '—'),
          ),
          h(
            'button',
            {
              className: 'ar-btn tiny',
              type: 'button',
              disabled: probe?.busy,
              onClick: () => onProbe(entry),
              title: `${entry.provider}/${entry.model}`,
            },
            probe?.busy ? t('testing') : probe?.result === true ? `${t('testOk')} · ${probe.ms}ms` : probe?.result === false ? t('testBad') : t('test'),
          ),
          h(
            'span',
            { style: S.right },
            h('button', { className: 'ar-btn tiny', type: 'button', disabled: index === 0, onClick: () => onMove(-1), title: t('up') }, '↑'),
            h('button', { className: 'ar-btn tiny', type: 'button', disabled: index === count - 1, onClick: () => onMove(1), title: t('down') }, '↓'),
            h('button', { className: 'ar-btn tiny danger', type: 'button', onClick: onRemove, title: t('remove') }, '✕'),
          ),
        ),
        h(
          'div',
          { className: 'ar-entry-main' },
          h(
            Field,
            { label: t('cooldownMin') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              step: 0.5,
              value: Math.round((entry.cooldownMs ?? 300000) / 6000) / 10,
              onChange: (event) => onChange({ cooldownMs: Math.round(num(event.target.value, 5) * 60000) }),
            }),
          ),
        ),
        h(
          'details',
          { className: 'ar-details' },
          h('summary', null, t('effortMap')),
          h(
            'div',
            { className: 'ar-grid', style: { marginTop: 7 } },
            EFFORTS.map((requested) =>
              h(
                'label',
                { key: requested, className: 'ar-field' },
                h('span', { className: 'ar-label' }, requested),
                h(
                  'select',
                  {
                    className: 'ar-select',
                    value: effortMap[requested] === undefined ? '' : effortMap[requested] === null ? '-' : effortMap[requested],
                    onChange: (event) => setEffort(requested, event.target.value),
                  },
                  h('option', { value: '' }, t('effortInherit')),
                  h('option', { value: '-' }, t('effortDrop')),
                  EFFORTS.map((effort) => h('option', { key: effort, value: effort }, effort)),
                ),
              ),
            ),
          ),
        ),
      )
    }

    /**
     * One titled block inside a card. Sections carry the divider that keeps
     * identity, chain, time windows and policy readable as parts of a single
     * card, instead of a stack of unrelated disclosures.
     */
    function Section({ t, title, count, actions, open, onToggle, children }) {
      const collapsible = typeof onToggle === 'function'
      return h(
        'div',
        { className: 'ar-section' },
        h(
          'div',
          { className: collapsible ? 'ar-section-head clickable' : 'ar-section-head', onClick: collapsible ? onToggle : undefined },
          collapsible
            ? h(
                'button',
                {
                  className: 'ar-chevron',
                  type: 'button',
                  'aria-expanded': open !== false,
                  'aria-label': open !== false ? t('collapseCard') : t('expandCard'),
                  onClick: onToggle,
                },
                open !== false ? '▾' : '▸',
              )
            : null,
          h('span', { className: 'ar-section-title' }, title),
          typeof count === 'number' && count > 0 ? h('span', { className: 'ar-badge' }, String(count)) : null,
          actions === undefined || actions === null
            ? null
            : h('span', { className: 'ar-section-actions', onClick: (event) => event.stopPropagation() }, actions),
        ),
        open === false ? null : h('div', { className: 'ar-section-body' }, children),
      )
    }

    function ProfileCard(props) {
      const { profile, index, t, catalog, onEdit, onRemove, onAddRoute, probes, onProbe } = props
      const policy = profile.policy ?? {}
      const windows = policy.timeWindows ?? []
      const chain = profile.chain ?? []
      const setPolicy = (patch) => onEdit({ policy: { ...policy, ...patch } })
      // Which chain is on screen: the configured one, or one window's own
      // fallback order over the same routes.
      const [orderTab, setOrderTab] = useState('default')
      const [provider, setProvider] = useState(catalog.providers[0]?.id ?? '')
      const [model, setModel] = useState(catalog.providers[0]?.models[0]?.id ?? '')
      const models = catalog.providers.find((item) => item.id === provider)?.models ?? []
      useEffect(() => {
        if (catalog.providers.length === 0) return
        if (!catalog.providers.some((item) => item.id === provider)) setProvider(catalog.providers[0].id)
      }, [catalog])
      useEffect(() => {
        if (models.length > 0 && !models.some((item) => item.id === model)) setModel(models[0].id)
      }, [provider, catalog])

      // A deleted window must not leave the editor on a tab that no longer exists.
      const tab = orderTab !== 'default' && windows.some((window) => window.id === orderTab) ? orderTab : 'default'
      const current = tab === 'default' ? undefined : windows.find((window) => window.id === tab)
      const orderedChain = current === undefined ? chain : orderByKeys(chain, current.order)
      const keyOf = (entry) => `${entry.provider}/${entry.model}`
      const writeOrder = (order) =>
        setPolicy({ timeWindows: windows.map((window) => (window.id === current.id ? { ...window, order } : window)) })

      function changeEntry(entry, patch) {
        const before = keyOf(entry)
        const next = { ...entry, ...patch }
        const after = keyOf(next)
        const nextChain = chain.map((item) => (item === entry ? next : item))
        if (before === after) {
          onEdit({ chain: nextChain })
          return
        }
        // A renamed route must not linger in a window order under its old key.
        onEdit({
          chain: nextChain,
          policy: {
            ...policy,
            timeWindows: windows.map((window) => ({
              ...window,
              order: (window.order ?? []).map((key) => (key === before ? after : key)),
            })),
          },
        })
      }

      function moveEntry(entry, delta) {
        if (current === undefined) {
          const at = chain.indexOf(entry)
          const to = at + delta
          if (at < 0 || to < 0 || to >= chain.length) return
          const next = [...chain]
          const [item] = next.splice(at, 1)
          next.splice(to, 0, item)
          onEdit({ chain: next })
          return
        }
        // Moving inside a window rewrites that window's whole order, because a
        // window is a chain of its own rather than a "try these two first" hint.
        const keys = orderedChain.map(keyOf)
        const at = keys.indexOf(keyOf(entry))
        const to = at + delta
        if (at < 0 || to < 0 || to >= keys.length) return
        const next = [...keys]
        const [item] = next.splice(at, 1)
        next.splice(to, 0, item)
        writeOrder(next)
      }

      function removeEntry(entry) {
        const key = keyOf(entry)
        onEdit({
          chain: chain.filter((item) => item !== entry),
          policy: {
            ...policy,
            timeWindows: windows.map((window) => ({ ...window, order: (window.order ?? []).filter((item) => item !== key) })),
          },
        })
      }

      return h(
        Card,
        {
          t,
          open: props.open !== false,
          onToggle: props.onToggle,
          head: [
            h('span', { key: 'title', className: 'ar-card-title' }, profile.name || profile.id),
            h('span', { key: 'id', className: 'ar-badge' }, profile.id),
            !profile.enabled ? h('span', { key: 'off', className: 'ar-badge warn' }, t('profileDisabled')) : null,
            profile.chain.length === 0 ? h('span', { key: 'empty', className: 'ar-badge bad' }, t('profileEmpty')) : null,
          ],
          actions: h(
            'button',
            { className: 'ar-btn tiny danger', type: 'button', onClick: () => onRemove(index), disabled: props.profileCount <= 1 },
            t('removeProfile'),
          ),
        },
        h(
          'div',
          { className: 'ar-grid' },
          h(
            Field,
            { label: t('profileId') },
            h('input', { className: 'ar-input', value: profile.id, onChange: (event) => onEdit({ id: event.target.value }) }),
          ),
          h(
            Field,
            { label: t('profileName') },
            h('input', { className: 'ar-input', value: profile.name ?? '', onChange: (event) => onEdit({ name: event.target.value }) }),
          ),
        ),
        h(
          Section,
          { title: t('chain') },
          h('div', { className: 'ar-hint' }, t('chainHint')),
          h(
            'div',
            { className: 'ar-order-tabs' },
            h(
              'button',
              {
                key: 'default',
                type: 'button',
                className: tab === 'default' ? 'ar-btn tiny primary' : 'ar-btn tiny',
                onClick: () => setOrderTab('default'),
              },
              t('defaultOrder'),
            ),
            windows.map((window, at) => {
              const caption = windowCaption(window)
              const range = windowRanges(window)
                .map((item) => `${item.from} → ${item.to}`)
                .join(' · ')
              return h(
                'button',
                {
                  key: window.id ?? at,
                  type: 'button',
                  className: tab === window.id ? 'ar-btn tiny primary' : 'ar-btn tiny',
                  title: range,
                  onClick: () => setOrderTab(window.id),
                },
                windowMatches(window, policy.utcOffsetMinutes) ? `● ${caption}` : caption,
              )
            }),
          ),
          current === undefined
            ? null
            : h('div', { className: 'ar-hint' }, t('orderTabHint')),
          chain.length === 0
            ? h('div', { className: 'ar-banner err' }, t('emptyChain'))
            : h(
                'div',
                { className: 'ar-chain' },
                orderedChain.map((entry, entryIndex) =>
                  h(EntryRow, {
                    key: entry.id ?? `${entry.provider}/${entry.model}/${entryIndex}`,
                    entry,
                    index: entryIndex,
                    count: orderedChain.length,
                    profileIndex: index,
                    t,
                    catalog,
                    probe: probes[`${profile.id}::${entry.provider}/${entry.model}`],
                    onProbe: (target) => onProbe(profile, target),
                    onChange: (patch) => changeEntry(entry, patch),
                    onMove: (delta) => moveEntry(entry, delta),
                    onRemove: () => removeEntry(entry),
                  }),
                ),
              ),
          h(
            'div',
            { className: 'ar-row' },
            h(
              'select',
              { className: 'ar-select grow', value: provider, onChange: (event) => setProvider(event.target.value) },
              catalog.providers.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            ),
            h(
              'select',
              { className: 'ar-select grow', value: model, onChange: (event) => setModel(event.target.value) },
              models.map((item) => h('option', { key: item.id, value: item.id }, item.name || item.id)),
            ),
            h(
              'button',
              {
                className: 'ar-btn',
                type: 'button',
                disabled: !provider || !model,
                onClick: () => onAddRoute(profile.id, { provider, model }),
              },
              `+ ${t('addRoute')}`,
            ),
          ),
        ),
        h(TimeWindows, {
          t,
          windows,
          chain,
          onChange: (list) => setPolicy({ timeWindows: list }),
        }),
        h(PolicySection, { t, policy, onChange: setPolicy }),
      )
    }

    /**
     * Policy belongs to the profile that owns the chain, so it renders inside
     * that profile's card. A page-level policy card had to carry its own
     * profile picker and could silently edit a profile the user was not
     * looking at.
     */
    function PolicySection({ t, policy, onChange }) {
      // Open by default: a collapsed section reads as an empty card, which is
      // exactly how the time windows looked before they moved in here.
      const [open, setOpen] = useState(true)
      return h(
        Section,
        {
          t,
          title: t('policy'),
          open,
          onToggle: () => setOpen((value) => !value),
          actions: h('span', { className: 'ar-muted' }, t('policyHint')),
        },
        h(PolicyFields, { t, policy, onChange }),
      )
    }

    /**
     * Policy belongs to the profile that owns the chain, so it renders inside
     * that profile's card. A page-level policy card had to carry its own
     * profile picker and could silently edit a profile the user was not
     * looking at.
     */
    function PolicyFields({ t, policy, onChange }) {
      const value = policy ?? {}
      const set = (patch) => onChange(patch)
      return h(
        'div',
        { className: 'ar-stack' },
        h('div', { className: 'ar-hint' }, t('policyHint')),
        h(
          'div',
          { className: 'ar-grid' },
          h(
            Field,
            { label: t('maxSwitches') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              max: 50,
              value: value.maxSwitches ?? 8,
              onChange: (event) => set({ maxSwitches: Math.max(0, Math.round(num(event.target.value, 8))) }),
            }),
          ),
          h(
            Field,
            { label: t('cooldown') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              step: 0.5,
              value: Math.round((value.cooldownMs ?? 300000) / 6000) / 10,
              onChange: (event) => set({ cooldownMs: Math.round(num(event.target.value, 5) * 60000) }),
            }),
          ),
          h(
            Field,
            { label: t('jitter') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              max: 1,
              step: 0.05,
              value: value.cooldownJitterRatio ?? 0.2,
              onChange: (event) => set({ cooldownJitterRatio: Math.min(1, Math.max(0, num(event.target.value, 0.2))) }),
            }),
          ),
          h(
            Field,
            { label: t('stickinessTtl') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              value: Math.round((value.stickinessTtlMs ?? 1800000) / 60000),
              onChange: (event) => set({ stickinessTtlMs: Math.max(0, Math.round(num(event.target.value, 30) * 60000)) }),
            }),
          ),
          h(
            Field,
            { label: t('failureWindow') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              value: Math.round((value.failureWindowMs ?? 120000) / 60000),
              onChange: (event) => set({ failureWindowMs: Math.max(0, Math.round(num(event.target.value, 2) * 60000)) }),
            }),
          ),
          h(
            Field,
            { label: t('failureThreshold') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 1,
              value: value.failureThreshold ?? 3,
              onChange: (event) => set({ failureThreshold: Math.max(1, Math.round(num(event.target.value, 3))) }),
            }),
          ),
          h(
            Field,
            { label: t('backoff') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              value: value.backoffBaseMs ?? 1000,
              onChange: (event) => set({ backoffBaseMs: Math.max(0, Math.round(num(event.target.value, 1000))) }),
            }),
          ),
          h(
            Field,
            { label: t('backoffMax') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 0,
              value: value.backoffMaxMs ?? 15000,
              onChange: (event) => set({ backoffMaxMs: Math.max(0, Math.round(num(event.target.value, 15000))) }),
            }),
          ),
          h(
            Field,
            { label: t('recovery') },
            h(
              'select',
              { className: 'ar-select', value: value.recovery ?? 'timer', onChange: (event) => set({ recovery: event.target.value }) },
              h('option', { value: 'timer' }, t('recoveryTimer')),
              h('option', { value: 'never' }, t('recoveryNever')),
            ),
          ),
          h(
            Field,
            { label: t('effortPolicy') },
            h(
              'select',
              { className: 'ar-select', value: value.effortPolicy ?? 'clamp', onChange: (event) => set({ effortPolicy: event.target.value }) },
              h('option', { value: 'clamp' }, t('effortPolicyClamp')),
              h('option', { value: 'drop' }, t('effortPolicyDrop')),
              h('option', { value: 'fail' }, t('effortPolicyFail')),
            ),
          ),
          h(
            Field,
            { label: t('contextPolicy') },
            h(
              'select',
              { className: 'ar-select', value: value.contextPolicy ?? 'min', onChange: (event) => set({ contextPolicy: event.target.value }) },
              h('option', { value: 'min' }, t('contextMin')),
              h('option', { value: 'max' }, t('contextMax')),
            ),
          ),
          h(
            Field,
            { label: t('defaultContext') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: 1000,
              step: 1000,
              value: value.defaultContextWindow ?? 128000,
              onChange: (event) => set({ defaultContextWindow: Math.max(1000, Math.round(num(event.target.value, 128000))) }),
            }),
          ),
          h(
            Field,
            { label: t('utcOffset'), hint: t('timezone') },
            h('input', {
              className: 'ar-input num',
              type: 'number',
              min: -720,
              max: 840,
              value: value.utcOffsetMinutes ?? 480,
              onChange: (event) => set({ utcOffsetMinutes: Math.round(num(event.target.value, 480)) }),
            }),
          ),
        ),
        h(Toggle, { label: t('sticky'), title: t('stickyHint'), checked: value.sticky !== false, onChange: (next) => set({ sticky: next }) }),
        h(Toggle, { label: t('honorRetryAfter'), checked: value.honorRetryAfter !== false, onChange: (next) => set({ honorRetryAfter: next }) }),
        h(Toggle, { label: t('retryNetwork'), checked: value.retryOnNetwork !== false, onChange: (next) => set({ retryOnNetwork: next }) }),
        h(
          Field,
          { label: t('triggerCodes'), hint: t('triggerCodesHint') },
          h('input', {
            className: 'ar-input wide',
            value: (value.triggerCodes ?? []).join(','),
            onChange: (event) => set({ triggerCodes: splitList(event.target.value) }),
          }),
        ),
        h(
          Field,
          { label: t('triggerStatuses'), hint: t('triggerStatusesHint') },
          h('input', {
            className: 'ar-input wide',
            value: (value.triggerStatuses ?? []).join(','),
            onChange: (event) =>
              set({
                triggerStatuses: splitList(event.target.value)
                  .map((item) => Math.round(num(item, 0)))
                  .filter((item) => item > 0),
              }),
          }),
        ),
      )
    }

    /**
     * Time windows reorder one profile's own chain, so they live inside that
     * profile's card: a window is meaningless without the routes it reorders.
     * Which routes go first is picked from the chain itself — typing
     * `provider/model` keys by hand was neither discoverable nor checkable.
     */
    function TimeWindows({ t, windows, chain, onChange }) {
      const routes = (chain ?? [])
        .filter((entry) => entry.enabled !== false && entry.provider && entry.model)
        .map((entry) => `${entry.provider}/${entry.model}`)
      const labelOf = (key) => {
        const entry = (chain ?? []).find((item) => `${item.provider}/${item.model}` === key)
        return entry === undefined || entry === null ? key : `${entry.provider}/${entry.model}`
      }
      const edit = (index, patch) => onChange(windows.map((item, at) => (at === index ? { ...item, ...patch } : item)))
      const editRange = (index, rangeIndex, patch) =>
        edit(index, {
          ranges: windowRanges(windows[index]).map((range, at) => (at === rangeIndex ? { ...range, ...patch } : range)),
        })
      const addRange = (index) => {
        const ranges = windowRanges(windows[index])
        edit(index, { ranges: [...ranges, { from: '00:00', to: '08:30' }] })
      }
      const removeRange = (index, rangeIndex) => {
        const ranges = windowRanges(windows[index]).filter((_, at) => at !== rangeIndex)
        // A window without a stretch of the day can never match, so the last
        // range stays until the whole window is removed.
        if (ranges.length === 0) return
        edit(index, { ranges })
      }
      // A new window starts as a copy of the configured chain, so it is a
      // complete fallback chain from the first moment and can be reordered.
      const add = () =>
        onChange([
          ...windows,
          {
            id: `window-${windows.length + 1}`,
            label: '',
            ranges: [{ from: '00:00', to: '08:30' }],
            order: [...routes],
          },
        ])
      const remove = (index) => onChange(windows.filter((_, at) => at !== index))
      return h(
        Section,
        {
          t,
          title: t('timeWindows'),
          count: windows.length,
          actions: [h('button', { key: 'add', className: 'ar-btn tiny', type: 'button', onClick: add }, `+ ${t('addWindow')}`)],
        },
        h('div', { className: 'ar-hint' }, t('timeWindowHint')),
        windows.length === 0
          ? h('div', { className: 'ar-muted' }, t('noWindows'))
          : windows.map((window, index) => {
              const ordered = orderByKeys(chain ?? [], window.order)
              const ranges = windowRanges(window)
              return h(
                'div',
                { key: window.id ?? index, className: 'ar-window' },
                h(
                  'div',
                  { className: 'ar-row' },
                  h('input', {
                    className: 'ar-input grow',
                    value: window.label ?? '',
                    placeholder: t('windowLabel'),
                    onChange: (event) => edit(index, { label: event.target.value }),
                  }),
                  h(
                    'button',
                    { className: 'ar-btn tiny danger', type: 'button', onClick: () => remove(index) },
                    t('removeWindow'),
                  ),
                ),
                // One named window, several stretches of the day: 00:30–08:30
                // and 22:00–23:30 are the same fallback chain.
                ranges.map((range, rangeIndex) =>
                  h(
                    'div',
                    { key: rangeIndex, className: 'ar-row' },
                    h('input', {
                      className: 'ar-input num',
                      type: 'time',
                      value: range.from,
                      onChange: (event) => editRange(index, rangeIndex, { from: event.target.value }),
                    }),
                    h('span', { className: 'ar-muted' }, '→'),
                    h('input', {
                      className: 'ar-input num',
                      type: 'time',
                      value: range.to,
                      onChange: (event) => editRange(index, rangeIndex, { to: event.target.value }),
                    }),
                    h(
                      'button',
                      {
                        className: 'ar-btn tiny',
                        type: 'button',
                        title: t('removeRange'),
                        disabled: ranges.length <= 1,
                        onClick: () => removeRange(index, rangeIndex),
                      },
                      '✕',
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'ar-row' },
                  h('button', { className: 'ar-btn tiny', type: 'button', onClick: () => addRange(index) }, `+ ${t('addRange')}`),
                  h('span', { className: 'ar-muted' }, t('rangeHint')),
                ),
                // Read-only here on purpose: the order is edited on the chain
                // itself, in the tab this window owns.
                h('div', { className: 'ar-label' }, t('windowOrderHint')),
                h(
                  'div',
                  { className: 'ar-muted ar-order-preview' },
                  ordered.length === 0 ? t('noRoutes') : ordered.map((entry) => labelOf(`${entry.provider}/${entry.model}`)).join('  →  '),
                ),
                h('div', { className: 'ar-hint' }, t('orderEditHint')),
              )
            }),
      )
    }

    function AutoRouterSettings(props) {
      const t = props.t
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [draft, setDraft] = useState(null)
      const [serverConfig, setServerConfig] = useState(null)
      const [revision, setRevision] = useState(undefined)
      const [status, setStatus] = useState(null)
      const [catalog, setCatalog] = useState({ providers: [] })
      const [tab, setTab] = useState('routes')
      const [busy, setBusy] = useState(false)
      const [dirty, setDirty] = useState(false)
      const [probes, setProbes] = useState({})
      const [jsonText, setJsonText] = useState('')
      const [jsonError, setJsonError] = useState('')
      const [scheme, setScheme] = useState(() => detectScheme())
      const [collapsed, setCollapsed] = useState(() => readCollapsed())
      const alive = useRef(true)

      const toggleCard = (id) => {
        setCollapsed((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          writeCollapsed(next)
          return next
        })
      }
      const isOpen = (id) => !collapsed.has(id)

      useEffect(() => {
        const sync = () => setScheme(detectScheme())
        sync()
        const media = window.matchMedia?.('(prefers-color-scheme: dark)')
        media?.addEventListener?.('change', sync)
        const observer =
          typeof MutationObserver === 'function'
            ? new MutationObserver(sync)
            : undefined
        if (observer !== undefined) {
          const options = { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] }
          observer.observe(document.documentElement, options)
          if (document.body) observer.observe(document.body, options)
        }
        return () => {
          media?.removeEventListener?.('change', sync)
          observer?.disconnect()
        }
      }, [])

      const flash = (message) => {
        setNotice(message)
        setTimeout(() => {
          if (alive.current) setNotice('')
        }, 3500)
      }

      async function load({ keepDraft = false } = {}) {
        setLoading(true)
        setError('')
        try {
          const [state, cat] = await Promise.all([api('/api/autorouter/state'), api('/api/autorouter/catalog')])
          if (!alive.current) return
          setStatus(state.status ?? null)
          setRevision(state.revision)
          setServerConfig(state.config)
          if (!keepDraft) {
            setDraft(state.config)
            setDirty(false)
            setJsonText(JSON.stringify(state.config, null, 2))
          }
          setCatalog(cat)
        } catch (failure) {
          if (alive.current) setError(failure.message || t('unavailable'))
        } finally {
          if (alive.current) setLoading(false)
        }
      }

      async function refreshStatus() {
        try {
          const state = await api('/api/autorouter/state')
          if (!alive.current) return
          setStatus(state.status ?? null)
        } catch {
          /* keep the last snapshot */
        }
      }

      /**
       * Sends one tiny completion through the router itself — the only check that
       * proves the chain, the credential and the upstream dialect all work.
       */
      async function tryOnce() {
        if (busy) return
        setBusy(true)
        setError('')
        try {
          const result = await api('/api/autorouter/try', { method: 'POST', body: JSON.stringify({}) })
          if (!alive.current) return
          if (result.ok) flash(`${t('tryOk')} · ${result.ms}ms · ${result.route ?? result.profile}`)
          else setError(`${t('tryFailed')}: ${result.error ?? result.reason ?? ''}`)
          await refreshStatus()
        } catch (failure) {
          if (!alive.current) return
          // A page that was reloaded while the host kept the old process is the
          // one case worth naming: the route simply is not there yet.
          if (failure.status === 404 || failure.status === 405) setError(t('tryOutdated'))
          else setError(`${t('tryFailed')}: ${failure.message}`)
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      useEffect(() => {
        alive.current = true
        load()
        return () => {
          alive.current = false
        }
      }, [])

      useEffect(() => {
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') refreshStatus()
        }, 5000)
        return () => clearInterval(timer)
      }, [])

      const profiles = draft?.profiles ?? []

      const switchTab = (next) => {
        if (next === 'json') setJsonText(JSON.stringify(draft, null, 2))
        setTab(next)
      }

      const editDraft = (mutator) => {
        setDraft((previous) => {
          const next = structuredClone(previous)
          mutator(next)
          return next
        })
        setDirty(true)
      }

      const editProfile = (index, patch) => {
        editDraft((next) => {
          next.profiles[index] = { ...next.profiles[index], ...patch }
        })
      }

      /**
       * Discard the draft instead of refetching: the button sits next to Save,
       * so it has to be the inverse of Save (local, instant, no network) and
       * never silently throw away edits the user did not ask to drop.
       */
      const undo = () => {
        if (serverConfig === null) return
        setDraft(structuredClone(serverConfig))
        setDirty(false)
        setJsonError('')
        flash(t('reverted'))
      }

      async function save() {
        if (draft === null || busy) return
        const ids = new Set()
        for (const item of profiles) {
          const id = typeof item.id === 'string' ? item.id.trim() : ''
          if (id === '') {
            setError(t('profileIdRequired'))
            return
          }
          if (ids.has(id)) {
            setError(t('duplicateProfile'))
            return
          }
          ids.add(id)
        }
        setBusy(true)
        setError('')
        try {
          const body = await api('/api/autorouter/config', { method: 'PUT', body: JSON.stringify({ value: draft, revision }) })
          if (!alive.current) return
          setRevision(body.revision)
          setServerConfig(body.config)
          setDraft(body.config)
          setJsonText(JSON.stringify(body.config, null, 2))
          setDirty(false)
          flash(t('saved'))
          // Only the status block needs a refresh: re-reading the config would
          // write a possibly lagging server projection over what was just saved.
          await refreshStatus()
        } catch (failure) {
          if (!alive.current) return
          if (failure.status === 409 && failure.body?.config) {
            setError(t('conflict'))
            setServerConfig(failure.body.config)
            setRevision(failure.body.revision)
          } else {
            setError(`${t('failed')}: ${failure.message}`)
          }
        } finally {
          if (alive.current) setBusy(false)
        }
      }

      function addProfile() {
        const ids = new Set(profiles.map((item) => item.id))
        let index = profiles.length + 1
        while (ids.has(`profile-${index}`)) index += 1
        const id = `profile-${index}`
        editDraft((next) => {
          next.profiles.push({
            id,
            name: id,
            enabled: true,
            chain: [],
            policy: structuredClone(next.profiles[next.profiles.length - 1]?.policy ?? {}),
          })
        })
      }

      function removeProfile(index) {
        if (profiles.length <= 1) return
        editDraft((next) => {
          next.profiles.splice(index, 1)
        })
      }

      function addRoute(profileId, { provider, model }) {
        editDraft((next) => {
          const target = next.profiles.find((item) => item.id === profileId)
          const key = `${provider}/${model}`
          target.chain.push({
            id: key,
            enabled: true,
            provider,
            model,
            cooldownMs: 300000,
            effortMap: {},
          })
          // Every window keeps a complete order, so a new route has to land in
          // each of them too — otherwise it would only ever run as a leftover.
          const windows = target.policy?.timeWindows ?? []
          for (const window of windows) window.order = [...(window.order ?? []), key]
        })
      }

      async function probe(profileTarget, entry) {
        const key = `${profileTarget.id}::${entry.provider}/${entry.model}`
        setProbes((previous) => ({ ...previous, [key]: { busy: true } }))
        try {
          const result = await api('/api/autorouter/probe', {
            method: 'POST',
            body: JSON.stringify({ provider: entry.provider, model: entry.model }),
          })
          if (!alive.current) return
          setProbes((previous) => ({
            ...previous,
            [key]: { busy: false, result: result.ok === true, ms: result.ms ?? 0, error: result.error },
          }))
        } catch (failure) {
          if (!alive.current) return
          setProbes((previous) => ({ ...previous, [key]: { busy: false, result: false, error: failure.message } }))
        }
      }

      async function clearCooldown(key) {
        try {
          await api('/api/autorouter/cooldown', { method: 'POST', body: JSON.stringify(key ? { key } : {}) })
          refreshStatus()
        } catch (failure) {
          setError(failure.message)
        }
      }

      if (loading && draft === null) {
        return h('div', { className: 'ar-root' }, h('div', { className: 'ar-muted' }, t('loading')))
      }
      if (draft === null) {
        return h(
          'div',
          { className: 'ar-root' },
          h('h2', { className: 'ar-title' }, t('title')),
          h('div', { className: 'ar-banner err' }, `${t('unavailable')}: ${error || 'unknown error'}`),
          h('div', null, h('button', { className: 'ar-btn', type: 'button', onClick: () => load() }, t('retry'))),
        )
      }

      const routes = status?.routes ?? []
      const stats = status?.stats ?? {}

      return h(
        'div',
        { className: 'ar-root', 'data-scheme': scheme, style: { colorScheme: scheme } },
        h(
          'div',
          { className: 'ar-head' },
          h(
            'div',
            null,
            h('h2', { className: 'ar-title' }, t('title')),
            h('p', { className: 'ar-sub' }, t('subtitle')),
          ),
          h(
            'div',
            { className: 'ar-actions' },
            h(Toggle, {
              label: t('enabled'),
              checked: draft.enabled !== false,
              onChange: (value) => {
                editDraft((next) => {
                  next.enabled = value
                })
              },
            }),
            dirty ? h('span', { className: 'ar-badge warn' }, t('dirty')) : null,
            h(
              'button',
              { className: 'ar-btn primary', type: 'button', disabled: busy, onClick: save, title: t('saveHint') },
              busy ? t('saving') : t('save'),
            ),
            h(
              'button',
              { className: 'ar-btn', type: 'button', disabled: busy || !dirty, onClick: undo, title: t('undoHint') },
              t('undo'),
            ),
          ),
        ),
        error ? h('div', { className: 'ar-banner err', role: 'alert' }, error) : null,
        notice ? h('div', { className: 'ar-banner ok' }, notice) : null,
        h(Tabs, { tab, t, onTab: switchTab }),

        tab === 'routes'
          ? h(
              'div',
              { className: 'ar-root', style: { gap: 12 } },
              h(
                'div',
                { className: 'ar-row' },
                h('span', { className: 'ar-hint' }, t('routesHint')),
                h('span', { style: S.right }, h('button', { className: 'ar-btn', type: 'button', onClick: addProfile }, `+ ${t('addProfile')}`)),
              ),
              profiles.map((item, index) =>
                h(ProfileCard, {
                  key: index,
                  profile: item,
                  index,
                  open: isOpen(`profile:${index}`),
                  onToggle: () => toggleCard(`profile:${index}`),
                  profileCount: profiles.length,
                  t,
                  catalog,
                  probes,
                  onProbe: probe,
                  onEdit: (patch) => editProfile(index, patch),
                  onRemove: removeProfile,
                  onAddRoute: addRoute,
                }),
              ),
            )
          : null,

        tab === 'status'
          ? h(
              'div',
              { className: 'ar-root', style: { gap: 12 } },
              h(
                Card,
                {
                  t,
                  open: isOpen('status'),
                  onToggle: () => toggleCard('status'),
                  head: [
                    h('span', { key: 'title', className: 'ar-card-title' }, t('status')),
                    h('span', { key: 'count', className: 'ar-muted' }, `${routes.length} ${t('routes')}`),
                  ],
                  actions: [
                    h('button', { key: 'try', className: 'ar-btn tiny', type: 'button', onClick: tryOnce, disabled: busy }, t('tryOnce')),
                    h('button', { key: 'refresh', className: 'ar-btn tiny', type: 'button', onClick: refreshStatus }, t('refresh')),
                    h('button', { key: 'clear', className: 'ar-btn tiny', type: 'button', onClick: () => clearCooldown() }, t('clearAll')),
                  ],
                },
                h(
                  'div',
                  { className: 'ar-hint' },
                  `${t('stats')}: ${num(stats.attempts)} / ${num(stats.successes)} / ${num(stats.failures)} / ${num(stats.switches)}`,
                  stats.lastRoute ? ` · ${t('lastRoute')}: ${stats.lastRoute}` : '',
                ),
                stats.lastError ? h('div', { className: 'ar-hint', style: { color: '#e5484d' } }, stats.lastError) : null,
                status?.version
                  ? h('div', { className: 'ar-hint' }, `host v${status.version} · ${t('hostVersionHint')}`)
                  : h('div', { className: 'ar-hint' }, t('hostVersionUnknown')),
                h(
                  'div',
                  { style: S.tableWrap },
                  h(
                    'table',
                    { className: 'ar-table' },
                    h(
                      'thead',
                      null,
                      h(
                        'tr',
                        null,
                        h('th', null, t('profile')),
                        h('th', null, t('provider')),
                        h('th', null, t('model')),
                        h('th', null, t('health')),
                        h('th', null, ''),
                      ),
                    ),
                    h(
                      'tbody',
                      null,
                      routes.map((row) =>
                        h(
                          'tr',
                          { key: `${row.profileId}/${row.key}` },
                          h('td', null, row.profileId),
                          h('td', null, row.provider),
                          h('td', null, row.model),
                          h('td', null, h(HealthBadge, { row, t })),
                          h(
                            'td',
                            null,
                            h(
                              'button',
                              { className: 'ar-btn tiny', type: 'button', onClick: () => clearCooldown(row.key) },
                              t('clearCooldown'),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'ar-hint' },
                  (status?.sessions ?? []).length === 0
                    ? t('noSessions')
                    : status.sessions
                        .map((record) => `${record.sessionId.slice(0, 8)} → ${record.profileId}/${record.key} (${fmtAge(record.ageMs)})`)
                        .join(' · '),
                ),
              ),
            )
          : null,

        tab === 'json'
          ? h(
              'div',
              { className: 'ar-root', style: { gap: 8 } },
              h('div', { className: 'ar-hint' }, t('jsonHint')),
              h('textarea', {
                className: 'ar-json',
                spellCheck: false,
                value: jsonText,
                onChange: (event) => setJsonText(event.target.value),
              }),
              jsonError ? h('div', { className: 'ar-banner err' }, jsonError) : null,
              h(
                'div',
                { className: 'ar-row' },
                h(
                  'button',
                  {
                    className: 'ar-btn',
                    type: 'button',
                    onClick: () => {
                      try {
                        const parsed = JSON.parse(jsonText)
                        setDraft(parsed)
                        setDirty(true)
                        setJsonError('')
                        flash(t('applyJson'))
                      } catch (failure) {
                        setJsonError(`${t('jsonError')}: ${failure.message}`)
                      }
                    },
                  },
                  t('applyJson'),
                ),
                h(
                  'button',
                  {
                    className: 'ar-btn',
                    type: 'button',
                    onClick: () => {
                      if (serverConfig === null) return
                      setJsonText(JSON.stringify(serverConfig, null, 2))
                      setJsonError('')
                    },
                  },
                  t('undo'),
                ),
              ),
            )
          : null,
      )
    }

    /**
     * Settings navigation glyph: one source fanning out into three routes.
     * Same contract as the shipped section icons — `{ size }`, 24-unit box,
     * `currentColor`, so it inherits the sidebar's own colour and dark mode.
     */
    function AutoRouterIcon({ size = 16 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
        },
        h('circle', { cx: 4.6, cy: 12, r: 1.5 }),
        h('path', { d: 'M6.5 12h2.6' }),
        h('path', { d: 'M9.1 12c3.2 0 3.2-6.2 6.4-6.2h2.1' }),
        h('path', { d: 'M9.1 12h8.4' }),
        h('path', { d: 'M9.1 12c3.2 0 3.2 6.2 6.4 6.2h2.1' }),
        h('circle', { cx: 19.2, cy: 5.8, r: 1.4 }),
        h('circle', { cx: 19.2, cy: 12, r: 1.4 }),
        h('circle', { cx: 19.2, cy: 18.2, r: 1.4 }),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.plugin = 'dsh-autorouter'
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => style.remove(), 'autorouter: styles')

        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'autorouter: locale')
        const t = ctx.locale.bind(NS)

        const Page = (props) => h(AutoRouterSettings, { ...props, t })

        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'autorouter',
              order: 16,
              label: () => t('nav'),
              locale: NS,
            },
            Page,
          ),
        )

        ctx.slots.inject('settings.section.icon', () =>
          ctx.slots.register({ name: 'settings.section.icon', id: 'autorouter' }, AutoRouterIcon),
        )
      },
    }
  },
})
