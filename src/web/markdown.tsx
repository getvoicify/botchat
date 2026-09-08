import { marked, type Token, type Tokens } from "marked";
import { Fragment, type ReactNode } from "react";
import { CodeBlock } from "./CodeBlock.tsx";

export function renderMarkdown(source: string): ReactNode {
  return <>{renderBlocks(marked.lexer(source))}</>;
}

function renderBlocks(tokens: Token[]): ReactNode[] {
  return tokens.map((token, index) => renderBlock(token, index));
}

function renderBlock(token: Token, key: number): ReactNode {
  switch (token.type) {
    case "space":
      return null;
    case "paragraph":
      return <p key={key}>{renderInline(token.tokens ?? [])}</p>;
    case "text":
      return (
        <Fragment key={key}>
          {token.tokens ? renderInline(token.tokens) : token.text}
        </Fragment>
      );
    case "heading": {
      const Tag = `h${Math.min(6, token.depth)}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
      return <Tag key={key}>{renderInline(token.tokens ?? [])}</Tag>;
    }
    case "code":
      return <CodeBlock key={key} code={token.text} lang={token.lang || null} />;
    case "blockquote":
      return <blockquote key={key}>{renderBlocks(token.tokens ?? [])}</blockquote>;
    case "hr":
      return <hr key={key} />;
    case "list": {
      const items = token.items.map((item: Tokens.ListItem, index: number) => (
        <li key={index}>{renderBlocks(item.tokens ?? [])}</li>
      ));
      return token.ordered ? (
        <ol key={key} start={typeof token.start === "number" ? token.start : undefined}>
          {items}
        </ol>
      ) : (
        <ul key={key}>{items}</ul>
      );
    }
    default:
      return <p key={key}>{token.raw}</p>;
  }
}

function renderInline(tokens: Token[]): ReactNode[] {
  return tokens.map((token, key) => {
    switch (token.type) {
      case "text":
      case "escape":
        return <Fragment key={key}>{token.text}</Fragment>;
      case "codespan":
        return <code key={key}>{token.text}</code>;
      case "strong":
        return <strong key={key}>{renderInline(token.tokens ?? [])}</strong>;
      case "em":
        return <em key={key}>{renderInline(token.tokens ?? [])}</em>;
      case "del":
        return <del key={key}>{renderInline(token.tokens ?? [])}</del>;
      case "link":
        return (
          <a key={key} href={token.href} target="_blank" rel="noreferrer">
            {renderInline(token.tokens ?? [])}
          </a>
        );
      case "br":
        return <br key={key} />;
      default:
        return <Fragment key={key}>{token.raw}</Fragment>;
    }
  });
}
