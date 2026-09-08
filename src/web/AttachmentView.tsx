import { useState } from "react";
import { CodeBlock } from "./CodeBlock.tsx";
import { renderMarkdown } from "./markdown.tsx";

export type Attachment = { blobId: string; filename: string; mime: string; size: number };

const PREVIEW_LIMIT = 64 * 1024;

const previewable = (file: Attachment) =>
  file.mime.startsWith("text/") && file.size < PREVIEW_LIMIT;

const extensionOf = (filename: string) => filename.split(".").slice(1).pop() ?? null;

export function AttachmentView({ file }: { file: Attachment }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(null);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    if (text === null) setText(await (await fetch(`/api/blobs/${file.blobId}`)).text());
  }

  return (
    <li>
      <a href={`/api/blobs/${file.blobId}`}>{file.filename}</a>
      <span className="filesize">{file.size} bytes</span>
      {previewable(file) ? (
        <button type="button" className="preview-toggle" onClick={toggle}>
          {open ? "Hide" : "Preview"}
        </button>
      ) : null}
      {open && text !== null ? (
        <div className="attachment-preview" data-testid="attachment-preview">
          {file.mime.startsWith("text/markdown") ? (
            renderMarkdown(text)
          ) : (
            <CodeBlock code={text} lang={extensionOf(file.filename)} />
          )}
        </div>
      ) : null}
    </li>
  );
}
