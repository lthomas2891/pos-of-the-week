import NominateForm from "./NominateForm";

export default function NominatePage() {
  return (
    <main style={{ padding: 24, maxWidth: 700 }}>
      <h1>Nominate a POS</h1>
      <p>Keep it about public situations/archetypes only. No private individuals.</p>
      <NominateForm />
    </main>
  );
}
