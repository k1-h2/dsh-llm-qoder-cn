/**
 * Runs the bundled Windows helper that installs and signs into the Qoder CN CLI.
 *
 * The settings page cannot do this by itself: a browser has no way to start a
 * local process, and the plugin's own process is the one that already talks to
 * the CLI. So the page asks this module, and this module spawns
 * {@link SCRIPT_NAME} — the same script a user can double-click — with one of
 * two fixed flags, and buffers its output so the page can show progress while
 * the browser sign-in is still open.
 *
 * Nothing user-supplied reaches the command line: the mode is an allow-list of
 * two keys mapped to two literal flags, and the script path comes from this
 * package's own layout. The helper is idempotent, so a second click re-checks
 * rather than reinstalling.
 *
 * @module dsh-qoder-link/setup
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TextDecoder } from 'node:util'

/** File name of the helper, shipped under this package's `scripts/` directory. */
export const SCRIPT_NAME = 'setup-qoderclicn.bat'

/** What the page may ask for: verify only, or install + sign in. */
export type SetupMode = 'check' | 'configure'

/** The one command-line flag each mode maps to. Never a user-supplied string. */
const FLAGS: Record<SetupMode, string> = {
  check: '--check',
  configure: '--gui',
}

/** Whether a value is one of the two modes the page may request. */
export function isSetupMode(value: unknown): value is SetupMode {
  return value === 'check' || value === 'configure'
}

/** Cap on kept output, so a chatty `npm install` cannot grow without bound. */
const MAX_LINES = 400

/** One run's state, kept for the lifetime of the process plus its tail. */
interface Run {
  child: ChildProcess
  mode: SetupMode
  startedAt: number
  finishedAt?: number
  code?: number | null
  lines: string[]
  /** Text decoded but not yet terminated by a newline. */
  pending: string
  decoder: TextDecoder
  truncated: boolean
}

let current: Run | undefined

/** Snapshot the page polls. Always safe to render; empty before the first run. */
export interface SetupStatus {
  running: boolean
  mode?: SetupMode
  startedAt?: number
  finishedAt?: number
  /** Exit code once finished; `null` when the process could not be started. */
  code?: number | null
  lines: string[]
  truncated: boolean
}

/**
 * Locate the helper inside this package.
 *
 * The host half is bundled to `lib/index.js`, and tests import `src/*.ts`, so
 * both layouts resolve to the same `scripts/` directory one level up.
 */
export function setupScriptPath(): string | undefined {
  const here = path.dirname(fileURLToPath(import.meta.url))
  for (const candidate of [
    path.resolve(here, '..', 'scripts', SCRIPT_NAME),
    path.resolve(here, 'scripts', SCRIPT_NAME),
  ]) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Append decoded text to a run, splitting it into displayable lines. */
function absorb(run: Run, chunk: Uint8Array, done: boolean): void {
  run.pending += run.decoder.decode(chunk, { stream: !done })
  const parts = run.pending.split(/\r\n|\r|\n/)
  run.pending = done ? '' : (parts.pop() ?? '')
  for (const part of parts) {
    // cmd.exe echoes a bare prompt line as whitespace-only; keep the tail dense.
    if (part.trim() === '') continue
    run.lines.push(part)
  }
  if (done && run.pending.trim() !== '') run.lines.push(run.pending.trim())
  while (run.lines.length > MAX_LINES) {
    run.lines.shift()
    run.truncated = true
  }
}

/** Why a run could not start, so the caller can pick a status of its own. */
export type SetupFailure = 'busy' | 'unsupported' | 'missing-script'

/** Start the helper. Only one run at a time; a finished one stays readable. */
export function startSetup(
  mode: SetupMode,
  onFinish?: (code: number | null) => void,
): { started: true } | { started: false; reason: SetupFailure; error: string } {
  if (current !== undefined && current.finishedAt === undefined) {
    return { started: false, reason: 'busy', error: '已经有一次配置在跑了，请等它结束。' }
  }
  if (process.platform !== 'win32') {
    return {
      started: false,
      reason: 'unsupported',
      error: '一键配置只支持 Windows，请在 CLI 所在机器上手动安装并登录 qoderclicn。',
    }
  }
  const script = setupScriptPath()
  if (script === undefined) {
    return {
      started: false,
      reason: 'missing-script',
      error: `插件包里没有 ${SCRIPT_NAME}，缺少 scripts/ 目录。`,
    }
  }

  const run: Run = {
    child: undefined as unknown as ChildProcess,
    mode,
    startedAt: Date.now(),
    lines: [],
    pending: '',
    decoder: new TextDecoder('utf-8'),
    truncated: false,
  }
  // The helper writes nothing to stdin, and its own child CLI resolves its home
  // from it, so run from the user's home rather than inside the package.
  const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', script, FLAGS[mode]], {
    cwd: homedir(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  run.child = child
  current = run

  // Settles the run exactly once and hands the caller the exit code, so the
  // page's next read of the catalog is not served from a pre-login snapshot.
  const finish = (code: number | null): void => {
    if (run.finishedAt !== undefined) return
    run.finishedAt = Date.now()
    run.code = code
    try {
      onFinish?.(code)
    } catch (error) {
      run.lines.push(`收尾回调失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  child.stdout?.on('data', (chunk: Buffer) => absorb(run, chunk, false))
  child.stderr?.on('data', (chunk: Buffer) => absorb(run, chunk, false))
  child.on('error', error => {
    run.lines.push(`无法启动 ${SCRIPT_NAME}：${error instanceof Error ? error.message : String(error)}`)
    finish(null)
  })
  child.on('close', code => {
    absorb(run, new Uint8Array(), true)
    finish(code)
  })
  return { started: true }
}

/** The current run, with any not-yet-newlined tail included for live display. */
export function readSetupStatus(): SetupStatus {
  if (current === undefined) return { running: false, lines: [], truncated: false }
  const lines = current.pending.trim() === ''
    ? current.lines
    : [...current.lines, current.pending.trim()]
  return {
    running: current.finishedAt === undefined,
    mode: current.mode,
    startedAt: current.startedAt,
    ...current.finishedAt === undefined ? {} : { finishedAt: current.finishedAt, code: current.code ?? null },
    lines,
    truncated: current.truncated,
  }
}

/**
 * Abandon the running helper, if any.
 *
 * Called when the plugin is disposed. Killing `cmd.exe` does not reap the CLI it
 * already launched, but the helper's own wait is bounded, so nothing hangs on
 * the far end.
 */
export function stopSetup(): void {
  if (current !== undefined && current.finishedAt === undefined) current.child.kill()
}
