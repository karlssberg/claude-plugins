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

  // Phase 1: fold whole parent groups (size >= 2), largest first, until drawn nodes fit.
  // Drawn nodes = visible elements + group nodes.
  const order = [...byGroup.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  let drawn = elementIds.length
  const groups: Fold['groups'] = []
  const foldedKeys = new Set<string>()
  const nameOf = (key: string) => (key === '\u0000other' ? 'Other' : (elements[key]?.name ?? key))
  const idOf = (key: string) => (key === '\u0000other' ? 'group:other' : `group:${key}`)
  for (const [key, members] of order) {
    if (drawn <= limit) break
    if (members.length < 2) continue
    foldedKeys.add(key)
    drawn -= members.length - 1
    groups.push({ id: idOf(key), label: `${nameOf(key)} (${members.length})`, memberIds: members })
  }

  // Phase 2: still too many, so merge loose unpinned elements, then the smallest groups, into one Other group.
  if (drawn > limit) {
    const taken = new Set(groups.flatMap(g => g.memberIds))
    const loose = elementIds.filter(id => !pinned.has(id) && !taken.has(id))
    const pool: ({ el: string } | { group: Fold['groups'][number] })[] = [
      ...loose.map(el => ({ el })),
      ...[...groups]
        .sort((a, b) => a.memberIds.length - b.memberIds.length || (a.id < b.id ? -1 : 1))
        .map(group => ({ group })),
    ]
    const other = new Set<string>()
    let kept = [...groups]
    let visibleCount = elementIds.length - taken.size
    for (const item of pool) {
      if (visibleCount + kept.length + (other.size ? 1 : 0) <= limit) break
      if ('el' in item) {
        other.add(item.el)
        visibleCount--
      } else {
        item.group.memberIds.forEach(m => other.add(m))
        kept = kept.filter(g => g !== item.group)
      }
    }
    // An existing parent group may not be named "other"; Other is a distinct id.
    const rest = kept.filter(g => g.id !== 'group:other')
    if (other.size) {
      const members = elementIds.filter(id => other.has(id))
      rest.push({ id: 'group:other', label: `Other (${members.length})`, memberIds: members })
    }
    groups.length = 0
    groups.push(...rest)
  }
  const foldedIds = new Set(groups.flatMap(g => g.memberIds))
  return { visibleIds: elementIds.filter(id => !foldedIds.has(id)), groups }
}
