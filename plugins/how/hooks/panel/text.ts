// Text helpers: every line the panel draws as text must fit e.props.bodyColumns.
import { truncate } from '../layout/sequence-layout'

export { truncate }

/** Word-wraps to `width` cells; words longer than the width are cut with an ellipsis. */
export function wrap(text: string, width: number): string[] {
  const w = Math.max(1, width)
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const piece = Array.from(word).length > w ? truncate(word, w) : word
    if (line === '') line = piece
    else if (Array.from(line).length + 1 + Array.from(piece).length <= w) line += ` ${piece}`
    else {
      lines.push(line)
      line = piece
    }
  }
  if (line !== '') lines.push(line)
  return lines.length > 0 ? lines : ['']
}
