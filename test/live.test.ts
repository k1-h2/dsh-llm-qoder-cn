/**
 * Regression guard for the "settings edits never apply" bug.
 *
 * Every config field of this plugin is `.volatile()`, and the loader commits
 * such an edit into the *running* plugin's config cells instead of restarting
 * it — `apply()` is not called again. The adapter therefore has to read each
 * value where it uses it; one that copies them into fields in its constructor
 * keeps serving mount-time config for the rest of the process, and the settings
 * page appears to save changes that never take effect.
 *
 * These tests reproduce the loader's commit precisely — validate a new raw
 * config through the plugin's own schema, then copy those values into the refs
 * the mounted plugin already holds — and assert the mounted adapter follows,
 * with no second `apply()`.
 */
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { describe, expect, it } from 'vitest'
import {
  Config, QODER_BYOK_PROVIDER, QODER_PROVIDER, apply, liveConfig, resolveConfig,
} from '../src/index.ts'

/**
 * Validate a raw config the way the loader does.
 *
 * `~standard.validate` answers `{ value, issues }`, and the value it returns is
 * the one whose fields are `Volatile` references.
 */
function parse(raw: Record<string, unknown>): Record<string, any> {
  const result = (Config as any)['~standard'].validate(raw)
  if (result.issues !== undefined) throw new Error(JSON.stringify(result.issues))
  return result.value
}

/** A plugin context that records what `apply()` registers. */
function stubContext() {
  const recorded = {
    routes: [] as string[],
    directory: [] as { displayName: string }[],
    adapter: undefined as any,
    replaced: [] as unknown[],
    volatileListener: undefined as undefined | ((paths: readonly (readonly string[])[]) => void),
  }
  const handle = (onReplace: (next: any) => void) => Object.assign(() => {}, {
    replace: (next: any) => { recorded.replaced.push(next); onReplace(next) },
  })
  const ctx = {
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    llm: {
      registerAdapter: (providers: string[], adapter: unknown) => {
        recorded.routes = [...providers]
        recorded.adapter = adapter
        return handle((next: string[]) => { recorded.routes = [...next] })
      },
      registerConfigurableProviders: (entries: { displayName: string }[]) => {
        recorded.directory = entries.map(entry => ({ ...entry }))
        return handle((next: { displayName: string }[]) => {
          recorded.directory = next.map(entry => ({ ...entry }))
        })
      },
    },
    inject: () => {},
    effect: (fn: () => unknown) => fn(),
    on: (event: string, listener: any) => {
      if (event === 'loader/volatile-update') recorded.volatileListener = listener
    },
  }
  return { ctx, recorded }
}

describe('live config', () => {
  it('follows an in-place volatile commit without re-applying', () => {
    const mounted = parse({
      disabledModels: ['auto', 'qmodel_38max'],
      modelContextWindows: { auto: 200_000 },
      defaultMaxTokens: 32_000,
      displayName: 'Qoder CN',
      byokRoute: 'separate',
    })
    const { ctx, recorded } = stubContext()
    apply(ctx as any, mounted as any)
    const adapter = recorded.adapter

    expect(recorded.routes).toEqual([QODER_PROVIDER, QODER_BYOK_PROVIDER])
    expect(adapter.isModelDisabled('auto')).toBe(true)
    expect(adapter.contextWindowFor('auto')).toBe(200_000)

    // The write the settings page performs, as the loader commits it.
    const edited = parse({
      disabledModels: [],
      modelContextWindows: { auto: 200_000, qfmodel: 1_000_000 },
      defaultMaxTokens: 64_000,
      displayName: 'Qoder 工作号',
      byokRoute: 'inline',
    })
    updateVolatile(mounted.disabledModels, edited.disabledModels)
    updateVolatile(mounted.modelContextWindows, edited.modelContextWindows)
    updateVolatile(mounted.defaultMaxTokens, edited.defaultMaxTokens)
    updateVolatile(mounted.displayName, edited.displayName)
    updateVolatile(mounted.byokRoute, edited.byokRoute)

    expect(adapter.disabledModelIds()).toEqual([])
    expect(adapter.isModelDisabled('auto')).toBe(false)
    expect(adapter.modelWindowChoices()).toEqual({ auto: 200_000, qfmodel: 1_000_000 })
    expect(adapter.providerInfo(QODER_PROVIDER).name).toBe('Qoder 工作号')
    expect(liveConfig(mounted).defaultMaxTokens()).toBe(64_000)
  })

  it('republishes the routes and labels only when a structural field moves', () => {
    const mounted = parse({ byokRoute: 'separate', displayName: 'Qoder CN' })
    const { ctx, recorded } = stubContext()
    apply(ctx as any, mounted as any)

    const edited = parse({ byokRoute: 'inline', displayName: 'Qoder 工作号' })
    updateVolatile(mounted.byokRoute, edited.byokRoute)
    updateVolatile(mounted.displayName, edited.displayName)

    expect(recorded.routes).toEqual([QODER_PROVIDER, QODER_BYOK_PROVIDER])
    recorded.volatileListener?.([['byokRoute']])
    expect(recorded.routes).toEqual([QODER_PROVIDER])
    expect(recorded.directory.map(entry => entry.displayName)).toEqual(['Qoder 工作号'])

    recorded.replaced.length = 0
    recorded.volatileListener?.([['disabledModels']])
    expect(recorded.replaced).toEqual([])
  })

  it('keeps the two config views equivalent, including defaults', () => {
    const mounted = parse({ disabledModels: ['auto'], modelContextWindows: { auto: 1 } })
    const live = liveConfig(mounted)
    const snapshot = resolveConfig(mounted)

    expect({
      disabledModels: live.disabledModels(),
      modelContextWindows: live.modelContextWindows(),
      maxSessions: live.maxSessions(),
      identityOverride: live.identityOverride(),
      defaultReasoningEffort: live.defaultReasoningEffort(),
    }).toEqual({
      disabledModels: snapshot.disabledModels,
      modelContextWindows: snapshot.modelContextWindows,
      maxSessions: snapshot.maxSessions,
      identityOverride: snapshot.identityOverride,
      defaultReasoningEffort: snapshot.defaultReasoningEffort,
    })
  })

  it('runs on defaults when the profile row carries no config at all', () => {
    const live = liveConfig(undefined)
    expect(live.disabledModels()).toEqual([])
    expect(live.maxSessions()).toBe(8)
    expect(live.identityOverride()).toBe(false)
    expect(live.defaultReasoningEffort()).toBeUndefined()
  })
})
