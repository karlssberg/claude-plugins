// Panel navigation state: the drill-down stack and the per-view toggles. Pure functions; the state atoms live in
// register.tsx (the engine reads atoms only where plugin and key are literals of the same file as the read).
import type { BehaviourModel } from '../model/behaviour-model'

export type ViewRef =
  | { kind: 'map' }
  | { kind: 'behaviour'; behaviourId: string }
  | { kind: 'seam'; subjectId: string; behaviourId: string }
  | { kind: 'evidence'; ownerId: string; index: number }

export type Navigation = {
  stack: ViewRef[]
  showErrors: boolean
  expandedGroups: string[]
  /** Map only: show every Behaviour instead of the first 7. */
  showAll: boolean
}

export type ModelState = { path?: string; model?: BehaviourModel; error?: string }

export const initialNavigation = (): Navigation => ({
  stack: [{ kind: 'map' }],
  showErrors: false,
  expandedGroups: [],
  showAll: false,
})

export const push = (nav: Navigation, ref: ViewRef): Navigation => ({ ...nav, stack: [...nav.stack, ref] })

/** Keeps the stack up to and including index `depth` (0 is the Behaviour map). */
export const popTo = (nav: Navigation, depth: number): Navigation => ({
  ...nav,
  stack: nav.stack.slice(0, Math.max(0, depth) + 1),
})

export const toggleErrors = (nav: Navigation): Navigation => ({ ...nav, showErrors: !nav.showErrors })

export const toggleGroup = (nav: Navigation, id: string): Navigation => ({
  ...nav,
  expandedGroups: nav.expandedGroups.includes(id)
    ? nav.expandedGroups.filter(g => g !== id)
    : [...nav.expandedGroups, id],
})

export const showAllBehaviours = (nav: Navigation): Navigation => ({ ...nav, showAll: true })
