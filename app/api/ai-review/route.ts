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

  // Temporary fallback demo response (Step 2 will replace this later)
  return NextResponse.json({
    ok: true,
    mode: "fallback",
    processed: 0,
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
