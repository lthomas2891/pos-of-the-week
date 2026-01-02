import Link from "next/link";
import { createClient } from "../lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();

  // "This week" = start of week (Mon). You can adjust later.
  const today = new Date();
  const day = (today.getDay() + 6) % 7; // Mon=0..Sun=6
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - day);
  const weekStartISO = weekStart.toISOString().slice(0, 10);

  const { data: nominees, error } = await supabase
    .from("nominees")
    .select("id, title, summary, status, week_start")
    .eq("week_start", weekStartISO)
    .in("status", ["finalist", "winner"])
    .order("created_at", { ascending: true });

  if (error) {
    return (
      <main style={{ padding: 24 }}>
        <h1>POS of the Week</h1>
        <p>Could not load nominees: {error.message}</p>
      </main>
    );
  }

  return (
    <main style={{ padding: 24 }}>
      <h1>POS of the Week</h1>
      <Link
  href="/nominate"
  style={{
    display: "inline-block",
    padding: "8px 12px",
    border: "1px solid #333",
    borderRadius: 6,
    textDecoration: "none",
    margin: "12px 0",
  }}
>
  Nominate
</Link>

      <p>Week of {weekStartISO}</p>

      {!nominees?.length ? (
        <p>No nominees yet.</p>
      ) : (
        <ul>
          {nominees.map((n) => (
            <li key={n.id} style={{ marginBottom: 12 }}>
              <Link href={`/nominee/${n.id}`}>
                <b>{n.title}</b>
              </Link>
              <div>{n.summary}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
