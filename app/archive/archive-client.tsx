"use client";

import { useEffect, useMemo, useState } from "react";

type Item = {
  id: string;
  nominee: string;
  summary: string;
  voteCopy: string;
  link: string | null;
  topPick: boolean;
  dateSubmitted: string | null;
};

type ApiResponse =
  | { ok: true; startISO: string; endISO: string; count: number; items: Item[] }
  | { ok: false; error: string };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// Returns week ranges (Mon–Sun) that intersect the given month.
// weekIndex is 1-based (1..N)
function getWeeksForMonth(year: number, month1to12: number) {
  const monthIndex = month1to12 - 1;

  const first = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0));
  const last = new Date(Date.UTC(year, monthIndex + 1, 0, 23, 59, 59, 999));

  // Move `d` to the Monday on/just before the 1st
  const firstDay = first.getUTCDay(); // 0 Sun
  const diffToMonday = (firstDay === 0 ? -6 : 1) - firstDay;
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() + diffToMonday);
  start.setUTCHours(0, 0, 0, 0);

  const weeks: { weekIndex: number; startISO: string; endISO: string; label: string }[] = [];
  let weekIndex = 1;
  let cursor = new Date(start);

  while (cursor <= last) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    weekEnd.setUTCHours(23, 59, 59, 999);

    // Clamp display range to month for nicer labels, but keep ISO boundaries as Mon–Sun
    const displayStart = weekStart < first ? first : weekStart;
    const displayEnd = weekEnd > last ? last : weekEnd;

    const startISO = weekStart.toISOString().slice(0, 10);
    const endISO = weekEnd.toISOString().slice(0, 10);

    const label = `Week ${weekIndex} (${displayStart.toISOString().slice(5, 10)} → ${displayEnd
      .toISOString()
      .slice(5, 10)})`;

    weeks.push({ weekIndex, startISO, endISO, label });

    weekIndex++;
    cursor.setUTCDate(cursor.getUTCDate() + 7);
    cursor.setUTCHours(0, 0, 0, 0);

    // hard cap to prevent infinite loop edge cases
    if (weeks.length > 8) break;
  }

  return weeks;
}

export default function ArchiveClient() {
  const now = new Date();
  const defaultYear = now.getUTCFullYear();
  const defaultMonth = now.getUTCMonth() + 1;

  const [year, setYear] = useState<number>(defaultYear);
  const [month, setMonth] = useState<number>(defaultMonth);
  const [weekIndex, setWeekIndex] = useState<number>(1);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const years = useMemo(() => {
    const ys: number[] = [];
    for (let y = defaultYear; y >= defaultYear - 5; y--) ys.push(y);
    return ys;
  }, [defaultYear]);

  const weeks = useMemo(() => getWeeksForMonth(year, month), [year, month]);

  useEffect(() => {
    // Reset week to 1 when changing month/year
    setWeekIndex(1);
  }, [year, month]);

  const selectedWeek = weeks.find((w) => w.weekIndex === weekIndex) || weeks[0];

  async function load() {
    if (!selectedWeek) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        startISO: selectedWeek.startISO,
        endISO: selectedWeek.endISO,
      });

      const res = await fetch(`/api/archive?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      setData(json);
      if (!json.ok) setError(json.error);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  // Auto-load on initial render and whenever selection changes
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, weekIndex]);

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1.5fr",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <label>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Year</div>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid #ddd", padding: "0 10px" }}
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Month</div>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid #ddd", padding: "0 10px" }}
          >
            {Array.from({ length: 12 }).map((_, i) => {
              const m = i + 1;
              return (
                <option key={m} value={m}>
                  {pad2(m)}
                </option>
              );
            })}
          </select>
        </label>

        <label>
          <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 6 }}>Week</div>
          <select
            value={weekIndex}
            onChange={(e) => setWeekIndex(Number(e.target.value))}
            style={{ width: "100%", height: 40, borderRadius: 10, border: "1px solid #ddd", padding: "0 10px" }}
          >
            {weeks.map((w) => (
              <option key={w.weekIndex} value={w.weekIndex}>
                {w.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 10 }}>
        Query range (Mon–Sun): <code>{selectedWeek?.startISO}</code> → <code>{selectedWeek?.endISO}</code>
      </div>

      {loading ? <p>Loading…</p> : null}
      {error ? <p style={{ color: "crimson" }}>{error}</p> : null}

      {data && data.ok ? (
        <div>
          <div style={{ marginBottom: 10, opacity: 0.8 }}>
            Found <b>{data.count}</b> archived finalist(s).
          </div>

          {!data.items.length ? (
            <div style={{ padding: 12, border: "1px dashed #bbb", borderRadius: 12 }}>
              Nothing archived for this week yet.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {data.items.map((it) => (
                <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontWeight: 800 }}>
                    {it.topPick ? "🏆 " : ""}
                    {it.nominee || "(No title)"}{" "}
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      {it.dateSubmitted ? `• ${it.dateSubmitted}` : ""}
                    </span>
                  </div>

                  {it.voteCopy || it.summary ? (
                    <p style={{ marginTop: 8, marginBottom: 0, opacity: 0.9 }}>
                      {it.voteCopy || it.summary}
                    </p>
                  ) : null}

                  {it.link ? (
                    <p style={{ marginTop: 8, marginBottom: 0 }}>
                      <a href={it.link} target="_blank" rel="noreferrer">
                        Source link
                      </a>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
