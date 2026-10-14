import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'
import { initialNavigation, type ModelState, type Navigation, push } from './panel/navigation'
import { renderPane } from './panel/pane'
import { resolveEvidenceOwner } from './panel/evidence-owner'
import { containedPath, isUnder } from './model/paths'
import { type BehaviourModel, type BuildStatus, parseBehaviourModel } from './model/behaviour-model'
import { verifyEvidence } from './model/evidence-check'
import {
  applyStepDiffs,
  BUILD_TIMEOUT_MS,
  BUILDER_AGENT,
  type BuildSubject,
  buildStatusOf,
  builderPrompt,
  cachePathFor,
  dropTwinsOfUnverified,
  formatLoadResult,
  fragmentNameFor,
  fragmentSubjectOf,
  gitDirOf,
  isCacheDir,
  isFragmentShapeFor,
  isFullShaModelPath,
  isModelPath,
  mergeFragment,
  type PendingBuild,
  type PendingBuilds,
  resolvableStack,
  settleOrphanBuilds,
  spawnDescription,
  subjectKey,
  subjectName,
  withBuildStatus,
} from './drill-down'
import { MAX_SNIPPETS, type Snippets, sliceSnippet, snippetKey } from './panel/evidence-view'

export const PANE_ID = 'how'

// Task 10 writes `model`; the panel writes `nav`.
export const modelState = atom({ plugin: 'how', key: 'model' } as const, {} as ModelState)
export const navState = atom({ plugin: 'how', key: 'nav' } as const, initialNavigation())

export const snippetsState = atom({ plugin: 'how', key: 'snippets' } as const, {} as Snippets)
export const pendingState = atom({ plugin: 'how', key: 'pending' } as const, {} as PendingBuilds)

/** The `model` atom as the hooks hold it: the contract types the model as plain data, parseBehaviourModel checked it. */
const readModel = async ($: any): Promise<ModelState> => (await read($, modelState)) as ModelState
const asStored = (s: ModelState) => s as { path?: string; source?: string; model?: { [key: string]: unknown }; error?: string }

/**
 * Show the Evidence view for `ownerId`'s `index`th Evidence: read the cited file (relative paths resolve against
 * the session cwd), keep the cited lines ±3 in the `snippets` atom, then push the view. A read failure is stored as
 * `{ error }` and the view still opens ("source unavailable"). From an Evidence view of the same owner (prev/next)
 * the top entry is replaced rather than stacked.
 */
export async function openEvidence($: any, ownerId: string, index: number): Promise<void> {
  const { model } = await readModel($)
  const owner = model && resolveEvidenceOwner(model, ownerId)
  const item = owner?.evidence[index]
  // Removed code cites base lines: the head file is never read for it (the view shows its hunk instead).
  if (item && !owner?.removed) {
    const key = snippetKey(item)
    let value: Snippets[string]
    let cwd: string | undefined
    try {
      cwd = await $.session.cwd()
    } catch {
      cwd = undefined
    }
    const rel = containedPath(item.file, cwd)
    if (rel === undefined) {
      value = { error: `path outside the repository: ${item.file}` }
    } else {
      try {
        value = sliceSnippet(String(await $.fs.read(rel)), item.startLine, item.endLine, item.file)
      } catch (err) {
        value = { error: err instanceof Error ? err.message : String(err) }
      }
    }
    await update($, snippetsState, (s: Snippets) => {
      const { [key]: _old, ...rest } = s
      return Object.fromEntries(Object.entries({ ...rest, [key]: value }).slice(-MAX_SNIPPETS))
    })
  }
  await update($, navState, (nv: Navigation) => {
    const top = nv.stack[nv.stack.length - 1]
    const next = push(nv, { kind: 'evidence', ownerId, index })
    return top?.kind === 'evidence' && top.ownerId === ownerId
      ? { ...next, stack: [...nv.stack.slice(0, -1), next.stack[next.stack.length - 1]!] }
      : next
  })
}

type ToolAnswer = { result: string } | { deny: string }
const errText = (err: unknown) => (err instanceof Error ? err.message : String(err))
const pretty = (m: BehaviourModel) => JSON.stringify(m, null, 2)
const BAD_MODEL_PATH = 'modelPath must be a Behaviour model file, <folder>/how/<head sha>.json'
const BAD_CACHE_DIR =
  'cacheDir must be the absolute cache folder <git common dir>/how: right under a git dir (named .git or ending in .git, holding HEAD), with no empty, . or .. segment'
