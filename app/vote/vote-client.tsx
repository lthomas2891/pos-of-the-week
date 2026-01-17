"use client";

import { useEffect, useMemo, useState } from "react";

type Finalist = {
  id: string;
  nominee: string;
  summary: string;
  voteCopy: string;
  link: string | null;
  topPick: boolean;
};

type FinalistsResponse =
  | { ok: true; week: { startISO: string; endISO: string }; finalists: Finalist[] }
  | { ok: false; error: string };

function voteKey(weekStartISO: string) {
  return `weeklypos_vote_${weekStartISO}`;
}

export default function VoteClient() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<FinalistsResponse | null>(null);
  const [myVote, setMyVote] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weekStartISO = data && data.ok ? data.week.startISO : null;

  const storedVote = useMemo(() => {
    if (!weekStartISO) return null;
    try {
      return localStorage.getItem(voteKey(weekStartISO));
    } catch {
      return null;
    }
  }, [weekStartISO]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch("/api/finalists", { cache: "no-store" });
        const json = (await res.json()) as FinalistsResponse;
        if (cancelled) return;

        setData(json);

        if (json.ok) {
          try {
            const v = localStorage.getItem(voteKey(json.week.startISO));
            setMyVote(v);
          } catch {
            setMyVote(null);
          }
        }
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

  async function castVote(nomineeId: string) {
    if (!data || !data.ok) return;
    if (myVote) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ weekStartISO: data.week.startISO, nomineeId }),
      });

      if (res.status === 409) {
        // Already voted (cookie). Mirror into localStorage for UI.
        try {
          localStorage.setItem(voteKey(data.week.startISO), nomineeId);
        } catch {}
        setMyVote(nomineeId);
        return;
      }

      const json = await res.json();
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || `Vote failed (${res.status})`);
      }

      try {
        localStorage.setItem(voteKey(data.week.startISO), nomineeId);
      } catch {}

      setMyVote(nomineeId);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <p>Loading finalists…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!data) return <p>Something went wrong.</p>;
  if (!data.ok) return <p style={{ color: "crimson" }}>{data.error}</p>;

  const { finalists, week } = data;

  if (!finalists.length) {
    return (
      <div>
        <p>No finalists yet for {week.startISO} → {week.endISO}.</p>
      </div>
    );
  }

  return (
    <div>
      <p style={{ marginBottom: 14, opacity: 0.8 }}>
        Week: <b>{week.startISO}</b> → <b>{week.endISO}</b>
      </p>

      {myVote && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 10, marginBottom: 16 }}>
          ✅ You voted. Thanks for keeping it spicy.
        </div>
      )}

      <div style={{ display: "grid", gap: 14 }}>
        {finalists.map((f) => {
          const votedForThis = myVote === f.id;
          return (
            <div key={f.id} style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700 }}>
                    {f.nominee || "(No title)"}
                    {f.topPick ? <span style={{ marginLeft: 8, fontSize: 12 }}>⭐ Top Pick</span> : null}
                  </div>
                  {f.voteCopy ? (
                    <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9 }}>{f.voteCopy}</p>
                  ) : f.summary ? (
                    <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9 }}>{f.summary}</p>
                  ) : null}

                  {f.link ? (
                    <p style={{ marginTop: 8, marginBottom: 0 }}>
                      <a href={f.link} target="_blank" rel="noreferrer">Source link</a>
                    </p>
                  ) : null}
                </div>

                <div style={{ minWidth: 140 }}>
                  <button
                    onClick={() => castVote(f.id)}
                    disabled={Boolean(myVote) || submitting}
                    style={{
                      width: "100%",
                      height: 40,
                      borderRadius: 10,
                      border: "1px solid #111",
                      background: votedForThis ? "#111" : "white",
                      color: votedForThis ? "white" : "#111",
                      cursor: myVote || submitting ? "not-allowed" : "pointer",
                      fontWeight: 700,
                    }}
                  >
                    {votedForThis ? "Voted" : "Vote"}
                  </button>
                  <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
                    One vote per device
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Dev-only helper: show what’s in localStorage */}
      {weekStartISO ? (
        <p style={{ marginTop: 18, fontSize: 12, opacity: 0.6 }}>
          Local vote key: <code>{voteKey(weekStartISO)}</code> — stored value:{" "}
          <code>{storedVote || "null"}</code>
        </p>
      ) : null}
    </div>
  );
}
