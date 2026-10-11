/**
 * dsh-llm-qoder-cn — browser half.
 *
 * Contributes one top-level settings section (`settings.section`, id
 * `qoder-cn`), so the plugin's configuration gets its own entry in the Settings
 * nav beside General / Models / Plugins.
 *
 * Why this file exists: DSH can auto-generate a page from a plugin's exported
 * `Config` schema, but that page renders inside the *Plugins* settings section.
 * A client bundle that does not ship that section has nowhere to put it — the
 * schema registers and the settings service can read it, yet no nav entry and no
 * page ever appear. Registering our own `settings.section` makes the page
 * reachable regardless of which sections the deployment ships.
 *
 * Reads and writes go through `ctx.configForms`, the shared settings mirror the
 * stock Models page also uses: `get(ns)` yields a form whose `subscribe` pushes
 * snapshot replacements and whose `set`/`unset` queue revision-fenced writes.
 * Each control is generated from the schema the Host reports, so the form cannot
 * drift from the `Config` declaration in `src/config.ts`.
 *
 * The section is mounted through `configForms.whileServed`, so a deployment that
 * never composed this plugin's host half shows no trace of the page.
 *
 * Hand-written ModuleLoader bundle: no build step, and no dependency beyond the
 * `react` the shell already provides. Colour comes from theme variables.
 */

