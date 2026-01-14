export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";

const notionHeaders = () => ({
  Authorization: `Bearer ${(process.env.NOTION_TOKEN || "").trim()}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
});

/* -------- Demo SAFE / UNSAFE rules (no OpenAI) -------- */

function hasEmail(s: string) {
  return /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(s);
}
function hasPhone(s: string) {
  return /(\+?\d[\d\s().-]{7,}\d)/.test(s);
}
function hasHandle(s: string) {
  return /@\w{2,}/.test(s);
}
function hasAddress(s: string) {
  return /\b\d{1,5}\s+\w+(\s+\w+){0,3}\s+(st|street|ave|avenue|rd|road|blvd|lane|ln|dr|drive|ct|court)\b/i.test(
    s
  );
}
function hasFullName(s: string) {
  return /\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b/.test(s);
}
function mentionsMinor(s: string) {
  return /\b(minor|child|kid|toddler|teen|underage|my son|my daughter)\b/i.test(s);
}

function classify(nominee: string, reason: string) {
  const t = `${nominee} ${reason}`;
  if (hasEmail(t) || hasPhone(t) || hasHandle(t) || hasAddress(t) || hasFullName(t) || mentionsMinor(t)) {
    return "UNSAFE" as const;
  }
  return "SAFE" as const;
}

function rewrite(nominee: string) {
  const n = nominee.trim();
  if (!n) return "";
  if (/\b(guy|person|energy|behavior)\b/i.test(n)) return n;
  return `${n} Guy`;
}

function summarize(nominee: string, reason: string) {
  const r = (reason || "").trim();
  if (!r) return `Vote on the weekly ${nominee}.`;
  return r.length > 160 ? r.slice(0, 157) + "..." : r;
}

/* ------------------- Core runner ------------------- */

async function run() {
  const databaseId = (process.env.NOTION_DATABASE_ID || "").trim();
  const notionToken = (process.env.NOTION_TOKEN || "").trim();

  if (!databaseId) return new NextResponse("Missing NOTION_DATABASE_ID", { status: 500 });
  if (!notionToken) return new NextResponse("Missing NOTION_TOKEN", { status: 500 });

  // Query rows needing review
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

  const pages = JSON.parse(qText).results || [];

  for (const p of pages) {
    const pageId = p.id;

    const nominee = p.properties?.Nominee?.title?.map((t: any) => t.plain_text).join("")?.trim() || "";
    const reason = p.properties?.Reason?.rich_text?.map((t: any) => t.plain_text).join("")?.trim() || "";

    if (!nominee) continue;

    const result = classify(nominee, reason);
    const rewritten = result === "SAFE" ? rewrite(nominee) : "";
    const summary = result === "SAFE" ? summarize(rewritten, reason) : "Flagged for moderator review.";

    const up = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({
        properties: {
          "AI Filter Result": { rich_text: [{ text: { content: result } }] },
          "AI Rewritten Version": { rich_text: [{ text: { content: rewritten } }] },
          "AI Summary": { rich_text: [{ text: { content: summary } }] },
          Status: {
            select: { name: result === "SAFE" ? "SAFE Candidates" : "UNSAFE / Discarded" },
          },
        },
      }),
    });

    const upText = await up.text();
    if (!up.ok) return new NextResponse(`Notion update failed: ${up.status}\n${upText}`, { status: 500 });
  }

  return NextResponse.json({ processed: pages.length, mode: "fallback", ok: true });
}

/* ------------------- Handlers ------------------- */

// Cron-job.org uses GET; your manual tests can use POST
export async function POST() {
  try {
    return await run();
  } catch (e: any) {
    return new NextResponse(`ai-review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}

export async function GET() {
  return POST();
}

// Some services "test" with HEAD first; return 200 so tests pass
export async function HEAD() {
  return new Response(null, { status: 200 });
}
