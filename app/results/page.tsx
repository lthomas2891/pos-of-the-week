import ResultsClient from "./results-client";

export const dynamic = "force-dynamic";

export default function ResultsPage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Results: POS of the Week
      </h1>
      <p style={{ opacity: 0.8, marginBottom: 20 }}>
        Winners are marked via <b>Top Pick</b> in Notion.
      </p>
      <ResultsClient />
    </main>
  );
}
