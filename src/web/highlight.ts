import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

for (const [name, language] of [
  ["typescript", typescript],
  ["javascript", javascript],
  ["python", python],
  ["json", json],
  ["bash", bash],
  ["sql", sql],
  ["xml", xml],
  ["css", css],
  ["go", go],
  ["rust", rust],
  ["yaml", yaml],
  ["markdown", markdown],
  ["diff", diff],
] as const) {
  hljs.registerLanguage(name, language);
}

const escapeHtml = (raw: string) =>
  raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

// hljs.highlight throws on a language it does not know, which would blank the room for
// everyone else the moment one bot fences a block in something unregistered.
export function highlightCode(code: string, lang: string | null): string {
  if (lang && hljs.getLanguage(lang)) return hljs.highlight(code, { language: lang }).value;
  return escapeHtml(code);
}
