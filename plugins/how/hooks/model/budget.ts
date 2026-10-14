// Node budget: fold Elements into labelled groups when a diagram has too many. Pure.
import type { Element } from './behaviour-model'

export type Fold = {
  visibleIds: string[]
  groups: { id: string; label: string; memberIds: string[] }[]
}

export function foldToBudget(
  elementIds: string[],
  elements: Record<string, Element>,
  opts: { budget: number; cap: number; pinned: string[] },
): Fold {
  if (elementIds.length <= opts.budget) return { visibleIds: [...elementIds], groups: [] }

  const pinned = new Set(opts.pinned)
  const limit = elementIds.filter(id => pinned.has(id)).length > opts.budget ? opts.cap : opts.budget

  const byGroup = new Map<string, string[]>()
  for (const id of elementIds) {
    if (pinned.has(id)) continue
    const parent = elements[id]?.parentId
    const key = parent ?? '\u0000other'
    const list = byGroup.get(key)
    if (list) list.push(id)
    else byGroup.set(key, [id])
  }

  const order = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  let visible = elementIds.length
  const folded = new Set<string>()
  const groups: Fold['groups'] = []
  for (const [key, members] of order) {
    if (visible <= limit) break
    folded.add(key)
    visible -= members.length
    const isOther = key === '\u0000other'
    const name = isOther ? 'Other' : (elements[key]?.name ?? key)
    groups.push({ id: isOther ? 'group:other' : `group:${key}`, label: `${name} (${members.length})`, memberIds: members })
  }
  const foldedIds = new Set(groups.flatMap(g => g.memberIds))
  return { visibleIds: elementIds.filter(id => !foldedIds.has(id)), groups }
}
