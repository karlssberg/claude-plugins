// Deterministic Evidence check: re-verifies every file:line citation in a Behaviour model.
// Pure apart from the injected readFile. Never mutates its input, never throws on bad citations.

import type { Behaviour, BehaviourModel, Evidence, Step } from './behaviour-model'

export type ReadFile = (path: string) => Promise<string | undefined>
export type Dropped = { id: string; reason: string }
export type EvidenceCheckResult = { model: BehaviourModel; dropped: Dropped[] }

const TOLERANCE = 3

type Checked = { evidence?: Evidence; reason?: string }

const isRemoved = (x: { diff: string }) => x.diff === 'removed'

/**
 * Elements only base code uses: referenced by `baseBehaviours` or by removed Steps and error flows, and by nothing
 * live at head (an Entry point, a Step or error-flow handler that is not removed, a Seam view). Their Evidence cites
 * base code, so it is never checked against head files.
 */
export function baseOnlyElementIds(model: BehaviourModel): Set<string> {
  const live = new Set<string>(Object.keys(model.seamViews))
  const base = new Set<string>()
  for (const v of Object.values(model.seamViews)) live.add(v.subjectId)
  const refs = (b: Behaviour, into: (removed: boolean) => Set<string>, entryInto: Set<string>) => {
    entryInto.add(b.entryPointId)
    for (const s of b.steps) [s.from, s.to].forEach(id => into(isRemoved(s)).add(id))
    for (const f of b.errorFlows) if (f.handler) into(isRemoved(f)).add(f.handler.elementId)
  }
  for (const b of model.behaviours) refs(b, removed => (removed ? base : live), live)
  for (const b of model.baseBehaviours ?? []) {
    refs(b, () => base, base)
    b.elementIds.forEach(id => base.add(id))
  }
  return new Set([...base].filter(id => !live.has(id) && id in model.elements))
}

/**
 * Seams only base code uses: named by `baseBehaviours` or by removed Steps and error flows, and by nothing live at
 * head (a head Behaviour's seamIds, a Step or error flow that is not removed, a Seam view). Their Contract cites base
 * code, so it is never checked against head files.
 */
export function baseOnlySeamIds(model: BehaviourModel): Set<string> {
  const live = new Set<string>(Object.keys(model.seamViews))
  const base = new Set<string>()
  for (const v of Object.values(model.seamViews)) live.add(v.subjectId)
  const refs = (b: Behaviour, into: (removed: boolean) => Set<string>) => {
    for (const s of b.steps) if (s.seamId !== undefined) into(isRemoved(s)).add(s.seamId)
    for (const f of b.errorFlows) for (const t of f.transforms) into(isRemoved(f)).add(t.seamId)
  }
  for (const b of model.behaviours) {
    b.seamIds.forEach(id => live.add(id))
    refs(b, removed => (removed ? base : live))
  }
  for (const b of model.baseBehaviours ?? []) {
    b.seamIds.forEach(id => base.add(id))
    refs(b, () => base)
  }
  return new Set([...base].filter(id => !live.has(id) && id in model.seams))
}

/**
 * Verifies head content only: `baseBehaviours`, removed Steps and error flows, and base-only Elements keep the
 * Evidence status their producer set and are never dropped for it (their code may be gone at head). They still lose
 * Steps that touch a head Element the check dropped, so the model stays valid.
 */
