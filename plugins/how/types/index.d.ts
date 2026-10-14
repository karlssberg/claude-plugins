// PluginState contract for plugin `how`. Self-contained by rule (no imports): the shapes below mirror
// hooks/panel/navigation.ts (Navigation, ViewRef), hooks/drill-down.ts (PendingBuilds) and hooks/model/behaviour-model.ts (BehaviourModel, which is
// held as plain data here; the hooks cast it to BehaviourModel after parseBehaviourModel has validated it).
declare module 'claude-code' {
  interface PluginState {
    how: {
      model: { path?: string; source?: string; model?: { [key: string]: unknown }; error?: string }
      /** Builds waiting for their refresh, by the spawned builder's agentId (hooks/drill-down.ts PendingBuild). */
      pending: {
        [agentId: string]: {
          subject: { kind: 'behaviour'; behaviourId: string } | { kind: 'seam'; subjectId: string; behaviourId: string }
          modelPath: string
          fragmentName: string
        }
      }
      snippets: { [key: string]: { source: string; startLine: number; more?: number } | { error: string } }
      nav: {
        stack: (
          | { kind: 'map' }
          | { kind: 'behaviour'; behaviourId: string }
          | { kind: 'seam'; subjectId: string; behaviourId: string }
          | { kind: 'evidence'; ownerId: string; index: number }
        )[]
        showErrors: boolean
        expandedGroups: string[]
        showAll: boolean
      }
    }
  }
}
