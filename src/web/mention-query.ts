export type MentionQuery = { query: string; from: number };

const isBoundary = (char: string | undefined) => char === undefined || /\s/.test(char);

export function mentionQuery(draft: string, caret: number): MentionQuery | null {
  for (let at = caret - 1; at >= 0; at -= 1) {
    const char = draft[at]!;
    if (/\s/.test(char)) return null;
    if (char !== "@") continue;
    if (!isBoundary(draft[at - 1])) return null;
    return { query: draft.slice(at + 1, caret), from: at };
  }
  return null;
}
