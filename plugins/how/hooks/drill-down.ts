// Model loading and lazy drill-down: the pure half. Validating paths, diffing against base, merging a builder's
// fragment, build statuses, the builder's prompt and the tool's reply. No `$` here: register.tsx does the I/O
// (the engine follows `$` only into functions of its own file).
import { markStepDiffs, pairSteps } from './model/behaviour-diff'
import { type BehaviourModel, type BuildStatus, parseBehaviourModel } from './model/behaviour-model'
import type { Dropped } from './model/evidence-check'
import { resolveEvidenceOwner } from './panel/evidence-owner'
import type { Navigation, ViewRef } from './panel/navigation'

export type BuildSubject = Extract<ViewRef, { kind: 'behaviour' | 'seam' }>
/** A spawned `how:behaviour-builder` waiting for its refresh, keyed by agentId in the `pending` atom. */
export type PendingBuild = { subject: BuildSubject; modelPath: string; fragmentName: string }
export type PendingBuilds = Record<string, PendingBuild>

export const BUILDER_AGENT = 'how:behaviour-builder'
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const MAX_DROPPED_LISTED = 10

/** A Behaviour model file: `<…>/how/<head sha>.json`, the cache in `.git` or the producer's `$TMPDIR` staging copy. */
const MODEL_PATH = /\/how\/[0-9a-fA-F]{7,64}\.json$/
export const isModelPath = (p: unknown): p is string => typeof p === 'string' && MODEL_PATH.test(p)

/** A model staged for the cache is named for the full head sha, which the skill's cache check looks up. */
const FULL_SHA_MODEL_PATH = /\/how\/(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})\.json$/
export const isFullShaModelPath = (p: unknown): p is string => typeof p === 'string' && FULL_SHA_MODEL_PATH.test(p)

const segments = (p: string) => p.split('/')
/** Absolute, and no segment is empty, `.` or `..`. */
const isCleanAbsolute = (p: string) => p.startsWith('/') && segments(p).slice(1).every(x => x !== '' && x !== '.' && x !== '..')
const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
/** The model's hex stem: `<sha>` of `<…>/how/<sha>.json`. */
const shaOf = (modelPath: string) => baseName(modelPath).slice(0, -'.json'.length)

/**
 * The cache folder `<git common dir>/how` by spelling: absolute, ends in `/how`, sits right under a folder named
 * `.git` or ending in `.git` (a bare repository), and has no empty, `.` or `..` segment. register.tsx also checks
 * that `<git dir>/HEAD` exists (gitDirOf).
 */
export function isCacheDir(p: unknown): p is string {
  if (typeof p !== 'string' || !p.endsWith('/how') || !isCleanAbsolute(p)) return false
  const parts = segments(p)
  return (parts[parts.length - 2] ?? '').endsWith('.git')
}

/** The git dir a cache folder sits in: `<git dir>/how` → `<git dir>`. */
export const gitDirOf = (cacheDir: string): string => cacheDir.slice(0, -'/how'.length)

/** Where the mod caches the model: `<cacheDir>/<sha>.json`, `<sha>` the hex stem of `modelPath`. */
export const cachePathFor = (cacheDir: string, modelPath: string): string => `${cacheDir}/${shaOf(modelPath)}.json`

/** One subject per key: a Seam view is keyed by its subject alone, as `seamViews` is. */
export const subjectKey = (s: BuildSubject): string =>
  s.kind === 'behaviour' ? `behaviour:${s.behaviourId}` : `seam:${s.subjectId}`

const safeKey = (s: BuildSubject) => subjectKey(s).replace(/[^A-Za-z0-9_-]/g, '_')

/** The fragment's file name: `<model sha>.<sanitized subject key>.fragment.json`. The builder picks the folder. */
export const fragmentNameFor = (modelPath: string, subject: BuildSubject): string =>
  `${shaOf(modelPath)}.${safeKey(subject)}.fragment.json`

/**
 * True when `fragmentPath` is shaped as a fragment of `modelPath`: absolute, no `..` segment, in a folder named
 * `how`, named `<model sha>.<key>.fragment.json`. The folder is the builder's own (its `$TMPDIR/how`).
 */
export function isFragmentShapeFor(fragmentPath: unknown, modelPath: string): fragmentPath is string {
  if (typeof fragmentPath !== 'string' || !fragmentPath.startsWith('/')) return false
  const parts = segments(fragmentPath)
  if (parts.includes('..') || parts[parts.length - 2] !== 'how') return false
  const name = parts[parts.length - 1]!
  const prefix = `${shaOf(modelPath)}.`
  return name.startsWith(prefix) && /^[A-Za-z0-9_-]+\.fragment\.json$/.test(name.slice(prefix.length))
}