const SHORT_SHA = 'with cacheDir, modelPath must be named for the full 40- or 64-hex head sha: <folder>/how/<head sha>.json'
const NOT_HELD = (path: string | undefined) =>
  path === undefined
    ? 'modelPath must be the Behaviour model the panel holds, and it holds none: call mcp__how__open first'
    : `modelPath must be the Behaviour model the panel holds: ${path}`
const BAD_FRAGMENT_PATH = 'fragmentPath must be an absolute <folder>/how/<model sha>.<subject>.fragment.json, with no ..'
const NO_PENDING = 'no build is pending for this subject; stop, do not retry'

// The single writer of the Behaviour model: every load, merge and status change runs here one at a time, writing the
// file and then the `model` atom. Timers of pending builds sit beside it (neither survives a reload, nor do timers).
let writer: Promise<unknown> = Promise.resolve()
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const run = writer.then(fn, fn)
  writer = run.catch(() => undefined)
  return run
}
const buildTimers = new Map<string, { cancel: () => void }>()
/** Subjects a requestBuild is starting, reserved before its first await so a second press cannot spawn twice. */
const starting = new Set<string>()

async function logLine($: any, text: string): Promise<void> {
  try {
    await $.ui.log(text)
  } catch {
    // nowhere to log
  }
}

/** Verified Evidence reads: inside the cwd by spelling (containedPath) and by where it lands (realPath). */
async function evidenceReader($: any): Promise<(file: string) => Promise<string | undefined>> {
  let cwd: string | undefined
  try {
    cwd = await $.session.cwd()
  } catch {
    cwd = undefined
  }
  const root: string | undefined = (await $.fs.stat(cwd ?? '.', { resolve: true }).catch(() => undefined))?.realPath
  return async file => {
    const rel = containedPath(file, cwd)
    if (rel === undefined || root === undefined) return undefined
    const real: string | undefined = (await $.fs.stat(rel, { resolve: true }).catch(() => undefined))?.realPath
    if (real === undefined || !isUnder(real, root)) return undefined
    try {
      return String(await $.fs.read(rel))
    } catch {
      return undefined
    }
  }
}

async function openPane($: any): Promise<void> {
  try {
    await $.ui.open({ id: PANE_ID, title: 'how' })
  } catch {
    // no surface places panes: the model is loaded all the same
  }
}

/**
 * Verify head Evidence, then diff against base (so removed Steps keep their base Evidence), then write the file
 * (pretty JSON) and the atom. Call inside `serial`.
 */
async function commit($: any, modelPath: string, model: BehaviourModel) {
  const verified = await verifyEvidence(model, await evidenceReader($))
  // A head Step dropped for its Evidence takes its base twin with it, or the diff would call that twin removed.
  const diffed = applyStepDiffs(dropTwinsOfUnverified(model, verified.model))
  await $.fs.write(modelPath, pretty(diffed))
  await update($, modelState, () => asStored({ path: modelPath, model: diffed }))
  return { model: diffed, dropped: verified.dropped }
}

/** Stores the error under the write path, with the file to re-read when it differs (a staging copy). */
async function failLoad($: any, path: string, error: string, source?: string): Promise<ToolAnswer> {
  await serial(() => update($, modelState, () => asStored(source === undefined ? { path, error } : { path, source, error })))
  await openPane($)
  return { deny: error }
}

/**
 * `mcp__how__open` (keepNav false) and `mcp__how__refresh` without a fragment (keepNav true). Reads `modelPath` and
 * writes the verified model to `writePath` (the cache file when open names a cacheDir), which the atom then stores.
 */
