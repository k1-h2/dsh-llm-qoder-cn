/**
 * Finding the local Qoder CLI, and the Node that has to run it.
 *
 * The SDK's default transport runs its worker runtime on a Node worker thread,
 * which is a thread *inside* the DSH process. On Windows that puts the worker's
 * bundled sharp (libvips 8.17) into the same address space as DSH's own sharp
 * (libvips 8.18), and the loader satisfies the worker's `libvips-42.dll` import
 * from the module already registered under that name. The ABI mismatch that
 * follows fails every turn carrying an image, with libvips reporting
 * `colourspace: parameter space not set` and the CLI answering
 * `image_processing_failed`.
 *
 * A child process has its own address space, and is how an installed
 * `qoderclicn` runs by itself anyway, so sessions hand the SDK an entry it can
 * spawn. Naming that entry is all it takes: the SDK picks its process transport
 * for any `pathToQoderCLIExecutable` that is not a worker-runtime module, which
 * is exactly the transport that must not be used here.
 *
 * Nothing is invented. The CLI is looked for where the setup helper installs
 * it and where the SDK bundles it; the Node to run it is the host's own, DSH's
 * shipped runtime, or whatever `PATH` answers. When none of that is present the
 * lookup returns nothing and the SDK keeps its default transport — worse for
 * images, but not this module's place to fail a session over.
 *
 * @module dsh-qoder-link/cli
 */
import type { Options } from '@qodercn-ai/qodercn-agent-sdk';
/** The query options that move a session onto the CLI's own process. */
export type QoderCliOptions = Pick<Options, 'pathToQoderCLIExecutable' | 'executable' | 'env'>;
/** A CLI entry that can be spawned, plus the directory of the Node that runs it. */
export interface QoderCli {
    /** Path to the CLI: a native binary, or a script the Node below runs. */
    path: string;
    /** Directory holding the interpreter for a script entry; absent for a binary. */
    nodeDir?: string;
}
/**
 * What the lookup reads. Injectable so a test can describe a machine instead of
 * having to be one, and so a caller can point the search somewhere else.
 */
export interface CliLookup {
    /** Environment to read; defaults to this process's. */
    env?: NodeJS.ProcessEnv;
    /** Platform whose layouts to follow; defaults to this process's. */
    platform?: NodeJS.Platform;
    /** File-existence probe; defaults to the real filesystem. */
    exists?(candidate: string): boolean;
    /** Directory listing; defaults to the real filesystem. */
    readdir?(dir: string): readonly string[];
    /** The running interpreter; defaults to this process's executable. */
    execPath?: string;
    /** Whether that interpreter is Electron rather than Node; defaults to the truth. */
    electron?: boolean;
}
/**
 * A CLI the SDK can spawn, or nothing when this machine offers none.
 *
 * Candidates are tried in the order a user's own shell would resolve them:
 * an explicit `QODERCLI_PATH` first, then the npm global roots, then the
 * native builds the SDK and the CLI's own installer place. A worker-runtime
 * module is skipped wherever it turns up, since the SDK answers such a path
 * with the in-process worker this module exists to avoid.
 */
export declare function resolveQoderCli(lookup?: CliLookup): QoderCli | undefined;
/**
 * Query options that route a session through the CLI's own process.
 *
 * Empty when no CLI was found: the caller spreads this into its options, so an
 * empty answer leaves the SDK's default transport in place.
 */
export declare function qoderCliOptions(lookup?: CliLookup): QoderCliOptions;
