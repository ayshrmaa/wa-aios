"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="error-state">
      <p className="label">Datenfehler</p>
      <h1>Das Dashboard konnte nicht geladen werden.</h1>
      <p>Pruefen Sie die Datenbankverbindung oder starten Sie die Seed-Demo.</p>
      <button type="button" onClick={reset}>Nochmals versuchen</button>
    </main>
  );
}
