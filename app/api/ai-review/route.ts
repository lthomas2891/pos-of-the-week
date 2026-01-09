export const runtime = "nodejs";

import { NextResponse } from "next/server";

const notionHeaders = () => ({
  Authorization: `Bearer ${(process.env.NOTION_TOKEN || "").trim()}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
});

// --- Simple SAFE/UNSAFE heuristics (demo-quality) ---
function looksLikeEmail(s: string) {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(s);
}
function looksLikePhone(s: string) {
  return /(\+?\d[\d\s().-]{7,}\d)/.test(s);
}
function looksLikeHandle(s: string) {
  return /@\w{2,}/.test(s);
}
function looksLikeAddress(s: string) {
  // rough: number + street-ish word
  return /\b\d{1,5}\s+\w+(\s+\w+){0,3}\s+(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive|ct|court)\b/i.test(s);
}
function looksLikeFullName(s: string) {
  // two capitalized words (rough, but works for demo)
  return /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(s);
}
function mentionsMinor(s: string) {
  return /\b(minor|child|kid|toddler|teen|underage|my son|my daughter|high schooler|middle school)\b/i.test(s);
}

function classify(nominee: string, reason: string) {
  const text = `${nominee} ${reason}`.trim();

  // UNSAFE signals: PII / private individual vibes
  if (
    looksLikeEmail(text) ||
    looksLikePhone(text) ||
    looksLikeHandle(text) ||
    looksLikeAddress(text) ||
    mentionsMinor(text)
  ) {
    return "UNSAFE" as const;
  }

  // If it looks like a specific person's full name, treat as UNSAFE for your rules
  if (looksLikeFullName(text)) return "UNSAFE" as const;

  // Otherwise SAFE (archetype / behavior / situation)
  return "SAFE" as const;
}

function rewriteSafe(nominee: string) {
  // Turn "Reply-All Guy" style into vote-ready if needed
  const n = nominee.trim();
  if (!n) return "";

  // If it already ends with "guy" / "person" / "energy", keep it punchy
  if (/\b(guy|person|energy|behavior)\b/i.test(n)) return n;

  // Otherwise make it archetype-ish
  return `${n} Guy`;
}

function summarizeSafe(nominee: string, reason: string) {
  const n = nominee.trim();
  const r = reason.trim();
  if (!r) return `The weekly vote for: ${n}.`;
  // 1–2 sentence clean summary
  const short = r.length > 140 ? r.slice(0, 137) + "..." : r;
  return `${short}`;
}

export async function POST() {
  try {
    const databaseId = (process.env.NOTION_DATABASE_ID || "").trim();
    const notionToken = (process.env.NOTION_TOKEN || "").trim();
    if (!notionToken) return new NextResponse("Missing NOTION_TOKEN", { status: 500 });
    if (!databaseId) return new NextResponse("Missing NOTION_DATABASE_ID", { status: 500 });

    // Find rows where AI Filter Result is empty
    const q = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({
        filter: { property: "AI Filter Result", rich_text: { is_empty: true } },
        page_size: 10,
      }),
    });

    const qText = await q.text();
    if (!q.ok) return new NextResponse(`Notion query failed: ${q.status}\n${qText}`, { status: 500 });

    const qjson: any = JSON.parse(qText);
    const pages = qjson.results || [];

    for (const p of pages) {
      const pageId = p.id;

      const nominee =
        p.properties?.Nominee?.title?.map((t: any) => t.plain_text).join("")?.trim() || "";
      const reason =
        p.properties?.Reason?.rich_text?.map((t: any) => t.plain_text).join("")?.trim() || "";

      if (!nominee) continue;

      const result = classify(nominee, reason);

      let rewritten = "";
      let summary = "";

      if (result === "SAFE") {
        rewritten = rewriteSafe(nominee);
        summary = summarizeSafe(rewritten, reason);
      } else {
        // For UNSAFE, keep rewrite/summary minimal (or blank) for moderation
        rewritten = "";
        summary = "Flagged for moderator review (possible private individual or identifying info).";
      }

      const up = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "PATCH",
        headers: notionHeaders(),
        body: JSON.stringify({
          properties: {
            "AI Filter Result": { rich_text: [{ text: { content: result } }] },
            "AI Rewritten Version": { rich_text: [{ text: { content: rewritten } }] },
            "AI Summary": { rich_text: [{ text: { content: summary } }] },

            // OPTIONAL if you added Status as Select:
            // Status: { select: { name: result === "SAFE" ? "SAFE Candidates" : "UNSAFE / Discarded" } },
          },
        }),
      });

      const upText = await up.text();
      if (!up.ok) return new NextResponse(`Notion update failed: ${up.status}\n${upText}`, { status: 500 });
    }

    return NextResponse.json({ processed: pages.length, mode: "fallback_rules" });
  } catch (e: any) {
    return new NextResponse(`AI Review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}
