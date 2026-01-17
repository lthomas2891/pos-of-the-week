"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  nominee: string;
  summary: string;
  voteCopy: string;
  link: string | null;
  topPick: boolean;
  archived: boolean;
  dateSubmitted: string | null;
};

type ResultsResponse =
  | { ok: true; week: { startISO: string; endISO: string }; currentWinner: Item | null; pastWinners: Item[] }
  | { ok: false; error: string };

export default function ResultsClient() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/results", { cache: "no-store" });
        const json = (await res.json()) as ResultsResponse;
        if (!cancelled) setData(json);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message || e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <p>Loading results…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!data) return <p>Something went wrong.</p>;
  if (!data.ok) return <p style={{ color: "crimson" }}>{data.error}</p>;

  const { week, currentWinner, pastWinners } = data;

  return (
    <div>
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
          This Week ({week.startISO} → {week.endISO})
        </h2>

        {currentWinner ? (
          <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 800 }}>
              🏆 {currentWinner.nominee || "(No title)"}
            </div>

            <p style={{ marginTop: 10, marginBottom: 0, opacity: 0.9 }}>
              {currentWinner.voteCopy || currentWinner.summary || ""}
            </p>

            {currentWinner.link ? (
              <p style={{ marginTop: 10, marginBottom: 0 }}>
                <a href={currentWinner.link} target="_blank" rel="noreferrer">Source link</a>
              </p>
            ) : null}
          </div>
        ) : (
          <div style={{ padding: 12, border: "1px dashed #bbb", borderRadius: 12 }}>
            No winner selected yet. Mark a finalist as <b>Top Pick</b> in Notion.
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontSize: 18, fontWeight: 800, marginBottom: 8 }}>Past Winners</h2>

        {!pastWinners.length ? (
          <p style={{ opacity: 0.8 }}>No archived winners yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {pastWinners.map((w) => (
              <div key={w.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
                <div style={{ fontWeight: 800 }}>
                  {w.nominee || "(No title)"}{" "}
                  <span style={{ fontSize: 12, opacity: 0.7 }}>
                    {w.dateSubmitted ? `• ${w.dateSubmitted}` : ""}
                  </span>
                </div>
                {w.voteCopy || w.summary ? (
                  <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9 }}>
                    {w.voteCopy || w.summary}
                  </p>
                ) : null}
                {w.link ? (
                  <p style={{ marginTop: 8, marginBottom: 0 }}>
                    <a href={w.link} target="_blank" rel="noreferrer">Source link</a>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