async function loadModel($: any, modelPath: string, keepNav: boolean, writePath = modelPath): Promise<ToolAnswer> {
  const loaded = await serial(async () => {
    let text: string
    try {
      text = String(await $.fs.read(modelPath))
    } catch (err) {
      return { error: `Could not read the Behaviour model at ${modelPath}: ${errText(err)}` }
    }
    const parsed = parseBehaviourModel(text)
    if ('error' in parsed) return { error: parsed.error }
    const pendingKeys = new Set(Object.values(await read($, pendingState)).map(p => subjectKey(p.subject)))
    return commit($, writePath, settleOrphanBuilds(parsed.model, pendingKeys))
  }).catch(err => ({ error: `Could not load the Behaviour model at ${modelPath}: ${errText(err)}` }))
  if ('error' in loaded) return failLoad($, writePath, loaded.error, writePath === modelPath ? undefined : modelPath)
  await update($, navState, (nv: Navigation) => (keepNav ? resolvableStack(nv, loaded.model) : initialNavigation()))
  await openPane($)
  return { result: formatLoadResult(loaded.model, loaded.dropped) }
}

/** Sets a build status in the file and the atom. Call inside `serial`. */
async function writeStatus($: any, subject: BuildSubject, status: BuildStatus): Promise<void> {
  const { path, model } = await readModel($)
  if (path === undefined || model === undefined) return
  const next = withBuildStatus(model, subject, status)
  try {
    await $.fs.write(path, pretty(next))
  } catch (err) {
    await logLine($, `how: could not write the ${status} status of ${subjectKey(subject)} to ${path}: ${errText(err)}`)
  }
  await update($, modelState, s => ({ ...s, ...asStored({ model: next }) }))
}
const setStatus = ($: any, subject: BuildSubject, status: BuildStatus) => serial(() => writeStatus($, subject, status))

/** Forgets every pending build of the subject and cancels its timers. */
async function clearPending($: any, key: string): Promise<void> {
  const pending = await read($, pendingState)
  const ids = Object.keys(pending).filter(id => subjectKey(pending[id]!.subject) === key)
  if (ids.length === 0) return
  ids.forEach(id => (buildTimers.get(id)?.cancel(), buildTimers.delete(id)))
  await update($, pendingState, (p: PendingBuilds) => Object.fromEntries(Object.entries(p).filter(([id]) => !ids.includes(id))))
}

/** The builder `agentId` ended, or timed out, with no refresh: its subject failed. */
async function failPending($: any, agentId: string): Promise<void> {
  // Checked inside the writer: a merge queued ahead of this has already cleared the entry.
  await serial(async () => {
    const entry = (await read($, pendingState))[agentId]
    if (entry === undefined) return
    await clearPending($, subjectKey(entry.subject))
    await writeStatus($, entry.subject, 'failed')
  })
}

/** `mcp__how__refresh` with a fragment: merge it into the file model, verify, write; a bad merge fails the subject. */
async function mergeBuild($: any, modelPath: string, fragmentPath: string, pending: PendingBuild): Promise<ToolAnswer> {
  const out = await serial(async (): Promise<ToolAnswer> => {
    let modelText: string
    let fragmentText: string
    try {
      modelText = String(await $.fs.read(modelPath))
    } catch (err) {
      return { deny: `Could not read the Behaviour model at ${modelPath}: ${errText(err)}` }
    }
    const parsed = parseBehaviourModel(modelText)
    if ('error' in parsed) return { deny: parsed.error }
    try {
      fragmentText = String(await $.fs.read(fragmentPath))
    } catch (err) {
      await clearPending($, subjectKey(pending.subject))
      await writeStatus($, pending.subject, 'failed')
      return { deny: `Could not read the fragment at ${fragmentPath}: ${errText(err)}` }
    }
    const merged = mergeFragment(parsed.model, fragmentText)
    const subject = pending.subject
    await clearPending($, subjectKey(subject))
    if (merged.subject && subjectKey(merged.subject) !== subjectKey(pending.subject)) {
      await writeStatus($, pending.subject, 'failed')
      return { deny: `fragment builds ${subjectKey(merged.subject)} but ${fragmentPath} is for ${subjectKey(pending.subject)}` }
    }
    if ('error' in merged) {
      await writeStatus($, subject, 'failed')
      return { deny: merged.error }
    }
    const verified = await commit($, modelPath, merged.model)
    // $.fs has no delete: the fragment stays in the builder's $TMPDIR/how (the next build of the subject overwrites it).
    return { result: `${formatLoadResult(verified.model, verified.dropped)} (merged ${fragmentPath})` }
  }).catch(err => ({ deny: `Could not merge ${fragmentPath}: ${errText(err)}` }))
  const { model } = await readModel($)
  if ('result' in out && model) await update($, navState, (nv: Navigation) => resolvableStack(nv, model))
  return out
}

