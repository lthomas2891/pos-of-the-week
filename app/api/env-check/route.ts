import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    hasCRON_SECRET: Boolean(process.env.CRON_SECRET),
    hasNOTION_VOTES_DATABASE_ID: Boolean(process.env.NOTION_VOTES_DATABASE_ID),
    hasNOTION_DATABASE_ID: Boolean(process.env.NOTION_DATABASE_ID),
    hasNOTION_TOKEN: Boolean(process.env.NOTION_TOKEN),
  });
}
