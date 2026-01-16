import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Daily Orchestrator (1 cron hit/day)
 * Runs:
 *  1) /api/ai-review
 *  2) /api/weekly-finalists
 *
 * Security:
 *  - ?secret=CRON_SECRET
 *  - OR x-cron-secret header
 *
 * Query params:
 *  - limit (optional): forwarded to weekly-finalists (default behavior is inside that route)
 *  - tz (optional): forwarded to weekly-finalists (if supported in your current route)
 */

const CRON_SECRET = process.env.CRON_SECRET;

function getSecret(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("secret") || req.headers.get("x-cron-secret");
}

function assertEnv() {
  if (!CRON_SECRET) throw new Error("Missing CRON_SECRET");
}

function getBaseUrl(req: Request): string {
  // Prefer Vercel-provided host if available
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  // Fallback to the incoming request host (works in many environments)
  const host = req.headers.get("host");
  if (host) return `https://${host}`;

  // Final fallback (your production domain)
  return "https://app.weeklypos.com";
}

async function callInternal(
  baseUrl: string,
  pathWithQuery: string,
  secret: string
) {
  const url = `${baseUrl}${pathWithQuery}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "x-cron-secret": secret,
    },
    // Ensure we don't cache
    cache: "no-store",
  });

  const text = await res.text();
