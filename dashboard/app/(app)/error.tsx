"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="offline">
      <strong>Couldn&apos;t load this view.</strong>
      <p className="muted" style={{ marginTop: 6 }}>{error.message}</p>
      <button className="btn" style={{ marginTop: 10 }} onClick={reset}>Retry</button>
    </div>
  );
}
