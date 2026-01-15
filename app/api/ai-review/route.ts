import { NextResponse } from "next/server";

/**
 * /api/ai-review
 *
 * Security:
 * - Set CRON_SECRET in Vercel env vars
 * - Call with either:
 *    - /api/ai-review?secret=YOUR_SECRET   (best for Vercel cron)
 *    - header: x-cron-secret: YOUR_SECRET (nice for manual testing)
 *
 * Behavior (Step 2):
 * - Queries your Notion database
 * - Counts rows where:
 *    Archived == false
 *    AND Status is empty OR "Needs AI Review"
 * - Returns: processed = how many need review
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
  return "";
}

async function run(req: Request) {
  const denied = authorize(req);
  if (denied) return denied;

  const NOTION_TOKEN = (process.env.NOTION_TOKEN || "").trim();
  const DB = (process.env.NOTION_DATABASE_ID || "").trim();

  if (!NOTION_TOKEN || !DB) {
    return new NextResponse("Missing NOTION_TOKEN or NOTION_DATABASE_ID", { status: 500 });
  }

  // Query up to 50 rows
  const res = await fetch(`https://api.notion.com/v1/databases/${DB}/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({ page_size: 50 }),
  });

  const bodyText = await res.text();
  if (!res.ok) {
    return new NextResponse(`Notion query failed: ${res.status}\n${bodyText}`, { status: 500 });
  }

  const data = JSON.parse(bodyText);
  const pages = (data.results || []) as any[];

  const needsReview = pages.filter((p) => {
    const props = p.properties || {};

    const archivedProp = props["Archived"];
    const statusProp = props["Status"];

    const isArchived =
      archivedProp?.type === "checkbox" ? archivedProp.checkbox === true : false;

    const statusText = readTextProp(statusProp).toLowerCase();

    // "Needs review" if status empty OR exactly "needs ai review"
    const isNeeds = statusText === "" || statusText === "needs ai review";

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
