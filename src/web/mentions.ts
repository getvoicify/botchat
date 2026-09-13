export type Segment = { kind: "text"; text: string } | { kind: "mention"; name: string };

// A name is scanned for rather than compiled into a pattern: participants are
// called things like `c++`, and a name spliced into a regular expression either
// throws or matches the wrong span.
const NAME_CHAR = /[\w-]/;

const isBoundary = (char: string | undefined) => char === undefined || /\s/.test(char);

export function segmentMentions(text: string, participants: string[]): Segment[] {
  const longestFirst = [...participants].sort((a, b) => b.length - a.length);
  const segments: Segment[] = [];
  let plain = "";
  let at = 0;

  const flush = () => {
    if (plain) segments.push({ kind: "text", text: plain });
    plain = "";
  };

  while (at < text.length) {
    if (text[at] === "@" && isBoundary(text[at - 1])) {
      const name = longestFirst.find((candidate) => nameSitsAt(text, at + 1, candidate));
      if (name) {
        flush();
        segments.push({ kind: "mention", name });
        at += name.length + 1;
        continue;
      }
    }
    plain += text[at];
    at += 1;
  }

  flush();
  return segments;
}

function nameSitsAt(text: string, from: number, name: string): boolean {
  if (text.slice(from, from + name.length).toLowerCase() !== name.toLowerCase()) return false;
  const after = text[from + name.length];
  return after === undefined || !NAME_CHAR.test(after);
}