/** The pending subject a well-shaped `fragmentPath` is named for, if any: `<key>` is its sanitized subject key. */
export function fragmentSubjectOf(
  fragmentPath: unknown,
  modelPath: string,
  pending: readonly BuildSubject[],
): BuildSubject | undefined {
  if (!isFragmentShapeFor(fragmentPath, modelPath)) return undefined
  const name = baseName(fragmentPath)
  return pending.find(s => fragmentNameFor(modelPath, s) === name)
}

/** isFragmentShapeFor, and `<key>` is the sanitized key of a pending subject. */
export function isFragmentPathFor(fragmentPath: unknown, modelPath: string, pending: readonly BuildSubject[]): fragmentPath is string {
  return fragmentSubjectOf(fragmentPath, modelPath, pending) !== undefined
}

export function subjectName(model: BehaviourModel | undefined, s: BuildSubject): string {
  if (s.kind === 'behaviour') return model?.behaviours.find(b => b.id === s.behaviourId)?.name ?? s.behaviourId
  return model?.seams[s.subjectId]?.name ?? model?.elements[s.subjectId]?.name ?? s.subjectId
}

/** The model with the subject's build status set; a Seam view not yet in `seamViews` is added empty. */
export function withBuildStatus(model: BehaviourModel, s: BuildSubject, status: BuildStatus): BehaviourModel {
  if (s.kind === 'behaviour') {
    return { ...model, behaviours: model.behaviours.map(b => (b.id === s.behaviourId ? { ...b, status } : b)) }
  }
  const view = model.seamViews[s.subjectId] ?? { subjectId: s.subjectId, status, nodes: [], edges: [] }
  return { ...model, seamViews: { ...model.seamViews, [s.subjectId]: { ...view, status } } }
}

export function buildStatusOf(model: BehaviourModel, s: BuildSubject): BuildStatus | undefined {
  return s.kind === 'behaviour'
    ? model.behaviours.find(b => b.id === s.behaviourId)?.status
    : model.seamViews[s.subjectId]?.status
}

/**
 * Subjects left `building` by a builder that is no longer pending (a past session, a lost reload) become `failed`,
 * so they can be retried instead of showing Building… for ever. `pendingKeys` are the subjectKeys still pending.
 */
export function settleOrphanBuilds(model: BehaviourModel, pendingKeys: ReadonlySet<string>): BehaviourModel {
  let out = model
  for (const b of model.behaviours) {
    const s: BuildSubject = { kind: 'behaviour', behaviourId: b.id }
    if (b.status === 'building' && !pendingKeys.has(subjectKey(s))) out = withBuildStatus(out, s, 'failed')
  }
  for (const v of Object.values(model.seamViews)) {
    const s: BuildSubject = { kind: 'seam', subjectId: v.subjectId, behaviourId: '' }
    if (v.status === 'building' && !pendingKeys.has(subjectKey(s))) out = withBuildStatus(out, s, 'failed')
  }
  return out
}

/**
 * PR mode: each built head Behaviour diffed Step by Step against the base Behaviour whose Entry point Element has
 * the same name. Steps and error flows a previous diff added as removed (`base:` ids) are dropped first, so loading
 * a model this wrote is a no-op. Without `baseBehaviours` the producer's diffs stand.
 */
const isOld = (x: { id: string; diff: string }) => x.diff === 'removed' && x.id.startsWith('base:')
/** The base Behaviour paired with `h`: the one whose Entry point Element has the same name. */
const baseOf = (model: BehaviourModel, h: { entryPointId: string }) => {
  const name = model.elements[h.entryPointId]?.name
  return name === undefined ? undefined : model.baseBehaviours?.find(b => model.elements[b.entryPointId]?.name === name)
}

/**
 * After the Evidence check: every head Step the check dropped for its own Evidence (its Elements survived) takes
 * its paired base Step, and that Step's base error flows, out of `baseBehaviours`, so it does not reappear as
 * removed. Pairs on `before`, the model the check was given.
 */
