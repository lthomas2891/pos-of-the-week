import { NextResponse } from "next/server";

/**
 * /api/ai-review
 * - GET/POST both run the same logic (cron + manual)
 * - HEAD returns 200 (some schedulers test with HEAD)
 * - Optional protection using CRON_SECRET:
 *    - Accepts ?secret=YOUR_SECRET  (works with Vercel cron)
 *    - OR header: x-cron-secret: YOUR_SECRET (works with curl/cron-job.org)
 */

function authorize(req: Request) {
  const required = (process.env.CRON_SECRET || "").trim();
  if (!required) return null; // no secret configured => allow

  const url = new URL(req.url);
  const secretFromQuery = (url.searchParams.get("secret") || "").trim();
  const secretFromHeader = (req.headers.get("x-cron-secret") || "").trim();

  if (secretFromQuery === required || secretFromHeader === required) return null;

  return new NextResponse("Unauthorized", { status: 401 });
}
async function run(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  const NOTION_TOKEN = (process.env.NOTION_TOKEN || "").trim();
  const DB = (process.env.NOTION_DATABASE_ID || "").trim();

  if (!NOTION_TOKEN || !DB) {
    return new NextResponse("Missing NOTION_TOKEN or NOTION_DATABASE_ID", { status: 500 });
  }

  // Pull up to 50 entries
  const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({ page_size: 50 }),
  });

  const text = await res.text();
  if (!res.ok) return new NextResponse(`Notion query failed: ${res.status}\n${text}`, { status: 500 });

  const data = JSON.parse(text);
  const pages = (data.results || []) as any[];

  // Count: not archived AND status empty OR status == "Needs AI Review"
  const needsReview = pages.filter((p) => {
    const props = p.properties || {};
    const archived = props["Archived"];
    const status = props["Status"];

    const isArchived = archived?.type === "checkbox" ? archived.checkbox === true : false;

    // Status can be rich_text, select, or (rarely) title
    const statusText =
      status?.type === "rich_text"
        ? (status.rich_text?.map((x: any) => x.plain_text).join("") || "").trim()
        : status?.type === "select"
        ? (status.select?.name || "").trim()
        : status?.type === "title"
        ? (status.title?.map((x: any) => x.plain_text).join("") || "").trim()
        : "";

    const isNeeds =
      statusText === "" || statusText.toLowerCase() === "needs ai review";

    return !isArchived && isNeeds;
  });

  return NextResponse.json({
    ok: true,
    mode: "status-count",
    processed: needsReview.length,
    checked: pages.length,
    ranAt: new Date().toISOString(),
  });
}

  const needsReview = pages.filter((p) => {
    const props = p.properties || {};

    const ai = props["AI Filter Result"];
    const archived = props["Archived"];

    const aiEmpty =
      !ai ||
      (ai.type === "select" && !ai.select) ||
      (ai.type === "rich_text" && (!ai.rich_text || ai.rich_text.length === 0));

    const isArchived =
      archived &&
      archived.type === "checkbox" &&
      archived.checkbox === true;

    return aiEmpty && !isArchived;
  });

  return NextResponse.json({
    ok: true,
    mode: "notion-count",
    processed: needsReview.length,
    checked: pages.length,
    ranAt: new Date().toISOString(),
  });
}

// Cron / browser tests usually use GET
export async function GET(req: Request) {
  try {
    return await run(req);
  } catch (e: any) {
    return new NextResponse(`ai-review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}

// Manual triggers can use POST too
export async function POST(req: Request) {
  try {
    return await run(req);
  } catch (e: any) {
    return new NextResponse(`ai-review crashed: ${e?.message || String(e)}`, { status: 500 });
  }
}

// Some services probe with HEAD
export async function HEAD() {
  return new Response(null, { status: 200 });
}
