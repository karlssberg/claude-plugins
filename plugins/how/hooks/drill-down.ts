// Model loading and lazy drill-down: the pure half. Validating paths, diffing against base, merging a builder's
// fragment, build statuses, the builder's prompt and the tool's reply. No `$` here: register.tsx does the I/O
// (the engine follows `$` only into functions of its own file).
import { markStepDiffs } from './model/behaviour-diff'
import { type BehaviourModel, type BuildStatus, parseBehaviourModel } from './model/behaviour-model'
import type { Dropped } from './model/evidence-check'
import { resolveEvidenceOwner } from './panel/evidence-owner'
import type { Navigation, ViewRef } from './panel/navigation'

export type BuildSubject = Extract<ViewRef, { kind: 'behaviour' | 'seam' }>
/** A spawned `how:behaviour-builder` waiting for its refresh, keyed by agentId in the `pending` atom. */
export type PendingBuild = { subject: BuildSubject; modelPath: string; fragmentPath: string }
export type PendingBuilds = Record<string, PendingBuild>

export const BUILDER_AGENT = 'how:behaviour-builder'
export const BUILD_TIMEOUT_MS = 10 * 60 * 1000
const MAX_DROPPED_LISTED = 10

/** The Behaviour model cache file: `<…>/how/<head sha>.json`. */
const MODEL_PATH = /\/how\/[0-9a-fA-F]{7,64}\.json$/
export const isModelPath = (p: unknown): p is string => typeof p === 'string' && MODEL_PATH.test(p)

const stemOf = (modelPath: string) => modelPath.slice(0, -'.json'.length)

/** One subject per key: a Seam view is keyed by its subject alone, as `seamViews` is. */
export const subjectKey = (s: BuildSubject): string =>
  s.kind === 'behaviour' ? `behaviour:${s.behaviourId}` : `seam:${s.subjectId}`

/** Where the builder writes: beside the model, its stem, then the subject. */
export function fragmentPathFor(modelPath: string, subject: BuildSubject): string {
  const safe = subjectKey(subject).replace(/[^A-Za-z0-9_-]/g, '_')
  return `${stemOf(modelPath)}.${safe}.fragment.json`
}

/** True when `fragmentPath` sits beside `modelPath`, shares its stem and ends in `.fragment.json`. */
export function isFragmentPathFor(fragmentPath: unknown, modelPath: string): fragmentPath is string {
  if (typeof fragmentPath !== 'string' || !fragmentPath.endsWith('.fragment.json')) return false
  const stem = stemOf(modelPath)
  if (!fragmentPath.startsWith(`${stem}.`)) return false
  const rest = fragmentPath.slice(stem.length + 1)
  return rest.length > '.fragment.json'.length && !rest.includes('/') && !rest.includes('\\')
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
export function applyStepDiffs(model: BehaviourModel): BehaviourModel {
  const bases = model.baseBehaviours
  if (!bases) return model
  const nameOf = (id: string) => model.elements[id]?.name
  const isOld = (x: { id: string; diff: string }) => x.diff === 'removed' && x.id.startsWith('base:')
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
  fragmentPath: string
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
  const refresh = JSON.stringify({ modelPath: p.modelPath, fragmentPath: p.fragmentPath })
  return [
    `Build ${what} for the Behaviour model at ${p.modelPath}.`,
    '',
    `Subject: ${JSON.stringify(s)}`,
    ...(p.referencePath === undefined ? [] : [`Behaviour model format (read it first and follow it exactly): ${p.referencePath}`]),
    `Read the Behaviour model for context (its scope, Elements, Seams and the subject's current entry); never edit it.`,
    '',
    `Write ONLY this fragment file, and no other file: ${p.fragmentPath}`,
    'It is one JSON object { "behaviour"?, "seamView"?, "elements"?, "seams"? } holding:',
    `- ${shape};`,
    '- "elements" and "seams": only the NEW Elements and Seams it references (ids already in the model are kept as they are).',
    '',
    `Then call mcp__how__refresh with ${refresh}. If it returns an error, fix the fragment and call it again.`,
  ].join('\n')
}
