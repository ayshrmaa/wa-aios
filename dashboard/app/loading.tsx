export default function Loading() {
  return (
    <main className="dashboard-shell" aria-label="Dashboard wird geladen">
      <div className="loading-block loading-header" />
      <div className="loading-grid">
        <div className="loading-block loading-large" />
        <div className="loading-block loading-large" />
        <div className="loading-block loading-medium" />
        <div className="loading-block loading-medium" />
      </div>
    </main>
  );
}
