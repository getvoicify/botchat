export type Draft = { kind: "text" | "code"; body: string; lang: string | null };

const FENCE = /^```([A-Za-z0-9+#._-]*)\n([\s\S]*?)\n?```$/;

export function parseDraft(raw: string): Draft {
  const trimmed = raw.trim();
  const match = FENCE.exec(trimmed);
  if (!match) return { kind: "text", body: trimmed, lang: null };
  return { kind: "code", body: match[2] ?? "", lang: match[1] || null };
}
