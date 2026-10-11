/**
 * dsh-qoder-link — browser half.
 *
 * Contributes one top-level settings section (id `qoder-cn`) whose entire
 * content is the model list: every model the account exposes, each with an
 * on/off switch and a context-window choice, plus a collapsed "advanced" area
 * holding the handful of scalars worth reaching without editing YAML.
 *
 * The model list cannot come from the config form: it is fetched live from the
 * Qoder CLI. So the page reads `GET <prefix>/models`, which joins that live
 * catalog with the user's stored choices, while every change goes back through
 * the host's own config form. The host owns the catalog, so the page never
 * derives state the adapter does not share.
 *
 * The page can also start the CLI helper shipped with this package
 * (`POST <prefix>/setup`, then `GET <prefix>/setup` for its output): installing
 * and signing into qoderclicn is a local action a browser cannot perform.
 *
 * Rendering from the schema-driven form alone would be wrong here: the useful
 * controls depend on rows that only exist at runtime.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides. Colour comes from theme variables so the
 * page survives a scheme switch.
 */

window.__ModuleLoader__.load({
  id: 'dsh-qoder-link',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } = React

    /** The plugin's config namespace — must equal the profile row id. */
    const NS = 'llm-qoder-cn'
    const inject = ['slots', 'locale', 'configForms']

    // ── copy ────────────────────────────────────────────────────────────────
    const zh = {
      nav: 'Qoder CN',
      title: 'Qoder CN',
      intro: '勾选要启用的模型，并为需要的模型指定上下文窗口。改动即时生效，无需重启。',
      loading: '正在读取模型列表…',
      loadFailed: '读取模型列表失败',
      retry: '重试',
      refresh: '刷新列表',
      refreshing: '刷新中…',
      saveFailed: '保存失败',
      notApplied: '服务器未报告这次改动，可能被其他窗口覆盖了，请刷新后重试',
      timeout: '保存超时，请重试',
      saved: '已保存',
      saving: '保存中…',
      enabledCount: '已启用',
      noModels: '账号未返回任何模型。请确认本机 qoderclicn 已登录。',
      search: '搜索模型…',
      onlyEnabled: '只看已启用',
      selectAll: '全部启用',
      selectNone: '全部关闭',
      colEnabled: '启用',
      windowDefault: '默认',
      windowDefaultHint: '跟随上游声明的窗口',
      vision: '读图',
      free: '免费',
      advanced: '高级设置',
      advancedHint: '以下为细节参数，通常无需改动。',
      show: '展开',
      hide: '收起',
      reset: '恢复默认',
      windowWarn: '窗口越大，DSH 的自动压缩触发得越晚。若对话经常超限，请选较小的窗口。',
      cliGroup: 'Qoder CN CLI',
      cliHint: '插件复用本机 qoderclicn 的登录态。这里可以直接跑随包附带的配置脚本：缺 CLI 就装，未登录就拉起浏览器登录。',
      cliRun: '一键配置',
      cliCheck: '仅体检',
      cliRunning: '正在执行，输出持续刷新…',
      cliStartFailed: '无法启动配置脚本',
      cliExitOk: '配置脚本执行完成',
      cliExitFail: '配置脚本未通过，退出码',
      advancedFields: {
        displayName: '分组名称',
        maxSessions: '并发会话数',
        modelCacheTtlSeconds: '模型列表缓存（秒）',
        defaultReasoningEffort: '默认思考档位',
        defaultMaxTokens: '默认输出上限',
        toolResultTimeoutSeconds: '工具结果等待（秒）',
        catalogFetchTimeoutSeconds: '模型列表超时（秒）',
        abortGraceSeconds: '中断宽限（秒）',
        coldMaxTurns: '旁路请求轮次',
        modelAliases: '模型别名',
      },
    }
    const en = {
      nav: 'Qoder CN',
      title: 'Qoder CN',
      intro: 'Tick the models you want available and set a context window where needed. Changes apply immediately.',
      loading: 'Loading models…',
      loadFailed: 'Could not load the model list',
      retry: 'Retry',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      saveFailed: 'Save failed',
      notApplied: 'The host did not report this change; another window may have overwritten it. Refresh and retry.',
      timeout: 'Save timed out; please retry',
      saved: 'Saved',
      saving: 'Saving…',
      enabledCount: 'enabled',
      noModels: 'The account returned no models. Check that qoderclicn is signed in.',
      search: 'Search models…',
      onlyEnabled: 'Enabled only',
      selectAll: 'Enable all',
      selectNone: 'Disable all',
      colEnabled: 'On',
      windowDefault: 'Default',
      windowDefaultHint: "Follow upstream's declared window",
      vision: 'Vision',
      free: 'Free',
      advanced: 'Advanced',
      advancedHint: 'Detail parameters; rarely changed.',
      show: 'Show',
      hide: 'Hide',
      reset: 'Reset',
      windowWarn: 'A larger window delays DSH\u2019s auto-compaction. Pick a smaller one if conversations overflow.',
      cliGroup: 'Qoder CN CLI',
      cliHint: 'The plugin reuses this machine\u2019s qoderclicn sign-in. Run the bundled helper from here: it installs the CLI when missing and opens the browser sign-in when signed out.',
      cliRun: 'Configure',
      cliCheck: 'Check only',
      cliRunning: 'Running, output refreshes…',
      cliStartFailed: 'Could not start the helper',
      cliExitOk: 'Helper finished',
      cliExitFail: 'Helper failed with exit code',
      advancedFields: {
        displayName: 'Group name',
        maxSessions: 'Concurrent sessions',
        modelCacheTtlSeconds: 'Catalog cache (s)',
        defaultReasoningEffort: 'Default reasoning effort',
        defaultMaxTokens: 'Default output cap',
        toolResultTimeoutSeconds: 'Tool result wait (s)',
        catalogFetchTimeoutSeconds: 'Catalog timeout (s)',
        abortGraceSeconds: 'Abort grace (s)',
        coldMaxTurns: 'Side-channel turns',
        modelAliases: 'Model aliases',
      },
    }

    /**
     * Scalars shown under Advanced, in order, with how to render each.
     *
     * The schema is the source of truth for labels, help text and bounds; this
     * list only decides order and which control each field gets.
     */
    const ADVANCED = [
      ['displayName', 'text'],
      ['maxSessions', 'number'],
      ['modelCacheTtlSeconds', 'number'],
      ['defaultReasoningEffort', 'text'],
      ['defaultMaxTokens', 'number'],
      ['toolResultTimeoutSeconds', 'number'],
      ['catalogFetchTimeoutSeconds', 'number'],
      ['abortGraceSeconds', 'number'],
      ['coldMaxTurns', 'number'],
      ['modelAliases', 'json'],
    ]

    const css = {
      page: { maxWidth: '860px', display: 'flex', flexDirection: 'column', gap: '14px', color: 'var(--dsw-alias-label-primary)' },
      h2: { margin: '0', fontSize: '1.25em' },
      intro: { margin: '0', opacity: 0.72, lineHeight: 1.55, fontSize: '0.92em' },
      bar: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      btn: { padding: '6px 12px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))', background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit', fontSize: '0.88em' },
      input: { padding: '6px 10px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))', background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', font: 'inherit', fontSize: '0.88em' },
      search: { flex: '1 1 180px', minWidth: '140px' },
      count: { fontSize: '0.85em', opacity: 0.7, marginLeft: 'auto' },
      list: { display: 'flex', flexDirection: 'column', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))', borderRadius: '10px', overflow: 'hidden' },
      row: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.15))' },
      rowFirst: { borderTop: 'none' },
      rowOff: { opacity: 0.5 },
      name: { flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' },
      nameText: { fontSize: '0.92em', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      id: { fontSize: '0.76em', opacity: 0.55, fontFamily: 'ui-monospace, monospace' },
      tag: { fontSize: '0.72em', padding: '1px 6px', borderRadius: '5px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))', opacity: 0.75 },
      price: { fontSize: '0.9em', opacity: 0.7, fontWeight: 400 },
      select: { padding: '5px 8px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))', background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', font: 'inherit', fontSize: '0.85em', minWidth: '104px' },
      switch: { width: '17px', height: '17px', cursor: 'pointer', accentColor: 'var(--dsw-alias-brand-primary, #4c6ef5)' },
      note: { fontSize: '0.82em', opacity: 0.62, lineHeight: 1.5 },
      err: { fontSize: '0.86em', color: 'var(--dsw-alias-label-danger, #e03131)' },
      group: { display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))', borderRadius: '10px', padding: '14px 16px' },
      advLabel: { fontSize: '0.88em' },
      h3: { margin: 0, fontSize: '0.95em' },
      log: { margin: '0', maxHeight: '240px', overflowY: 'auto', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))', background: 'var(--dsw-alias-bg-base, rgba(128,128,128,0.05))', fontFamily: 'ui-monospace, monospace', fontSize: '0.76em', lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
    }

    /**
     * Same-origin API base, resolved against the document so a deployment under
     * a sub-path still reaches its own host.
     */
    const API = (() => {
      try { return new URL('api/llm-qoder-cn', document.baseURI).pathname } catch { return '/api/llm-qoder-cn' }
    })()

    /** Call the plugin's model API. */
    async function api(path, options) {
      const { timeout = 30_000, ...rest } = options ?? {}
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), timeout)
      try {
        const response = await fetch(`${API}${path}`, { ...rest, signal: ctrl.signal })
        const text = await response.text()
        let payload
        try { payload = text === '' ? {} : JSON.parse(text) } catch { payload = { error: text.slice(0, 200) } }
        if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
        return payload
      } finally {
        clearTimeout(timer)
      }
    }

    /**
     * How long a settings write may take before the page gives up on it.
     *
     * A config write is a round trip to the host, which commits the value into
     * the running plugin before it answers, so this is not a normal-path limit —
     * it is a floor under the UI. Without it a wire call that never settles
     * leaves every control disabled forever, which is exactly how this page was
     * previously reported as frozen.
     */
    const WRITE_TIMEOUT_MS = 20_000

    /** Settle with `promise`, or reject with `message` once `ms` elapse. */
    function withDeadline(promise, ms, message) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(message)), ms)
        promise.then(
          value => { clearTimeout(timer); resolve(value) },
          error => { clearTimeout(timer); reject(error) },
        )
      })
    }

    /** Compact label for a token count. */
    function windowLabel(n) {
      if (typeof n !== 'number' || !Number.isFinite(n)) return '—'
      if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1))}M`
      if (n >= 1000) return `${Math.round(n / 1000)}K`
      return String(n)
    }

    /**
     * The credit multiplier upstream quotes, as a short suffix.
     *
     * `0` renders as 免费 rather than `x0`, matching how the Qoder client shows
     * a free model. A model upstream quoted no multiplier for gets no suffix at
     * all — inventing one would misstate its cost.
     */
    function priceSuffix(t, factor) {
      if (typeof factor !== 'number' || !Number.isFinite(factor) || factor < 0) return ''
      if (factor === 0) return t('free')
      return `x${Number(factor.toFixed(4))}`
    }

    /**
     * The model table plus the advanced block.
     *
     * Each change posts and then adopts the host's returned list, so the page
     * shows what the adapter will actually do rather than what the click hoped.
     * A per-request ticket keeps a slow earlier answer from overwriting a newer
     * one when the user clicks quickly.
     */
    function SettingsPage({ ctx, t }) {
      const [models, setModels] = useState(undefined)
      const [error, setError] = useState(undefined)
      const [status, setStatus] = useState(undefined)
      const [busy, setBusy] = useState(false)
      const [query, setQuery] = useState('')
      const [onlyEnabled, setOnlyEnabled] = useState(false)
      const [showAdvanced, setShowAdvanced] = useState(false)
      const ticket = useRef(0)
      /** Separate from `ticket`: `load()` bumps that one, so sharing it would
       *  make every write look stale the moment its own refresh landed. */
      const writeTicket = useRef(0)

      const form = ctx.configForms.get(NS)
      const subscribe = useCallback(listener => form.subscribe(listener), [form])
      const read = useCallback(() => form.getSnapshot(), [form])
      const snapshot = useSyncExternalStore(subscribe, read)

      const describeFace = ctx.configForms.describe()
      const describeSubscribe = useCallback(listener => describeFace.subscribe(listener), [describeFace])
      const describeRead = useCallback(() => describeFace.getSnapshot(), [describeFace])
      const describeSnapshot = useSyncExternalStore(describeSubscribe, describeRead)
      useEffect(() => { describeFace.ensure().catch(() => undefined) }, [describeFace])

      const fetchModels = useCallback(async (fresh = false) => {
        const payload = await api(`/models${fresh ? '?fresh=1' : ''}`)
        return Array.isArray(payload?.models) ? payload.models : []
      }, [])

      /** Read the list. `fresh` asks the host to drop its catalog cache first. */
      const load = useCallback(async (fresh = false) => {
        setError(undefined)
        const mine = ++ticket.current
        try {
          const rows = await fetchModels(fresh)
          if (mine !== ticket.current) return
          setModels(rows)
        } catch (err) {
          if (mine !== ticket.current) return
          setError(String(err?.message ?? err))
          setModels(previous => previous ?? [])
        }
      }, [fetchModels])

      useEffect(() => { void load() }, [load])

      /**
       * Re-read until the list reflects what was just written, or give up.
       *
       * The host commits a volatile config edit into the running plugin before
       * it answers the write, so the first read after `set()` normally already
       * shows the change and this returns immediately. The retries exist for the
       * cases where it does not: a reload that briefly unpublished the route, or
       * a host that answered ahead of its own commit. Spending them turns a
       * transient disagreement into a short wait instead of a wrong answer.
       *
       * @param verify - whether the rows already show the intended change.
       * @param attempts - how many reads to try before accepting what arrived.
       * @returns the last rows read, or undefined when every read failed.
       */
      const loadUntil = useCallback(async (verify, attempts = 5) => {
        let rows
        for (let attempt = 0; attempt < attempts; attempt++) {
          try {
            rows = await fetchModels()
          } catch (err) {
            setError(String(err?.message ?? err))
            return undefined
          }
          setModels(rows)
          if (verify === undefined || verify(rows)) return rows
          await new Promise(resolve => setTimeout(resolve, 120 + attempt * 120))
        }
        return rows
      }, [fetchModels])

      /**
       * Apply one change through the shared config form, then re-read until the
       * list reflects it.
       *
       * The write goes through `configForms`, not the API route: that form owns
       * the namespace's revision fence, so every change is ordered and a stale
       * editor is refused rather than silently overwriting.
       *
       * `busy` is owned by the newest write alone, and is always cleared in
       * `finally`. It must NOT be gated on the read generation: the read bumps
       * that counter, so gating there would leave `busy` set forever and every
       * control disabled.
       *
       * The host answers only after it has committed the value, so the re-read
       * normally confirms the change on its first attempt. `verify` therefore
       * acts as a real check rather than a wait: if the list still disagrees
       * once the retries are spent, the change was NOT adopted and the page says
       * so instead of reporting a save that did nothing.
       *
       * @param key - the config field to write.
       * @param next - the value, or undefined to clear the field.
       * @param verify - whether the re-read list already shows this change.
       */
      const write = useCallback(async (key, next, verify) => {
        const mine = ++writeTicket.current
        setBusy(true)
        setStatus(t('saving'))
        setError(undefined)
        try {
          const op = next === undefined ? form.unset(key) : form.set(key, next)
          const accepted = await withDeadline(op, WRITE_TIMEOUT_MS, t('timeout'))
          if (accepted === false) throw new Error(t('saveFailed'))
          const rows = await loadUntil(verify)
          if (rows !== undefined && verify !== undefined && !verify(rows)) throw new Error(t('notApplied'))
          if (mine === writeTicket.current) setStatus(t('saved'))
        } catch (err) {
          if (mine !== writeTicket.current) return
          setError(`${t('saveFailed')}：${String(err?.message ?? err)}`)
          setStatus(undefined)
          // The rows now hold an optimistic guess; re-read so the page shows what
          // the host actually stored rather than what the click hoped for.
          await load()
        } finally {
          if (mine === writeTicket.current) setBusy(false)
        }
      }, [form, load, loadUntil, t])

      /**
       * Write the whole disabled-model list, derived from the rows the user
       * just changed, so rapid toggles cannot lose each other's edits.
       *
       * The row is updated locally first: the host commits the value before it
       * answers, so the re-read confirms this instead of correcting it, and the
       * switch never appears to snap back to where it was.
       */
      const writeDisabled = useCallback((rows, id, enabled) => {
        const next = new Set(rows.filter(m => !m.enabled).map(m => m.id))
        if (enabled) next.delete(id)
        else next.add(id)
        setModels(current => current?.map(m => m.id === id ? { ...m, enabled } : m))
        return write('disabledModels', [...next], list => list.some(m => m.id === id && m.enabled === enabled))
      }, [write])

      /** Write the whole per-model window map, again showing the choice at once. */
      const writeWindow = useCallback((rows, id, window) => {
        const next = {}
        for (const m of rows) if (m.override !== undefined) next[m.id] = m.override
        if (window === undefined) delete next[id]
        else next[id] = window
        setModels(current => current?.map(m => m.id === id
          ? { ...m, override: window, contextWindow: window ?? m.defaultContextWindow }
          : m))
        return write(
          'modelContextWindows',
          next,
          list => list.some(m => m.id === id
            && (window === undefined ? m.override === undefined : m.override === window)),
        )
      }, [write])

      /**
       * Flip every model at once.
       *
       * Enabling all writes an empty deny-list rather than every id, so a model
       * the account publishes later still defaults to on.
       */
      const writeAll = useCallback((enabled) => {
        const ids = (models ?? []).map(m => m.id)
        setModels(current => current?.map(m => ({ ...m, enabled })))
        return write(
          'disabledModels',
          enabled ? [] : ids,
          list => list.every(m => m.enabled === enabled),
        )
      }, [models, write])

      // ── CLI helper ────────────────────────────────────────────────────────
      // The host runs the script, so the page only asks and then reads what it
      // printed. `setup` stays undefined-shaped until the first answer arrives:
      // a host older than this route simply never answers, and the panel is
      // still renderable with both buttons inert-free.
      const [setup, setSetup] = useState(undefined)
      const [setupError, setSetupError] = useState(undefined)
      const logRef = useRef(null)

      const pollSetup = useCallback(async () => {
        try {
          setSetup(await api('/setup', { timeout: 10_000 }))
        } catch {
          /* no run to report, or a host without the route */
        }
      }, [])

      const startCliSetup = useCallback(async (mode) => {
        setSetupError(undefined)
        try {
          setSetup(await api('/setup', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ mode }),
            timeout: 15_000,
          }))
        } catch (err) {
          setSetupError(`${t('cliStartFailed')}：${String(err?.message ?? err)}`)
        }
      }, [t])

      const setupRunning = setup?.running === true
      const setupCode = setup !== undefined && setup.running === false ? setup.code : undefined
      const setupLines = Array.isArray(setup?.lines) ? setup.lines : []

      useEffect(() => { void pollSetup() }, [pollSetup])
      useEffect(() => {
        if (!setupRunning) return undefined
        const timer = setInterval(() => { void pollSetup() }, 1200)
        return () => clearInterval(timer)
      }, [setupRunning, pollSetup])

      // The catalog is read from the CLI, so a helper that just installed or
      // signed into it changes what the list should show — and the host has
      // already dropped its cached answer for that case.
      useEffect(() => {
        if (setupCode === 0) void load(true)
      }, [setupCode, load])

      useEffect(() => {
        const node = logRef.current
        if (node !== null) node.scrollTop = node.scrollHeight
      }, [setupLines.length])

      const all = models ?? []
      const enabledTotal = all.filter(m => m.enabled).length

      const shown = useMemo(() => {
        const q = query.trim().toLowerCase()
        return all.filter(m => {
          if (onlyEnabled && !m.enabled) return false
          if (q === '') return true
          return String(m.name).toLowerCase().includes(q) || String(m.id).toLowerCase().includes(q)
        })
      }, [all, query, onlyEnabled])

      if (models === undefined) {
        return h('div', { style: css.page },
          h('h2', { style: css.h2 }, t('title')),
          error === undefined
            ? h('div', { style: css.note }, t('loading'))
            : h('div', null,
                h('div', { style: css.err }, `${t('loadFailed')}：${error}`),
                h('button', { style: { ...css.btn, marginTop: '8px' }, onClick: () => void load(true) }, t('retry')),
              ),
        )
      }

      const rows = shown.map((m, index) => {
        const choices = Array.isArray(m.contextWindows) ? m.contextWindows : []
        return h('div', {
          key: m.id,
          style: { ...css.row, ...(index === 0 ? css.rowFirst : {}), ...(m.enabled ? {} : css.rowOff) },
        },
          h('input', {
            type: 'checkbox',
            style: css.switch,
            checked: m.enabled === true,
            disabled: busy,
            title: t('colEnabled'),
            onChange: event => { void writeDisabled(all, m.id, event.target.checked) },
          }),
          h('div', { style: css.name },
            h('div', { style: css.nameText },
              m.name,
              m.vision === true ? h('span', { key: 'v', style: { ...css.tag, marginLeft: '6px' } }, t('vision')) : null,
              priceSuffix(t, m.priceFactor) !== ''
                ? h('span', { key: 'p', style: css.price }, ` · ${priceSuffix(t, m.priceFactor)}`)
                : null,
            ),
            h('div', { style: css.id }, m.id),
          ),
          h('select', {
            style: css.select,
            value: m.override === undefined ? '' : String(m.override),
            disabled: busy,
            title: t('windowDefaultHint'),
            onChange: event => {
              const value = event.target.value
              void writeWindow(all, m.id, value === '' ? undefined : Number(value))
            },
          },
            h('option', { key: 'default', value: '' }, `${t('windowDefault')} · ${windowLabel(m.defaultContextWindow)}`),
            choices.map(n => h('option', { key: String(n), value: String(n) }, windowLabel(n))),
          ),
        )
      })

      const advanced = buildAdvanced({
        t, form, snapshot,
        namespace: describeSnapshot.view?.namespaces?.find(n => n.ns === NS),
        show: showAdvanced,
        onToggle: () => setShowAdvanced(value => !value),
      })

      return h('div', { style: css.page },
        h('h2', { style: css.h2 }, t('title')),
        h('p', { style: css.intro }, t('intro')),

        // Search row: the field grows, the checkbox sits beside it.
        h('div', { style: css.bar },
          h('input', {
            style: { ...css.input, ...css.search },
            placeholder: t('search'),
            value: query,
            onChange: event => setQuery(event.target.value),
          }),
          h('label', { style: { ...css.note, display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } },
            h('input', { type: 'checkbox', checked: onlyEnabled, onChange: event => setOnlyEnabled(event.target.checked) }),
            t('onlyEnabled'),
          ),
        ),

        // Action row: all four buttons on one line, count pinned to the right.
        // `nowrap` keeps them together; the count takes the remaining space so
        // nothing wraps to a second line.
        h('div', { style: { ...css.bar, flexWrap: 'nowrap' } },
          h('button', { style: css.btn, disabled: busy, onClick: () => void load(true) }, t('refresh')),
          h('button', {
            style: css.btn,
            disabled: busy || all.every(m => m.enabled),
            onClick: () => void writeAll(true),
          }, t('selectAll')),
          h('button', {
            style: css.btn,
            disabled: busy || enabledTotal === 0,
            onClick: () => void writeAll(false),
          }, t('selectNone')),
          h('span', { style: css.count }, `${t('enabledCount')} ${enabledTotal} / ${all.length}`),
        ),

        all.length === 0
          ? h('div', { style: css.note }, t('noModels'))
          : h('div', { style: css.list }, rows.length > 0 ? rows : h('div', { style: { ...css.note, padding: '12px 14px' } }, '—')),

        all.length > 0 ? h('div', { style: css.note }, t('windowWarn')) : null,
        error !== undefined ? h('div', { style: css.err }, error) : null,
        status !== undefined && error === undefined ? h('div', { style: css.note }, status) : null,

        h('div', { style: css.group },
          h('h3', { style: css.h3 }, t('cliGroup')),
          h('div', { style: css.note }, t('cliHint')),
          h('div', { style: { ...css.bar, flexWrap: 'nowrap' } },
            h('button', { style: css.btn, disabled: setupRunning, onClick: () => void startCliSetup('configure') }, t('cliRun')),
            h('button', { style: css.btn, disabled: setupRunning, onClick: () => void startCliSetup('check') }, t('cliCheck')),
            h('span', { style: css.count }, setupRunning
              ? t('cliRunning')
              : setupError !== undefined
                ? setupError
                : setupCode === 0
                  ? t('cliExitOk')
                  : setupCode === undefined || setupCode === null
                    ? ''
                    : `${t('cliExitFail')} ${setupCode}`),
          ),
          setupLines.length > 0
            ? h('pre', { ref: logRef, style: css.log }, setupLines.join('\n'))
            : null,
        ),

        advanced,
      )
    }

    /**
     * The collapsed advanced block: the remaining scalars, rendered against the
     * host's schema so labels, bounds and defaults stay in one place.
     */
    function buildAdvanced({ t, form, snapshot, namespace, show, onToggle }) {
      const header = h('div', { style: css.bar },
        h('button', { style: css.btn, onClick: onToggle }, show ? t('hide') : t('show')),
        h('span', { style: css.note }, t('advancedHint')),
      )
      if (!show) {
        return h('div', { style: css.group }, h('h3', { style: css.h3 }, t('advanced')), header)
      }

      const value = snapshot?.value ?? {}
      const user = snapshot?.user
      const schema = namespace?.schema
      const refs = schema?.refs
      const root = refs?.[schema?.uid]
      const writable = snapshot?.writable !== false

      const set = (key, next) => {
        const op = next === undefined || next === ''
          ? form.unset(key)
          : form.set(key, next)
        op.catch(() => undefined)
      }

      const rows = ADVANCED.map(([key, kind]) => {
        const node = refs?.[root?.dict?.[key]]
        if (node === undefined) return null
        const labels = t('advancedFields') ?? {}
        const help = typeof node?.meta?.description === 'string' ? node.meta.description : undefined
        const current = value[key]
        const overridden = user !== null && typeof user === 'object' && Object.hasOwn(user, key)

        let control
        if (kind === 'json') {
          control = h('input', {
            style: { ...css.input, fontFamily: 'ui-monospace, monospace' },
            defaultValue: current === undefined ? '{}' : JSON.stringify(current),
            disabled: !writable,
            onBlur: event => {
              try { set(key, JSON.parse(event.target.value)) } catch { /* keep the last valid value */ }
            },
          })
        } else {
          control = h('input', {
            style: css.input,
            type: kind === 'number' ? 'number' : 'text',
            value: current === undefined ? '' : String(current),
            min: node?.meta?.min,
            max: node?.meta?.max,
            step: node?.meta?.step,
            disabled: !writable,
            onChange: event => {
              const raw = event.target.value
              if (raw === '') { set(key, undefined); return }
              set(key, kind === 'number' ? Number(raw) : raw)
            },
          })
        }

        return h('div', { key, style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h('span', { style: css.advLabel }, labels[key] ?? key),
            overridden && writable
              ? h('button', {
                  style: { fontSize: '0.75em', opacity: 0.55, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit', color: 'inherit' },
                  onClick: () => set(key, undefined),
                }, t('reset'))
              : null,
          ),
          control,
          help !== undefined ? h('div', { style: css.note }, help) : null,
        )
      }).filter(Boolean)

      return h('div', { style: css.group },
        h('h3', { style: css.h3 }, t('advanced')),
        header,
        rows,
      )
    }

    /** Register the section; the shell renders it in the Settings nav. */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'llm-qoder-cn: dictionaries')
      ctx.effect(() => ctx.configForms.whileServed([NS], () => ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'qoder-cn',
        order: 36,
        label: () => t('nav'),
        locale: NS,
      }, props => h(SettingsPage, { ...props, ctx, t })))), 'llm-qoder-cn: page')
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-qoder-link'
    exports.__test = { windowLabel, priceSuffix, ADVANCED, zh, en }
    return module.exports
  },
})