/**
 * Re-runs open on the stored model (the error state's `reload` Button): re-reads the staging copy a failed open with
 * cacheDir left as `source`, else the stored path, and writes the stored path. Nothing without one.
 */
export async function requestReload($: any): Promise<void> {
  const { path, source } = asStored(await readModel($))
  if (path !== undefined) await loadModel($, source ?? path, false, path)
}

/**
 * Builds a pending or failed Behaviour or Seam view: marks it `building`, spawns `how:behaviour-builder` to write a
 * fragment and call `mcp__how__refresh`, and fails it on a deny, on the builder's end without a refresh, or after
 * 10 minutes. Lives here because the engine follows `$` only into functions of the same file.
 */
export async function requestBuild($: any, subject: BuildSubject): Promise<void> {
  const key = subjectKey(subject)
  if (starting.has(key)) return
  starting.add(key) // before any await: a second press while this one starts is a no-op
  try {
    await startBuild($, subject, key)
  } finally {
    starting.delete(key) // started (then pending guards it), refused or failed
  }
}

async function startBuild($: any, subject: BuildSubject, key: string): Promise<void> {
  const { path, model } = await readModel($)
  if (path === undefined || model === undefined) return
  const pending = await read($, pendingState)
  if (Object.values(pending).some(p => subjectKey(p.subject) === key)) return
  if (buildStatusOf(model, subject) === 'building' || buildStatusOf(model, subject) === 'built') return
  await setStatus($, subject, 'building')
  const name = subjectName(model, subject)
  const fragmentName = fragmentNameFor(path, subject)
  let root: string | undefined
  try {
    root = typeof $.plugin.root === 'string' && $.plugin.root !== '' ? $.plugin.root : undefined
  } catch {
    root = undefined
  }
  const referencePath = root === undefined ? undefined : `${root}/skills/how/references/behaviour-model.md`
  const prompt = builderPrompt({ modelPath: path, subject, name, fragmentName, referencePath })
  let spawned: { agentId?: string; deny?: string }
  try {
    spawned = await $.agent.spawn({ subagentType: BUILDER_AGENT, description: spawnDescription(name), prompt })
  } catch (err) {
    spawned = { deny: errText(err) }
  }
  const agentId = spawned.agentId
  if (spawned.deny !== undefined || agentId === undefined) {
    await setStatus($, subject, 'failed')
    return
  }
  await update($, pendingState, (p: PendingBuilds) => ({ ...p, [agentId]: { subject, modelPath: path, fragmentName } }))
  try {
    buildTimers.set(agentId, $.clock.after(BUILD_TIMEOUT_MS, () => void failPending($, agentId)))
  } catch {
    // no clock: the builder's end still settles it
  }
}

