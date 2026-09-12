import { createContext, useContext, useEffect, useState } from "react";

const ImageReady = createContext<(() => void) | null>(null);

export const ImageReadyProvider = ImageReady.Provider;

export function ChatImage({ src, alt }: { src: string; alt: string }) {
  const ready = useContext(ImageReady);
  const [errored, setErrored] = useState(false);

  // The fallback row is a different height from the image it replaces, so the
  // transcript is only worth re-measuring once that row has committed.
  useEffect(() => {
    if (errored) ready?.();
  }, [errored, ready]);

  if (errored) {
    return (
      <a className="image-failed" href={src} target="_blank" rel="noreferrer">
        {alt || src} — could not load
      </a>
    );
  }

  return (
    <a className="chat-image" href={src} target="_blank" rel="noreferrer">
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={() => ready?.()}
        onError={() => setErrored(true)}
      />
    </a>
  );
}