export async function verifyEvidence(model: BehaviourModel, readFile: ReadFile): Promise<EvidenceCheckResult> {
  const baseOnly = baseOnlyElementIds(model)
  const baseOnlySeams = baseOnlySeamIds(model)
  const cache = new Map<string, Promise<string[] | undefined>>()
  const lines = (path: string): Promise<string[] | undefined> => {
    let p = cache.get(path)
    if (!p) {
      p = readFile(path)
        .then(text => (text === undefined ? undefined : splitLines(text)))
        .catch(() => undefined)
      cache.set(path, p)
    }
    return p
  }

  const dropped: Dropped[] = []
  const report = (id: string, reason: string) => {
    const existing = dropped.find(d => d.id === id)
    if (!existing) dropped.push({ id, reason })
    else if (!existing.reason.split('; ').includes(reason)) existing.reason += `; ${reason}`
  }

  const check = async (e: Evidence): Promise<Checked> => {
    const all = await lines(e.file)
    if (all === undefined) return { reason: `file missing: ${e.file}` }
    const { startLine: s, endLine: t, symbol } = e
    if (!Number.isInteger(s) || !Number.isInteger(t) || s < 1 || t < s) {
      return { reason: `invalid line range ${s}-${t} in ${e.file}` }
    }
    if (t > all.length) return { reason: `line range ${s}-${t} past end of ${e.file} (${all.length} lines)` }
    const from = Math.max(1, s - TOLERANCE)
    const to = Math.min(all.length, t + TOLERANCE)
    if (contains(all.slice(from - 1, to).join('\n'), symbol)) return { evidence: { ...e, status: 'verified' } }
    if (contains(all.join('\n'), symbol)) return { evidence: { ...e, status: 'inferred' } }
    return { reason: `symbol "${symbol}" not found in ${e.file}` }
  }

  // Checks a list; reports invalid items against ownerId and returns survivors plus the reasons.
  const checkList = async (list: Evidence[], ownerId: string, reportInvalid: boolean) => {
    const kept: Evidence[] = []
    const reasons: string[] = []
    for (const e of list) {
      const r = await check(e)
      if (r.evidence) kept.push(r.evidence)
      else {
        reasons.push(r.reason as string)
        if (reportInvalid) report(ownerId, r.reason as string)
      }
    }
    return { kept, reasons }
  }
  const noEvidence = (reasons: string[]) => (reasons.length ? reasons.join('; ') : 'no evidence cited')

  // Elements
  const elements: BehaviourModel['elements'] = {}
  const droppedElements = new Set<string>()
  for (const [id, el] of Object.entries(model.elements)) {
    if (baseOnly.has(id)) {
      elements[id] = el
      continue
    }
    const { kept, reasons } = await checkList(el.evidence, id, false)
    if (kept.length === 0) {
      droppedElements.add(id)
      report(id, noEvidence(reasons))
    } else elements[id] = { ...el, evidence: kept }
  }
  for (const el of Object.values(elements)) {
    if (el.parentId !== undefined && droppedElements.has(el.parentId)) elements[el.id] = { ...el, parentId: undefined }
  }

  // Seams: one left with no valid Contract Evidence is dropped, and every reference to it with it.
  const seams: BehaviourModel['seams'] = {}
  const droppedSeams = new Set<string>()
  for (const [id, seam] of Object.entries(model.seams)) {
    if (baseOnlySeams.has(id)) {
      seams[id] = seam
      continue
    }
    const contract = await checkList(seam.contract.evidence, id, false)
    if (contract.kept.length === 0) {
      droppedSeams.add(id)
      report(id, noEvidence(contract.reasons))
      continue
    }
    contract.reasons.forEach(r => report(id, r))
    let enablingPoint: Evidence | undefined
    if (seam.enablingPoint) {
      const r = await check(seam.enablingPoint)
      if (r.evidence) enablingPoint = r.evidence
      else report(id, r.reason as string)
    }
    const next = { ...seam, contract: { ...seam.contract, evidence: contract.kept }, enablingPoint }
    if (enablingPoint === undefined) delete (next as { enablingPoint?: Evidence }).enablingPoint
    seams[id] = next
  }

  // Seam views
  const seamViews: BehaviourModel['seamViews'] = {}
  for (const [key, view] of Object.entries(model.seamViews)) {
    const gone = [key, view.subjectId].find(id => droppedElements.has(id) || droppedSeams.has(id))
    if (gone !== undefined) {
      report(key, `names dropped ${droppedSeams.has(gone) ? 'Seam' : 'element'} "${gone}"`)
      continue
    }
    // A flow node left with no valid Evidence is dropped, with every edge that touches it.
    const nodes = []
    for (const n of view.nodes) {
      const { kept, reasons } = await checkList(n.evidence, n.id, false)
      if (kept.length === 0) report(n.id, noEvidence(reasons))
      else {
        reasons.forEach(r => report(n.id, r))
        nodes.push({ ...n, evidence: kept })
      }
    }
    const nodeIds = new Set(nodes.map(n => n.id))
    const edges = view.edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))
    seamViews[key] = { ...view, nodes, edges }
  }

  // Intent mismatches
  const intentMismatches = []
  for (const [i, m] of model.intentMismatches.entries()) {
    intentMismatches.push({ ...m, evidence: (await checkList(m.evidence, `intentMismatch-${i}`, true)).kept })
  }

  // Behaviours (head and base)
  const withoutDroppedSeam = (s: Step): Step => {
    if (s.seamId === undefined || !droppedSeams.has(s.seamId)) return s
    const { seamId: _gone, ...rest } = s
    return rest
  }
  const checkBehaviour = async (b: Behaviour, isBase: boolean): Promise<Behaviour | undefined> => {
    if (droppedElements.has(b.entryPointId)) {
      report(b.id, `entry point "${b.entryPointId}" was dropped`)
      return undefined
    }
    const steps: Step[] = []
    const droppedSteps = new Set<string>()
    for (const s of b.steps) {
      if (droppedElements.has(s.from) || droppedElements.has(s.to)) {
        const gone = droppedElements.has(s.from) ? s.from : s.to
        droppedSteps.add(s.id)
        report(s.id, `touches dropped element "${gone}"`)
        continue
      }
      const step = withoutDroppedSeam(s)
      if (isBase || isRemoved(s)) {
        steps.push(step)
        continue
      }
      const { kept, reasons } = await checkList(s.evidence, s.id, false)
      if (kept.length === 0) {
        droppedSteps.add(s.id)
        report(s.id, noEvidence(reasons))
      } else steps.push({ ...step, evidence: kept })
    }
    const errorFlows = []
    for (const f of b.errorFlows) {
      if (droppedSteps.has(f.originStepId)) {
        report(f.id, `origin step "${f.originStepId}" was dropped`)
        continue
      }
      // A transform across a dropped Seam goes, in head and base alike, or the model would not re-parse.
      const across = f.transforms.filter(t => {
        if (!droppedSeams.has(t.seamId)) return true
        report(f.id, `transform into "${t.into}" crosses dropped Seam "${t.seamId}"`)
        return false
      })
      if (isBase || isRemoved(f)) {
        const gone = f.handler !== undefined && droppedElements.has(f.handler.elementId)
        if (gone) report(f.id, `handler element "${f.handler!.elementId}" was dropped`)
        const kept = { ...f, transforms: across }
        if (gone) delete (kept as { handler?: unknown }).handler
        errorFlows.push(kept)
        continue
      }
      // A transform or handler left with no valid Evidence is dropped: an unevidenced owner is never drawn.
      const transforms = []
      for (const t of across) {
        const { kept, reasons } = await checkList(t.evidence, f.id, false)
        if (kept.length === 0) report(f.id, `transform into "${t.into}": ${noEvidence(reasons)}`)
        else {
          reasons.forEach(r => report(f.id, r))
          transforms.push({ ...t, evidence: kept })
        }
      }
      let handler = f.handler
      if (handler) {
        if (droppedElements.has(handler.elementId)) {
          report(f.id, `handler element "${handler.elementId}" was dropped`)
          handler = undefined
        } else {
          const { kept, reasons } = await checkList(handler.evidence, f.id, false)
          if (kept.length === 0) {
            report(f.id, `handler "${handler.elementId}": ${noEvidence(reasons)}`)
            handler = undefined
          } else {
            reasons.forEach(r => report(f.id, r))
            handler = { ...handler, evidence: kept }
          }
        }
      }
      const next = { ...f, transforms, handler }
      if (handler === undefined) delete (next as { handler?: unknown }).handler
      errorFlows.push(next)
    }
    return {
      ...b,
      elementIds: b.elementIds.filter(id => !droppedElements.has(id)),
      seamIds: b.seamIds.filter(id => !droppedSeams.has(id)),
      steps,
      errorFlows,
    }
  }
  const behaviours = []
  for (const b of model.behaviours) {
    const c = await checkBehaviour(b, false)
    if (c) behaviours.push(c)
  }
  let baseBehaviours: Behaviour[] | undefined
  if (model.baseBehaviours) {
    baseBehaviours = []
    for (const b of model.baseBehaviours) {
      const c = await checkBehaviour(b, true)
      if (c) baseBehaviours.push(c)
    }
  }

  const out: BehaviourModel = { ...model, elements, seams, seamViews, intentMismatches, behaviours }
  if (baseBehaviours) out.baseBehaviours = baseBehaviours
  return { model: out, dropped }
}

function splitLines(text: string): string[] {
  const l = text.split(/\r?\n/)
  if (l.length > 0 && l[l.length - 1] === '') l.pop()
  return l
}

// A dotted/qualified symbol such as "OrderService.cancel" also matches by its last segment.
function contains(text: string, symbol: string): boolean {
  if (symbol === '') return false
  if (text.includes(symbol)) return true
  const last = symbol.split(/[.:#/]+/).filter(Boolean).pop()
  return last !== undefined && last !== symbol && text.includes(last)
}