const MODEL_PATH_SCHEMA = {
  type: 'string',
  description:
    'Absolute path of a Behaviour model file, <folder>/how/<head sha>.json: the cache file <git common dir>/how/<head sha>.json, ' +
    'or for open the staging file the model was just written to, $TMPDIR/how/<head sha>.json',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      await Promise.all([
        $.tool.register({
          name: 'open',
          description:
            'Load a Behaviour model into the `how` panel and open it. Call with the cache file, or after writing a new ' +
            'model to $TMPDIR/how/<full head sha>.json with cacheDir <git common dir>/how. Re-verifies every Evidence ' +
            'citation against the code, drops what does not check out, writes the verified model to the cache (with ' +
            'cacheDir, <cacheDir>/<head sha>.json; otherwise back to modelPath) and answers ' +
            '"<n> Behaviours, <d> elements dropped: <id: reason; …>": report what was dropped.',
          inputSchema: {
            type: 'object',
            properties: {
              modelPath: MODEL_PATH_SCHEMA,
              cacheDir: {
                type: 'string',
                description:
                  'Absolute path of the cache folder, <git common dir>/how (optional). The panel writes the verified ' +
                  'model there; the session never writes inside .git.',
              },
            },
            required: ['modelPath'],
          },
          isDeferred: false,
        }),
        $.tool.register({
          name: 'refresh',
          description:
            'Reload the Behaviour model in the `how` panel (modelPath must be the one it holds), keeping its navigation. With fragmentPath (a ' +
            '`$TMPDIR/how/<model sha>.<subject>.fragment.json` written by how:behaviour-builder), merge that ' +
            'built Behaviour or Seam view into the model, mark it built and re-verify Evidence; an invalid fragment ' +
            'marks the build failed and answers why.',
          inputSchema: {
            type: 'object',
            properties: {
              modelPath: MODEL_PATH_SCHEMA,
              fragmentPath: { type: 'string', description: 'Absolute path of the fragment to merge (optional).' },
            },
            required: ['modelPath'],
          },
          isDeferred: false,
        }),
      ])
    } catch (err) {
      // Refused registration (e.g. a sandbox that forbids the local port tools are served on): the panel still
      // draws, but mcp__how__open does not exist, so say why instead of failing silently.
      // A refusal may come prefixed "<plugin>: $.tool.register: "; the toast already names the plugin.
      const reason = errText(err).replace(/^[\w-]+: \$\.tool\.register: /, '')
      await logLine($, `how: could not register mcp__how__open and mcp__how__refresh: ${reason}`)
      try {
        $.ui.toast(`how: tools unavailable — ${reason}`)
      } catch {
        // no surface for toasts: the log line stands
      }
    }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__how__open' }, async ($, e) => {
    const { modelPath, cacheDir } = e as { modelPath?: unknown; cacheDir?: unknown }
    if (!isModelPath(modelPath)) return { deny: BAD_MODEL_PATH }
    if (cacheDir === undefined) return loadModel($, modelPath, false)
    if (!isCacheDir(cacheDir)) return { deny: BAD_CACHE_DIR }
    // The engine's $.fs is not bound by tool permissions: only a real git dir (one holding HEAD) takes the cache.
    const head = await $.fs.stat(`${gitDirOf(cacheDir)}/HEAD`).catch(() => undefined)
    if (head?.kind !== 'file') return { deny: BAD_CACHE_DIR }
    if (!isFullShaModelPath(modelPath)) return { deny: SHORT_SHA }
    return loadModel($, modelPath, false, cachePathFor(cacheDir, modelPath))
  }).catch(() => ({ deny: 'how: loading the Behaviour model failed' }))

  on('tool.call', { tool: 'mcp__how__refresh' }, async ($, e) => {
    const { modelPath, fragmentPath } = e as { modelPath?: unknown; fragmentPath?: unknown }
    if (!isModelPath(modelPath)) return { deny: BAD_MODEL_PATH }
    // Bound to the model the panel holds: another file of the same sha (the staging copy) would move the cache.
    const { path, source } = asStored(await readModel($))
    if (path === undefined || modelPath !== path) return { deny: NOT_HELD(path) }
    if (fragmentPath === undefined) return loadModel($, source ?? path, true, path)
    if (!isFragmentShapeFor(fragmentPath, path)) return { deny: BAD_FRAGMENT_PATH }
    const pending = Object.values(await read($, pendingState)).filter(p => p.modelPath === path)
    const subject = fragmentSubjectOf(fragmentPath, path, pending.map(p => p.subject))
    const build = subject && pending.find(p => subjectKey(p.subject) === subjectKey(subject))
    if (build === undefined) return { deny: NO_PENDING }
    return mergeBuild($, path, fragmentPath, build)
  }).catch(() => ({ deny: 'how: refreshing the Behaviour model failed' }))

  // A builder whose turn ends without its refresh has failed.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined && (await read($, pendingState))[e.agentId]) await failPending($, e.agentId)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    // `$` never leaves this file: the panel layer gets plain data and closures.
    let cwd: string | undefined
    try {
      cwd = await $.session.cwd()
    } catch {
      cwd = undefined // no editor link without an absolute path
    }
    const env = {
      ui: $.ui.resolve(e),
      state: await readModel($),
      nav: await read($, navState),
      updateNav: (fn: (n: Navigation) => Navigation) => update($, navState, fn),
      reload: () => requestReload($),
      snippets: await read($, snippetsState),
      cwd,
      openEvidence: (ownerId: string, index: number) => openEvidence($, ownerId, index),
      requestBuild: (subject: BuildSubject) => requestBuild($, subject),
    }
    return renderPane(env, e)
  })
}
