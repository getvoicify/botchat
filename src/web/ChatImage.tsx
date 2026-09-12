import { useState } from "react";

export function ChatImage({ src, alt }: { src: string; alt: string }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <a className="image-failed" href={src} target="_blank" rel="noreferrer">
        {alt || src} — could not load
      </a>
    );
  }

  return (
    <a className="chat-image" href={src} target="_blank" rel="noreferrer">
      <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setErrored(true)} />
    </a>
  );
}