export function dropTwinsOfUnverified(before: BehaviourModel, after: BehaviourModel): BehaviourModel {
  if (!after.baseBehaviours) return after
  const drop = new Map<string, Set<string>>() // base Behaviour id -> base Step ids to remove
  for (const h of before.behaviours) {
    if (h.status !== 'built') continue
    const base = baseOf(before, h)
    const kept = after.behaviours.find(b => b.id === h.id)
    if (!base || !kept) continue
    const head = { ...h, steps: h.steps.filter(s => !isOld(s)) }
    const { matchOf } = pairSteps(base, head, before.elements)
    const keptIds = new Set(kept.steps.map(s => s.id))
    for (const s of head.steps) {
      const twin = matchOf.get(s.id)
      const ownEvidence = s.from in after.elements && s.to in after.elements
      if (twin !== undefined && !keptIds.has(s.id) && ownEvidence) {
        drop.set(base.id, (drop.get(base.id) ?? new Set()).add(twin))
      }
    }
  }
  if (drop.size === 0) return after
  const baseBehaviours = after.baseBehaviours.map(b => {
    const gone = drop.get(b.id)
    if (!gone) return b
    return { ...b, steps: b.steps.filter(s => !gone.has(s.id)), errorFlows: b.errorFlows.filter(f => !gone.has(f.originStepId)) }
  })
  return { ...after, baseBehaviours }
}

export function applyStepDiffs(model: BehaviourModel): BehaviourModel {
  const bases = model.baseBehaviours
  if (!bases) return model
  const nameOf = (id: string) => model.elements[id]?.name
  const behaviours = model.behaviours.map(h => {
    if (h.status !== 'built') return h
    const head = { ...h, steps: h.steps.filter(s => !isOld(s)), errorFlows: h.errorFlows.filter(f => !isOld(f)) }
    const name = nameOf(h.entryPointId)
    const base = name === undefined ? undefined : bases.find(b => nameOf(b.entryPointId) === name)
    return markStepDiffs(base, head, model.elements)
  })
  return { ...model, behaviours }
}

export type Fragment = { behaviour?: unknown; seamView?: unknown; elements?: unknown; seams?: unknown }
export type MergeResult = { model: BehaviourModel; subject: BuildSubject } | { error: string; subject?: BuildSubject }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * Merges a builder's fragment `{ behaviour?, seamView?, elements?, seams? }` into the model: the Behaviour replaces
 * the one of its id and the Seam view is set under its subject, each with status `built`; new Elements and Seams are
 * added and existing ids are never overwritten. The result is validated as a whole Behaviour model.
 */
export function mergeFragment(model: BehaviourModel, fragmentJson: string): MergeResult {
  let raw: unknown
  try {
    raw = JSON.parse(fragmentJson)
  } catch (e) {
    return { error: `fragment is not valid JSON: ${e instanceof Error ? e.message : String(e)}` }
  }
  if (!isObj(raw)) return { error: 'fragment must be a JSON object' }
  const f = raw as Fragment
  let subject: BuildSubject | undefined
  let next: BehaviourModel = { ...model }

  if (f.behaviour !== undefined) {
    if (!isObj(f.behaviour) || typeof f.behaviour.id !== 'string') return { error: 'fragment "behaviour" needs a string "id"' }
    const id = f.behaviour.id
    subject = { kind: 'behaviour', behaviourId: id }
    if (!model.behaviours.some(b => b.id === id)) return { error: `fragment Behaviour "${id}" names no Behaviour in the model`, subject }
    const built = { ...f.behaviour, status: 'built' } as unknown as BehaviourModel['behaviours'][number]
    next.behaviours = model.behaviours.map(b => (b.id === id ? built : b))
  }
  if (f.seamView !== undefined) {
    if (!isObj(f.seamView) || typeof f.seamView.subjectId !== 'string') {
      return { error: 'fragment "seamView" needs a string "subjectId"', subject }
    }
    const subjectId = f.seamView.subjectId
    subject ??= { kind: 'seam', subjectId, behaviourId: '' }
    const built = { ...f.seamView, status: 'built' } as unknown as BehaviourModel['seamViews'][string]
    next.seamViews = { ...model.seamViews, [subjectId]: built }
  }
  if (subject === undefined) return { error: 'fragment holds neither "behaviour" nor "seamView"' }
  for (const key of ['elements', 'seams'] as const) {
    const add = f[key]
    if (add === undefined) continue
    if (!isObj(add)) return { error: `fragment "${key}" must be an object`, subject }
    const merged: Record<string, unknown> = { ...add, ...model[key] } // existing ids win
    next = { ...next, [key]: merged }
  }

  const checked = parseBehaviourModel(JSON.stringify(next))
  return 'error' in checked ? { error: `merged Behaviour model is invalid: ${checked.error}`, subject } : { model: checked.model, subject }
}

