import { useState } from "react";
import { highlightCode } from "./highlight.ts";

export function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div className="code-block">
      <div className="code-bar">
        <span className="lang" data-testid="lang">
          {lang ?? "text"}
        </span>
        <button type="button" className="copy" onClick={copy}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        {/* highlight.js escapes its input, so its output is the one thing here safe to inject. */}
        <code dangerouslySetInnerHTML={{ __html: highlightCode(code, lang) }} />
      </pre>
    </div>
  );
}
