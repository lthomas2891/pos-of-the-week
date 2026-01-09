export const runtime = "nodejs";

import { NextResponse } from "next/server";
import OpenAI from "openai";

const notionHeaders = () => ({
  Authorization: `Bearer ${(process.env.NOTION_TOKEN || "").trim()}`,
  "Content-Type": "application/json",
  "Notion-Version": "2022-06-28",
});

export async function POST() {
  try {
    const databaseId = (process.env.NOTION_DATABASE_ID || "").trim();
    const notionToken = (process.env.NOTION_TOKEN || "").trim();
    const openaiKey = (process.env.OPENAI_API_KEY || "").trim();

    if (!openaiKey) return new NextResponse("Missing OPENAI_API_KEY (Vercel env var)", { status: 500 });
    if (!notionToken) return new NextResponse("Missing NOTION_TOKEN (Vercel env var)", { status: 500 });
    if (!databaseId) return new NextResponse("Missing NOTION_DATABASE_ID (Vercel env var)", { status: 500 });

    const openai = new OpenAI({ apiKey: openaiKey });

    // 1) Find rows where AI Filter Result is empty
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

      const prompt = `
You are an automated safety filter and rewriting engine for a humor voting site called "POS of the Week."

Decide if the nomination is SAFE or UNSAFE.
- UNSAFE if it refers to a minor or a private individual, or includes identifying info.
- SAFE if it refers to a public situation, company, fictional character, archetype, meme, behavior, or general scenario.

If SAFE:
- Rewrite into a fun, clean, general version (no names/usernames/identifiers).
- Write a 1–2 sentence summary for a public poll.

Return JSON ONLY like:
{"result":"SAFE"|"UNSAFE","rewritten":"...","summary":"..."}

Nominee: ${nominee}
Reason: ${reason}
`;

      const resp = await openai.responses.create({
        model: "gpt-5.2",
        input: prompt,
      });

      const text = (resp.output_text || "").trim();

      let parsed: any;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { result: "UNSAFE", rewritten: "", summary: "" };
      }

      const result = parsed.result === "SAFE" ? "SAFE" : "UNSAFE";
      const rewritten = String(parsed.rewritten || "").slice(0, 1800);
      const summary = String(parsed.summary || "").slice(0, 1800);

      const up = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: "PATCH",
        headers: notionHeaders(),
        body: JSON.stringify({
          properties: {
            "AI Filter Result": { rich_text: [{ text: { content: result } }] },
            "AI Rewritten Version": { rich_text: [{ text: { content: rewritten } }] },
            "AI Summary": { rich_text: [{ text: { content: summary } }] },

            // OPTIONAL (only if you added Status as a Select):
            // Status: { select: { name: result === "SAFE" ? "SAFE Candidates" : "UNSAFE / Discarded" } },
          },
        }),
      });

      const upText = await up.text();
      if (!up.ok) return new NextResponse(`Notion update failed: ${up.status}\n${upText}`, { status: 500 });
    }

    return NextResponse.json({ processed: pages.length });
  } catch (e: any) {
    return new NextResponse(`AI Review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}
