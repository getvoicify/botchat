import { marked, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { ChatImage } from "./ChatImage.tsx";
import { CodeBlock } from "./CodeBlock.tsx";
import { segmentMentions } from "./mentions.ts";

export type Mentions = { participants: string[]; me: string | null };

const NOBODY: Mentions = { participants: [], me: null };

export function renderMarkdown(source: string, mentions: Mentions = NOBODY): ReactNode {
  return <>{renderBlocks(marked.lexer(source), mentions)}</>;
}

function renderBlocks(tokens: Token[], mentions: Mentions): ReactNode[] {
  return tokens.map((token, index) => renderBlock(token, index, mentions));
}

function renderBlock(token: Token, key: number, mentions: Mentions): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return <p key={key}>{renderInline(token.tokens ?? [], mentions)}</p>;
    case "text":
      return (
        <Fragment key={key}>
          {token.tokens ? renderInline(token.tokens, mentions) : renderText(token.text, mentions)}
        </Fragment>
      );
    case "heading": {
      const Tag = `h${Math.min(6, token.depth)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{renderInline(token.tokens ?? [], mentions)}</Tag>;
    }
    case "code":
      return <CodeBlock key={key} code={token.text} lang={token.lang || null} />;
    case "blockquote":
      return <blockquote key={key}>{renderBlocks(token.tokens ?? [], mentions)}</blockquote>;
    case "hr":
      return <hr key={key} />;
    case "list": {
      const items = token.items.map((item: Tokens.ListItem, index: number) => (
        <li key={index}>{renderBlocks(item.tokens ?? [], mentions)}</li>
      ));
      return token.ordered ? (
        <ol key={key} start={typeof token.start === "number" ? token.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    case "table": {
      const columns = token.align ?? [];
      return (
        <div className="table-scroll" key={key}>
          <table>
            <thead>
              <tr>
                {token.header.map((cell: Tokens.TableCell, index: number) => (
                  <th key={index} style={alignment(columns[index])}>
                    {renderInline(cell.tokens ?? [], mentions)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {token.rows.map((row: Tokens.TableCell[], rowIndex: number) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} style={alignment(columns[index])}>
                      {renderInline(cell.tokens ?? [], mentions)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    default:
      return <p key={key}>{token.raw}</p>;
  }
}

function alignment(align: "left" | "center" | "right" | null | undefined) {
  return align ? { textAlign: align } : undefined;
}

function renderInline(tokens: Token[], mentions: Mentions): ReactNode[] {
  return tokens.map((token, key) => {
    switch (token.type) {
      case "text":
        return <Fragment key={key}>{renderText(token.text, mentions)}</Fragment>;
      case "escape":
        return <Fragment key={key}>{token.text}</Fragment>;
      case "codespan":
        return <code key={key}>{token.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(token.tokens ?? [], mentions)}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.tokens ?? [], mentions)}</em>;
      case "del":
        return <del key={key}>{renderInline(token.tokens ?? [], mentions)}</del>;
      case "link":
        return (
          <a key={key} href={token.href} target="_blank" rel="noreferrer">
            {renderInline(token.tokens ?? [], mentions)}
          </a>
        );
      case "image":
        return <ChatImage key={key} src={token.href} alt={token.text} />;
      case "br":
        return <br key={key} />;
      default:
        return <Fragment key={key}>{token.raw}</Fragment>;
    }
  });
}

// Only a markdown `text` token is segmented, never the message source: an @name
// inside a fenced block or a codespan is a snippet, not a mention of anyone.
function renderText(text: string, mentions: Mentions): ReactNode[] {
  return segmentMentions(text, mentions.participants).map((segment, key) =>
    segment.kind === "text" ? (
      <Fragment key={key}>{segment.text}</Fragment>
    ) : (
      <span key={key} className={chipClass(segment.name, mentions.me)}>
        @{segment.name}
      </span>
    ),
  );
}

function chipClass(name: string, me: string | null): string {
  return me && name.toLowerCase() === me.toLowerCase() ? "mention mention-you" : "mention";
}
