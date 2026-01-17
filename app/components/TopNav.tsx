import Link from "next/link";

export default function TopNav({ current }: { current: "vote" | "results" | "archive" }) {
  const itemStyle = (active: boolean): React.CSSProperties => ({
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #e5e5e5",
    textDecoration: "none",
    fontWeight: 800,
    background: active ? "#111" : "white",
    color: active ? "white" : "#111",
  });

  return (
    <nav style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
      <Link href="/vote" style={itemStyle(current === "vote")}>
        Vote
      </Link>
      <Link href="/results" style={itemStyle(current === "results")}>
        Results
      </Link>
      <Link href="/archive" style={itemStyle(current === "archive")}>
        Archive
      </Link>
    </nav>
  );
}
