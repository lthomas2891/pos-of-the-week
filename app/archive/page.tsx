import ArchiveClient from "./archive-client";

export const dynamic = "force-dynamic";

export default function ArchivePage() {
  return (
    <main style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Archive</h1>
      <p style={{ opacity: 0.8, marginBottom: 16 }}>
        Browse archived finalists by year, month, and week (Mon–Sun).
      </p>
      <ArchiveClient />
    </main>
  );
}
