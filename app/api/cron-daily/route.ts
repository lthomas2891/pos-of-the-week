import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CRON_SECRET = process.env.CRON_SECRET;

function getSecret(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("secret") || req.headers.get("x-cron-secret");
}

function assertEnv() {
  if (!CRON_SECRET) throw new Error("Missing CRON_SECRET");
}

function getBaseUrl(req: Request): string {
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) return `https://${vercelUrl}`;

  const host = req.headers.get("host");
  if (host) return `https://${host}`;

  return "https://app.weeklypos.com";
}

type CallResult =
  | { url: string; ok: true; status: number; json: unknown }
  | { url: string; ok: false; status: number; text: string };

async function callInternal(baseUrl: string, path: string, secret: string): Promise<CallResult> {
  const url = `${baseUrl}${path}`;

  const res = await fetch(url, {
    method: "GET",
    headers: { "x-cron-secret": secret },
    cache: "no-store",
  });

  const text = await res.text();

  try {
    const json: unknown = JSON.parse(text);
    if (res.ok) return { url, ok: true, status: res.status, json };
    return { url, ok: false, status: res.status, text };
  } catch {
    if (res.ok) return { url, ok: true, status: res.status, json: text };
    return { url, ok: false, status: res.status, text };
  }
}

export async function GET(req: Request) {
  try {
    assertEnv();

    const provided = getSecret(req);
    if (!provided || provided !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const baseUrl = getBaseUrl(req);

    const url = new URL(req.url);
    const limit = url.searchParams.get("limit");
    const tz = url.searchParams.get("tz");

    const qs = new URLSearchParams();
    if (limit) qs.set("limit", limit);
    if (tz) qs.set("tz", tz);

    const finalistsPath = qs.toString()
      ? `/api/weekly-finalists?${qs.toString()}`
      : "/api/weekly-finalists";

    const aiReview = await callInternal(baseUrl, "/api/ai-review", CRON_SECRET);
    if (!aiReview.ok) {
      return NextResponse.json(
        { ok: false, mode: "cron-daily", stepFailed: "ai-review", aiReview },
        { status: 500 }
      );
    }

    const weeklyFinalists = await callInternal(baseUrl, finalistsPath, CRON_SECRET);
    if (!weeklyFinalists.ok) {
      return NextResponse.json(
        { ok: false, mode: "cron-daily", stepFailed: "weekly-finalists", aiReview, weeklyFinalists },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      mode: "cron-daily",
      ran: { aiReview, weeklyFinalists },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
