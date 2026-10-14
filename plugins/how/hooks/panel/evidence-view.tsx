// Evidence view: the exact code (and PR diff hunk) behind a node or edge, inline in the panel.
import type { BehaviourModel } from '../model/behaviour-model'
import { resolveEvidenceOwner } from './evidence-owner'
import type { ViewRef } from './navigation'
import type { PaneEnv } from './pane'
import { BUTTON_PAD, truncate, wrap } from './text'

/** A loaded snippet (the cited lines ±3), or why there is none. Keyed by `snippetKey`. */
export type Snippet = { source: string; startLine: number } | { error: string }
export type Snippets = Record<string, Snippet>

/** Lines of context kept either side of the cited lines. */
export const CONTEXT_LINES = 3

export const snippetKey = (e: { file: string; startLine: number; endLine: number }) => `${e.file}:${e.startLine}-${e.endLine}`

/** The cited lines ±CONTEXT_LINES of `text`, with the 1-based number of the first line kept. */
export function sliceSnippet(text: string, startLine: number, endLine: number): { source: string; startLine: number } {
  const lines = text.split('\n')
  const first = Math.max(1, startLine - CONTEXT_LINES)
  const last = Math.min(lines.length, endLine + CONTEXT_LINES)
  return { source: lines.slice(first - 1, last).join('\n'), startLine: first }
}

export const absolutePath = (cwd: string, file: string) =>
  file.startsWith('/') ? file : `${cwd.replace(/\/+$/, '')}/${file}`

export function renderEvidenceView(
  env: PaneEnv,
  ref: Extract<ViewRef, { kind: 'evidence' }>,
  model: BehaviourModel,
  snippets: Snippets,
  columns: number,
  surface: string,
) {
  const { Box, Text, Button, Code, Link } = env.ui
  const owner = resolveEvidenceOwner(model, ref.ownerId)
  const item = owner?.evidence[ref.index]
  if (!owner || !item) {
    return (
      <Box key="evidence-missing">
        <Text dimColor>{truncate('Evidence not found in the Behaviour model.', columns)}</Text>
      </Box>
    )
  }
  const count = owner.evidence.length
  const snippet = snippets[snippetKey(item)]
  const lines = item.startLine === item.endLine ? `${item.startLine}` : `${item.startLine}-${item.endLine}`
  const verified = item.status === 'verified'
  const to = (index: number) => () => env.openEvidence(ref.ownerId, index)

  return (
    <Box flexDirection="column">
      <Box key="evidence-heading" flexDirection="column">
        {wrap(owner.label, columns).map((l: string) => (
          <Text bold>{l}</Text>
        ))}
      </Box>
      {count > 1 && (
        <Box key="evidence-pager" flexDirection="row">
          {ref.index > 0 && (
            <Button key="prev-evidence" onPress={to(ref.index - 1)}>
              ‹ prev
            </Button>
          )}
          <Text dimColor>{` ${ref.index + 1} of ${count} `}</Text>
          {ref.index < count - 1 && (
            <Button key="next-evidence" onPress={to(ref.index + 1)}>
              next ›
            </Button>
          )}
        </Box>
      )}
      <Box key="evidence-location" flexDirection="column">
        {wrap(`${item.file}:${lines}  ${item.symbol}`, columns).map((l: string) => (
          <Text dimColor>{l}</Text>
        ))}
      </Box>
      <Box key="evidence-status">
        <Text color={verified ? 'green' : 'yellow'}>{verified ? 'verified' : 'inferred (not proven by the code)'}</Text>
      </Box>
      {snippet === undefined ? (
        <Box key="evidence-code-loading">
          <Text dimColor>Loading source…</Text>
        </Box>
      ) : 'error' in snippet ? (
        <Box key="evidence-code-unavailable" flexDirection="column">
          <Text color="red">source unavailable</Text>
          {wrap(snippet.error, columns).map((l: string) => (
            <Text dimColor>{l}</Text>
          ))}
        </Box>
      ) : (
        <Box key="evidence-code">
          <Code path={item.file} startLine={snippet.startLine} source={snippet.source} />
        </Box>
      )}
      {item.hunk !== undefined && item.hunk !== '' && (
        <Box key="evidence-hunk" flexDirection="column">
          <Text dimColor>Changed in this PR</Text>
          <Code path={item.file} format="diff" source={item.hunk} />
        </Box>
      )}
      {surface === 'terminal' && env.cwd !== undefined && (
        <Box key="evidence-editor">
          <Link href={`vscode://file/${absolutePath(env.cwd, item.file)}:${item.startLine}`}>Open in editor</Link>
        </Box>
      )}
    </Box>
  )
}
