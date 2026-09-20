export default function HomePage() {
  return (
    <main className="shell">
      <section className="card" aria-labelledby="page-title">
        <p className="eyebrow">Shanda Fuel by ShandaHR</p>
        <h1 id="page-title">Engineering foundation ready.</h1>
        <p className="lede">
          The application baseline is in place for the modular monolith. Product workflows will be
          added by their owning workstreams after this foundation is reviewed and merged.
        </p>
        <a className="link" href="/api/health">
          Check application health
        </a>
      </section>
    </main>
  );
}
