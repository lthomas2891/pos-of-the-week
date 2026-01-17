import VoteClient from "./vote-client";

export const dynamic = "force-dynamic";

export default function VotePage() {
  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
        Vote: POS of the Week
      </h1>
      <p style={{ opacity: 0.8, marginBottom: 20 }}>
        One vote per device. No login required.
      </p>
      <VoteClient />
    </main>
  );
}
