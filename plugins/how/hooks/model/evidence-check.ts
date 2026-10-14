// Deterministic Evidence check: re-verifies every file:line citation in a Behaviour model.
// Pure apart from the injected readFile. Never mutates its input, never throws on bad citations.

import type { Behaviour, BehaviourModel, Evidence, Step } from './behaviour-model'

export type ReadFile = (path: string) => Promise<string | undefined>
export type Dropped = { id: string; reason: string }
export type EvidenceCheckResult = { model: BehaviourModel; dropped: Dropped[] }

const TOLERANCE = 3

type Checked = { evidence?: Evidence; reason?: string }

export async function verifyEvidence(model: BehaviourModel, readFile: ReadFile): Promise<EvidenceCheckResult> {
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
    const { kept, reasons } = await checkList(el.evidence, id, false)
    if (kept.length === 0) {
      droppedElements.add(id)
      report(id, noEvidence(reasons))
    } else elements[id] = { ...el, evidence: kept }
  }
  for (const el of Object.values(elements)) {
    if (el.parentId !== undefined && droppedElements.has(el.parentId)) elements[el.id] = { ...el, parentId: undefined }
  }

  // Seams
  const seams: BehaviourModel['seams'] = {}
  for (const [id, seam] of Object.entries(model.seams)) {
    const contract = await checkList(seam.contract.evidence, id, true)
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
    const nodes = []
    for (const n of view.nodes) nodes.push({ ...n, evidence: (await checkList(n.evidence, n.id, true)).kept })
    seamViews[key] = { ...view, nodes }
  }

  // Intent mismatches
  const intentMismatches = []
  for (const [i, m] of model.intentMismatches.entries()) {
    intentMismatches.push({ ...m, evidence: (await checkList(m.evidence, `intentMismatch-${i}`, true)).kept })
  }

  // Behaviours (head and base)
  const checkBehaviour = async (b: Behaviour): Promise<Behaviour> => {
    const steps: Step[] = []
    const droppedSteps = new Set<string>()
    for (const s of b.steps) {
      if (droppedElements.has(s.from) || droppedElements.has(s.to)) {
        const gone = droppedElements.has(s.from) ? s.from : s.to
        droppedSteps.add(s.id)
        report(s.id, `touches dropped element "${gone}"`)
        continue
      }
      const { kept, reasons } = await checkList(s.evidence, s.id, false)
      if (kept.length === 0) {
        droppedSteps.add(s.id)
        report(s.id, noEvidence(reasons))
      } else steps.push({ ...s, evidence: kept })
    }
    const errorFlows = []
    for (const f of b.errorFlows) {
      if (droppedSteps.has(f.originStepId)) {
        report(f.id, `origin step "${f.originStepId}" was dropped`)
        continue
      }
      const transforms = []
      for (const t of f.transforms) {
        transforms.push({ ...t, evidence: (await checkList(t.evidence, f.id, true)).kept })
      }
      let handler = f.handler
      if (handler) {
        if (droppedElements.has(handler.elementId)) {
          report(f.id, `handler element "${handler.elementId}" was dropped`)
          handler = undefined
        } else handler = { ...handler, evidence: (await checkList(handler.evidence, f.id, true)).kept }
      }
      const next = { ...f, transforms, handler }
      if (handler === undefined) delete (next as { handler?: unknown }).handler
      errorFlows.push(next)
    }
    return { ...b, elementIds: b.elementIds.filter(id => !droppedElements.has(id)), steps, errorFlows }
  }
  const behaviours = []
  for (const b of model.behaviours) behaviours.push(await checkBehaviour(b))
  let baseBehaviours: Behaviour[] | undefined
  if (model.baseBehaviours) {
    baseBehaviours = []
    for (const b of model.baseBehaviours) baseBehaviours.push(await checkBehaviour(b))
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