window.__ModuleLoader__.load({
  id: 'dsh-llm-qoder-cn',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback, useSyncExternalStore } = React

    /** The plugin's config namespace — must equal the profile row id. */
    const NS = 'llm-qoder-cn'
    const inject = ['slots', 'locale', 'configForms']

    // ── copy ────────────────────────────────────────────────────────────────
    const zh = {
      nav: 'Qoder CN',
      title: 'Qoder CN',
      intro: '基于官方 Qoder CN Agent SDK 的模型接入。复用本机 qoderclicn 登录态，无需填写任何密钥。',
      loading: '读取配置中…',
      unavailable: '宿主未提供该配置命名空间。',
      readonly: '当前 profile 不可写，只能查看。',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败',
      reset: '恢复默认',
      on: '开',
      off: '关',
      groupIdentity: '身份',
      groupSession: '会话容量',
      groupContext: '上下文窗口',
      groupTimeout: '超时',
      groupModels: '模型',
      groupBehaviour: '行为',
      ctxNote: '窗口决定 DSH 的自动压缩阈值（阈值 ≈ 比例 × 窗口）。选最大窗口会让压缩更晚触发。',
      jsonHint: '按 JSON 编辑；输入过程中的语法错误会被忽略。',
    }
    const en = {
      nav: 'Qoder CN',
      title: 'Qoder CN',
      intro: 'Qoder CN models through the official Agent SDK. Reuses the local qoderclicn login; no credential entry needed.',
      loading: 'Loading configuration…',
      unavailable: 'The host does not expose this configuration namespace.',
      readonly: 'This profile is read-only.',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Save failed',
      reset: 'Reset to default',
      on: 'on',
      off: 'off',
      groupIdentity: 'Identity',
      groupSession: 'Session capacity',
      groupContext: 'Context window',
      groupTimeout: 'Timeouts',
      groupModels: 'Models',
      groupBehaviour: 'Behaviour',
      ctxNote: 'The window sets DSH\u2019s auto-compaction threshold (threshold \u2248 ratio \u00d7 window). The largest window delays compaction.',
      jsonHint: 'Edited as JSON; syntax errors while typing are ignored.',
    }

    /** Field → group, so the form reads in sections rather than one long list. */
    const GROUPS = [
      ['groupIdentity', ['displayName', 'byokDisplayName', 'byokRoute']],
      ['groupSession', ['maxSessions', 'modelCacheTtlSeconds']],
      ['groupContext', ['contextWindowMode', 'contextWindowOverride', 'compactionThresholdHint', 'defaultMaxTokens']],
      ['groupTimeout', ['toolResultTimeoutSeconds', 'catalogFetchTimeoutSeconds', 'abortGraceSeconds', 'coldMaxTurns']],
      ['groupModels', ['enabledModels', 'disabledModels', 'modelAliases']],
      ['groupBehaviour', ['identityOverride', 'defaultReasoningEffort']],
    ]

    const css = {
      page: { maxWidth: '760px', display: 'flex', flexDirection: 'column', gap: '14px', color: 'var(--dsw-alias-label-primary)' },
      h2: { margin: '0', fontSize: '1.25em' },
      intro: { margin: '0', opacity: 0.72, lineHeight: 1.55, fontSize: '0.92em' },
      group: { display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.25))', borderRadius: '10px', padding: '14px 16px' },
      groupTitle: { margin: '0', fontSize: '0.95em', fontWeight: 600, opacity: 0.85 },
      row: { display: 'flex', flexDirection: 'column', gap: '4px' },
      label: { fontSize: '0.9em', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '8px' },
      resetBtn: { fontSize: '0.75em', opacity: 0.55, fontWeight: 400, background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0, font: 'inherit', color: 'inherit' },
      help: { fontSize: '0.82em', opacity: 0.62, lineHeight: 1.45 },
      input: { padding: '7px 9px', borderRadius: '7px', border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.35))', background: 'var(--dsw-alias-bg-base, transparent)', color: 'inherit', font: 'inherit', width: '100%', boxSizing: 'border-box' },
      mono: { fontFamily: 'ui-monospace, monospace', fontSize: '0.85em', minHeight: '64px' },
      check: { display: 'flex', alignItems: 'center', gap: '8px' },
      bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      note: { fontSize: '0.82em', opacity: 0.62 },
      status: { fontSize: '0.85em', opacity: 0.75 },
      err: { fontSize: '0.85em', color: 'var(--dsw-alias-label-danger, #e03131)' },
    }

    /** Read one schema node's enum members, across the shapes schemastery emits. */
    function enumMembers(node) {
      if (node === undefined || node === null) return []
      if (Array.isArray(node.list)) {
        return node.list
          .map(entry => (entry !== null && typeof entry === 'object' ? entry.value : entry))
          .filter(value => typeof value === 'string')
      }
      return []
    }

    /** Resolve a field's schema node out of the serialized envelope. */
    function nodeOf(schema, key) {
      const refs = schema?.refs
      const root = refs?.[schema?.uid]
      const ref = root?.dict?.[key]
      return ref === undefined ? undefined : refs?.[ref]
    }

    /**
     * One generated control.
     *
     * `overridden` marks a field the user layer holds explicitly, so the reset
     * affordance is visibly meaningful rather than a no-op.
     */
    function Field({ name, node, value, overridden, writable, t, onChange, onReset }) {
      const meta = node?.meta ?? {}
      const type = node?.type
      const help = typeof meta.description === 'string' ? meta.description : undefined

      let control
      if (type === 'boolean') {
        control = h('label', { style: css.check },
          h('input', {
            type: 'checkbox',
            checked: value === true,
            disabled: !writable,
            onChange: event => onChange(event.target.checked),
          }),
          h('span', null, value === true ? t('on') : t('off')),
        )
      } else if (type === 'union') {
        const members = enumMembers(node)
        control = h('select', {
          style: css.input,
          value: value === undefined ? '' : String(value),
          disabled: !writable,
          onChange: event => onChange(event.target.value),
        }, members.map(member => h('option', { key: member, value: member }, member)))
      } else if (type === 'array' || type === 'dict') {
        control = h('textarea', {
          style: { ...css.input, ...css.mono },
          value: value === undefined ? (type === 'array' ? '[]' : '{}') : JSON.stringify(value, null, 1),
          disabled: !writable,
          onChange: event => {
            try {
              onChange(JSON.parse(event.target.value))
            } catch {
              /* keep the last valid value while the user is mid-edit */
            }
          },
        })
      } else if (type === 'number') {
        control = h('input', {
          type: 'number',
          style: css.input,
          value: value === undefined ? '' : String(value),
          min: meta.min,
          max: meta.max,
          step: meta.step,
          disabled: !writable,
          onChange: event => {
            const raw = event.target.value
            onChange(raw === '' ? undefined : Number(raw))
          },
        })
      } else {
        control = h('input', {
          type: 'text',
          style: css.input,
          value: value === undefined ? '' : String(value),
          disabled: !writable,
          onChange: event => onChange(event.target.value),
        })
      }

      return h('div', { style: css.row },
        h('label', { style: css.label },
          name,
          overridden && writable
            ? h('button', { style: css.resetBtn, onClick: onReset }, t('reset'))
            : null,
        ),
        control,
        help !== undefined ? h('div', { style: css.help }, help) : null,
        type === 'array' || type === 'dict' ? h('div', { style: css.note }, t('jsonHint')) : null,
      )
    }

    /** The settings page: schema-driven form over the plugin's config namespace. */
    function SettingsPage({ ctx, t }) {
      const form = ctx.configForms.get(NS)
      const subscribe = useCallback(listener => form.subscribe(listener), [form])
      const read = useCallback(() => form.getSnapshot(), [form])
      const snapshot = useSyncExternalStore(subscribe, read)

      const describeFace = ctx.configForms.describe()
      const describeSubscribe = useCallback(listener => describeFace.subscribe(listener), [describeFace])
      const describeRead = useCallback(() => describeFace.getSnapshot(), [describeFace])
      const describeSnapshot = useSyncExternalStore(describeSubscribe, describeRead)

      const [status, setStatus] = useState(undefined)
      const [error, setError] = useState(undefined)

      // First use must kick the shared mirror; it starts idle.
      useEffect(() => { describeFace.ensure().catch(() => undefined) }, [describeFace])

      const namespace = describeSnapshot.view?.namespaces?.find(entry => entry.ns === NS)

      if (snapshot.status === 'loading' && namespace === undefined) {
        return h('div', { style: css.page }, h('h2', { style: css.h2 }, t('title')), h('div', { style: css.status }, t('loading')))
      }
      if (namespace === undefined) {
        return h('div', { style: css.page }, h('h2', { style: css.h2 }, t('title')), h('div', { style: css.note }, t('unavailable')))
      }

      const schema = namespace.schema ?? {}
      const value = snapshot.value ?? {}
      const user = snapshot.user
      const writable = snapshot.writable !== false

      const write = (key, next) => {
        setError(undefined)
        setStatus(t('saving'))
        const op = next === undefined || next === ''
          ? form.unset(key)
          : form.set(key, next)
        op.then(ok => {
          setStatus(ok ? t('saved') : t('failed'))
          if (!ok) setError(t('failed'))
        }).catch(err => {
          setStatus(undefined)
          setError(String(err?.message ?? err))
        })
      }

      const groups = GROUPS.map(([titleKey, keys]) => {
        const present = keys.filter(key => nodeOf(schema, key) !== undefined)
        if (present.length === 0) return null
        return h('div', { key: titleKey, style: css.group },
          h('h3', { style: css.groupTitle }, t(titleKey)),
          present.map(key => h(Field, {
            key,
            name: key,
            node: nodeOf(schema, key),
            value: value[key],
            overridden: user !== null && typeof user === 'object' && Object.hasOwn(user, key),
            writable,
            t,
            onChange: next => write(key, next),
            onReset: () => write(key, undefined),
          })),
          titleKey === 'groupContext' ? h('div', { style: css.note }, t('ctxNote')) : null,
        )
      }).filter(Boolean)

      return h('div', { style: css.page },
        h('h2', { style: css.h2 }, t('title')),
        h('p', { style: css.intro }, t('intro')),
        !writable ? h('div', { style: css.note }, t('readonly')) : null,
        groups,
        status !== undefined ? h('div', { style: css.status }, status) : null,
        error !== undefined ? h('div', { style: css.err }, error) : null,
      )
    }

    /**
     * Mount the settings section while the Host serves this plugin's namespace.
     * @param ctx - the browser plugin context.
     */
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
    exports.name = 'dsh-llm-qoder-cn'
    exports.__test = { enumMembers, nodeOf, GROUPS, zh, en }
    return module.exports
  },
})
