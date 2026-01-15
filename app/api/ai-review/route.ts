import { NextResponse } from "next/server";

/**
 * /api/ai-review
 *
 * Security:
 * - Set CRON_SECRET in Vercel env vars
 * - Call with either:
 *    - /api/ai-review?secret=YOUR_SECRET   (best for Vercel cron)
 *    - header: x-cron-secret: YOUR_SECRET (manual testing)
 *
 * Step 3 behavior:
 * - Queries Notion database
 * - Finds rows where:
 *    Archived == false
 *    AND Status is empty OR "Needs AI Review"
 * - Fallback-classifies SAFE/UNSAFE (no OpenAI)
 * - Writes back:
 *    AI Filter Result (rich_text)
 *    AI Rewritten Version (rich_text)
 *    AI Summary (rich_text)
 *    Status (select): "SAFE Candidates" or "UNSAFE / Discarded"
 */

const NOTION_VERSION = "2022-06-28";

// These must match your Notion Select option names EXACTLY.
const STATUS_NEEDS_REVIEW = "Needs AI Review";
const STATUS_SAFE = "SAFE Candidates";
const STATUS_UNSAFE = "UNSAFE / Discarded";

function authorize(req: Request) {
  const required = (process.env.CRON_SECRET || "").trim();
  if (!required) return null;

  const url = new URL(req.url);
  const secretFromQuery = (url.searchParams.get("secret") || "").trim();
  const secretFromHeader = (req.headers.get("x-cron-secret") || "").trim();

  if (secretFromQuery === required || secretFromHeader === required) return null;
  return new NextResponse("Unauthorized", { status: 401 });
}

function readTextProp(prop: any): string {
  if (!prop) return "";
  if (prop.type === "rich_text") {
    return (prop.rich_text || []).map((x: any) => x.plain_text).join("").trim();
  }
  if (prop.type === "title") {
    return (prop.title || []).map((x: any) => x.plain_text).join("").trim();
  }
  if (prop.type === "select") {
    return (prop.select?.name || "").trim();
  }
  if (prop.type === "url") {
    return (prop.url || "").trim();
  }
  return "";
}

function looksLikePrivatePersonOrTargeting(text: string) {
  const t = text.toLowerCase();

  // Strong “personal targeting” signals
  const personalPhrases = [
    "my coworker",
    "my co-worker",
    "my boss",
    "my neighbor",
    "my neighbour",
    "my teacher",
    "my professor",
    "my girlfriend",
    "my boyfriend",
    "my wife",
    "my husband",
    "my ex",
    "my mom",
    "my dad",
    "my child",
    "my kid",
    "this guy i know",
    "this girl i know",
    "someone i know",
    "a guy i know",
    "a girl i know",
    "in my class",
    "at my job",
    "at work",
  ];

  if (personalPhrases.some((p) => t.includes(p))) return true;

  // Basic “full name” heuristic (two capitalized words) — imperfect but helpful.
  // We only treat it as unsafe if combined with other negative framing words.
  const hasTwoWordName = /\b[A-Z][a-z]+ [A-Z][a-z]+\b/.test(text);
  const negativeWords = ["idiot", "moron", "stupid", "trash", "loser", "jerk", "pos", "piece of"];
  if (hasTwoWordName && negativeWords.some((w) => t.includes(w))) return true;

  return false;
}

function classifyFallback(input: {
  nominee: string;
  reason: string;
  link: string;
}) {
  const combined = `${input.nominee}\n${input.reason}\n${input.link}`.trim();

  const unsafe = looksLikePrivatePersonOrTargeting(combined);

  const verdict = unsafe ? "UNSAFE" : "SAFE";

  // Rewrite into vote-ready, archetype/situation framing
  // Keep it short and funny, avoid targeting individuals.
  const nomineeClean = input.nominee.trim() || "Untitled nominee";
  const reasonClean = input.reason.trim();

  const rewritten =
    unsafe
      ? `🚫 Removed: This nomination looks like it targets a private person. Please submit public situations or archetypes only.`
      : `**${nomineeClean}** — ${reasonClean ? reasonClean : "A classic weekly offender in the wild."}`.slice(0, 900);

  const summary =
    unsafe
      ? "Flagged as targeting a private person."
      : `${nomineeClean}: ${reasonClean ? reasonClean : "A recurring archetype worth a vote."}`.slice(0, 300);

  return { verdict, rewritten, summary };
}

async function notionQueryDatabase(DB: string, token: string) {
  const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({ page_size: 50 }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Notion query failed: ${res.status}\n${text}`);
  return JSON.parse(text);
}

async function notionUpdatePage(pageId: string, token: string, properties: any) {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify({ properties }),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Notion update failed: ${res.status}\n${text}`);
  return JSON.parse(text);
}

async function run(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  const token = (process.env.NOTION_TOKEN || "").trim();
  const DB = (process.env.NOTION_DATABASE_ID || "").trim();
  if (!token || !DB) {
    return new NextResponse("Missing NOTION_TOKEN or NOTION_DATABASE_ID", { status: 500 });
  }

  // 1) Query
  const data = await notionQueryDatabase(DB, token);
  const pages = (data.results || []) as any[];

  // 2) Filter “needs review”
  const needsReview = pages.filter((p) => {
    const props = p.properties || {};
    const archivedProp = props["Archived"];
    const statusProp = props["Status"];

    const isArchived =
      archivedProp?.type === "checkbox" ? archivedProp.checkbox === true : false;

    const statusText = readTextProp(statusProp);
    const isNeeds = statusText === "" || statusText === STATUS_NEEDS_REVIEW;

    return !isArchived && isNeeds;
  });

  // 3) Process + update
  let updated = 0;
  const details: Array<{ id: string; verdict: string; statusSet: string }> = [];

  for (const p of needsReview) {
    const props = p.properties || {};
    const pageId = p.id as string;

    const nominee = readTextProp(props["Nominee"]);
    const reason = readTextProp(props["Reason"]);
    const link = readTextProp(props["Link"]);

    const { verdict, rewritten, summary } = classifyFallback({ nominee, reason, link });

    const statusSet = verdict === "SAFE" ? STATUS_SAFE : STATUS_UNSAFE;

    // Notion properties update
    // NOTE: Status is a SELECT, so name must match existing option names.
    const patchProps = {
      "AI Filter Result": {
        rich_text: [{ type: "text", text: { content: verdict } }],
      },
      "AI Rewritten Version": {
        rich_text: [{ type: "text", text: { content: rewritten } }],
      },
      "AI Summary": {
        rich_text: [{ type: "text", text: { content: summary } }],
      },
      Status: {
        select: { name: statusSet },
      },
    };

    await notionUpdatePage(pageId, token, patchProps);
    updated += 1;
    details.push({ id: pageId, verdict, statusSet });
  }

  return NextResponse.json({
    ok: true,
    mode: "fallback-writeback",
    processed: needsReview.length,
    updated,
    checked: pages.length,
    ranAt: new Date().toISOString(),
    details: details.slice(0, 10),
  });
}

/* ------------------- Handlers ------------------- */

export async function GET(req: Request) {
  try {
    return await run(req);
  } catch (e: any) {
    return new NextResponse(`ai-review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    return await run(req);
  } catch (e: any) {
    return new NextResponse(`ai-review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}

export async function HEAD() {
  return new Response(null, { status: 200 });
}