/** The tool's reply: `<n> Behaviours, <d> elements dropped: <id: reason; …>`, listing at most 10. */
export function formatLoadResult(model: BehaviourModel, dropped: Dropped[]): string {
  const head = `${model.behaviours.length} Behaviours, ${dropped.length} elements dropped`
  if (dropped.length === 0) return head
  const listed = dropped.slice(0, MAX_DROPPED_LISTED).map(d => `${d.id}: ${d.reason}`)
  return `${head}: ${listed.join('; ')}${dropped.length > MAX_DROPPED_LISTED ? '; …' : ''}`
}

/** The navigation stack cut at the first view that no longer resolves in `model` (the map always does). */
export function resolvableStack(nav: Navigation, model: BehaviourModel): Navigation {
  const resolves = (ref: ViewRef): boolean => {
    switch (ref.kind) {
      case 'map':
        return true
      case 'behaviour':
        return model.behaviours.some(b => b.id === ref.behaviourId)
      case 'seam':
        return ref.subjectId in model.seams || ref.subjectId in model.elements
      case 'evidence':
        return resolveEvidenceOwner(model, ref.ownerId)?.evidence[ref.index] !== undefined
    }
  }
  const cut = nav.stack.findIndex(r => !resolves(r))
  if (cut < 0) return nav
  return { ...nav, stack: cut === 0 ? [{ kind: 'map' }] : nav.stack.slice(0, cut) }
}

export type BuilderPromptInput = {
  modelPath: string
  subject: BuildSubject
  name: string
  /** The fragment's file name (fragmentNameFor); the builder writes it under its own `$TMPDIR/how`. */
  fragmentName: string
  /** The reference doc's absolute path; left out when the plugin root is unknown. */
  referencePath?: string
}

const MAX_DESCRIPTION = 80

/** The spawn's `description`: `how: build <name>`, control characters removed, at most 80 characters. */
export function spawnDescription(name: string): string {
  const text = `how: build ${name.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim()}`
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 1)}…`
}

/** The `how:behaviour-builder` task: build one subject, write only the fragment, then call `mcp__how__refresh`. */
export function builderPrompt(p: BuilderPromptInput): string {
  const { subject: s } = p
  const what =
    s.kind === 'behaviour'
      ? `the Behaviour ${JSON.stringify(p.name)} (id ${JSON.stringify(s.behaviourId)})`
      : `the Seam view of ${JSON.stringify(p.name)} (subjectId ${JSON.stringify(s.subjectId)}, reached from Behaviour ${JSON.stringify(s.behaviourId)})`
  const shape =
    s.kind === 'behaviour'
      ? `"behaviour": the complete Behaviour with id ${JSON.stringify(s.behaviourId)} (keep its id, name, entryPointId and rank) with its steps, errorFlows, elementIds and seamIds filled in`
      : `"seamView": the SeamView with subjectId ${JSON.stringify(s.subjectId)}, its nodes and edges filled in`
  const fragment = `$TMPDIR/how/${p.fragmentName}`
  const refresh = JSON.stringify({ modelPath: p.modelPath, fragmentPath: `<TMPDIR>/how/${p.fragmentName}` })
  return [
    `Build ${what} for the Behaviour model at ${p.modelPath}.`,
    '',
    `Subject: ${JSON.stringify(s)}`,
    ...(p.referencePath === undefined ? [] : [`Behaviour model format (read it first and follow it exactly): ${p.referencePath}`]),
    `Read the Behaviour model for context (its scope, Elements, Seams and the subject's current entry); never edit it.`,
    '',
    `Write ONLY this fragment file, and no other file: ${fragment}`,
    '`$TMPDIR` is your own temp folder, never inside .git: run `printenv TMPDIR` for its absolute path <TMPDIR>, any trailing / removed (use /tmp when it prints nothing) and write <TMPDIR>/how/' +
      `${p.fragmentName} (Write creates the how folder).`,
    'It is one JSON object { "behaviour"?, "seamView"?, "elements"?, "seams"? } holding:',
    `- ${shape};`,
    '- "elements" and "seams": only the NEW Elements and Seams it references (ids already in the model are kept as they are).',
    '',
    `Then call mcp__how__refresh with ${refresh}, <TMPDIR> replaced by that absolute path. If it returns an error, fix the fragment and call it again,`,
    'except when it answers that no build is pending for this subject: then stop, and do not retry.',
  ].join('\n')
}
