#!/usr/bin/env node
// Scores a Behaviour model against a fixture's expected.json.
// Usage: node evals/score.mjs <model.json> <expected.json>   (prints JSON, exits 1 when pass is false)
// Matching is case-insensitive substring on names: the model's name must contain the expected one.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const THRESHOLDS = {
  behaviourRecall: 0.8,
  evidenceVerifiedRate: 0.9,
  seamRecall: 0.7,
  incidentalAccuracy: 0.8,
  maxNodesPerView: 20,
}

const has = (name, wanted) => typeof name === 'string' && name.toLowerCase().includes(String(wanted).toLowerCase())
const fraction = (hits, total) => (total === 0 ? 1 : hits / total)
const recall = (wanted, found) => fraction(wanted.filter(found).length, wanted.length)

/** Head content only: never baseBehaviours, never removed Steps or error flows. */
function headEvidence(model) {
  const elements = model.elements ?? {}
  const items = []
  const touched = new Set()
  const live = (x) => x.diff !== 'removed'
  for (const b of model.behaviours ?? []) {
    touched.add(b.entryPointId)
    for (const s of b.steps ?? []) {
      if (!live(s)) continue
      touched.add(s.from)
      touched.add(s.to)
      items.push(...(s.evidence ?? []))
    }
    for (const f of b.errorFlows ?? []) {
      if (!live(f)) continue
      for (const t of f.transforms ?? []) items.push(...(t.evidence ?? []))
      if (f.handler) {
        touched.add(f.handler.elementId)
        items.push(...(f.handler.evidence ?? []))
      }
    }
  }
  for (const id of touched) items.push(...(elements[id]?.evidence ?? []))
  for (const seam of Object.values(model.seams ?? {})) {
    items.push(...(seam.contract?.evidence ?? []))
    if (seam.enablingPoint) items.push(seam.enablingPoint)
  }
  for (const view of Object.values(model.seamViews ?? {})) {
    for (const n of view.nodes ?? []) items.push(...(n.evidence ?? []))
  }
  for (const m of model.intentMismatches ?? []) items.push(...(m.evidence ?? []))
  return items
}

/** Names that can identify a swallowed error flow: its handler, its origin Step, and their Evidence symbols. */
function swallowedNames(model) {
  const elements = model.elements ?? {}
  const names = []
  for (const b of model.behaviours ?? []) {
    for (const f of b.errorFlows ?? []) {
      if (!f.isSwallowed) continue
      const origin = (b.steps ?? []).find((s) => s.id === f.originStepId)
      if (origin) {
        names.push(origin.label, elements[origin.from]?.name, elements[origin.to]?.name)
        names.push(...(origin.evidence ?? []).map((e) => e.symbol))
      }
      if (f.handler) {
        names.push(elements[f.handler.elementId]?.name)
        names.push(...(f.handler.evidence ?? []).map((e) => e.symbol))
      }
    }
  }
  return names.filter((n) => typeof n === 'string')
}

export function score(model, expected) {
  const elements = model.elements ?? {}
  const behaviours = model.behaviours ?? []
  const seams = Object.values(model.seams ?? {})
  const entryNames = behaviours.map((b) => elements[b.entryPointId]?.name)

  const behaviourRecall = recall(expected.behaviours ?? [], (e) => entryNames.some((n) => has(n, e.entryPoint)))
  const seamRecall = recall(expected.seams ?? [], (e) =>
    seams.some((s) => has(s.name, e.name) && String(s.kind).toLowerCase() === String(e.kind).toLowerCase()),
  )
  const files = (model.incidentalChanges ?? []).map((c) => c.file)
  const incidentalAccuracy = recall(expected.incidental ?? [], (f) => files.some((n) => has(n, f)))

  const evidence = headEvidence(model)
  const evidenceVerifiedRate =
    evidence.length === 0 ? 0 : evidence.filter((e) => e.status === 'verified').length / evidence.length

  let maxNodesPerView = 0
  for (const b of behaviours) {
    if (b.status !== 'built') continue
    const nodes = new Set((b.steps ?? []).flatMap((s) => [s.from, s.to]))
    maxNodesPerView = Math.max(maxNodesPerView, nodes.size)
  }

  const changed = seams.filter((s) => s.isContractChanged).map((s) => s.name)
  const contractChangedRecall = recall(expected.contractChanged ?? [], (n) => changed.some((c) => has(c, n)))
  const swallowed = swallowedNames(model)
  const swallowedRecall = recall(expected.swallowed ?? [], (n) => swallowed.some((s) => has(s, n)))

  const t = THRESHOLDS
  const pass =
    behaviourRecall >= t.behaviourRecall &&
    evidenceVerifiedRate >= t.evidenceVerifiedRate &&
    seamRecall >= t.seamRecall &&
    incidentalAccuracy >= t.incidentalAccuracy &&
    maxNodesPerView <= t.maxNodesPerView

  return {
    behaviourRecall,
    evidenceVerifiedRate,
    seamRecall,
    incidentalAccuracy,
    maxNodesPerView,
    contractChangedRecall,
    swallowedRecall,
    pass,
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [modelPath, expectedPath] = process.argv.slice(2)
  if (!modelPath || !expectedPath) {
    console.error('usage: node evals/score.mjs <model.json> <expected.json>')
    process.exit(2)
  }
  const read = (p) => JSON.parse(readFileSync(p, 'utf8'))
  const result = score(read(modelPath), read(expectedPath))
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.pass ? 0 : 1)
}
