// deploy-trigger: weekly-finalists route present
import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const CRON_SECRET = process.env.CRON_SECRET;

// Exact Notion property names
const PROP = {
  dateSubmitted: "Date Submitted",
  archived: "Archived",
  status: "Status",
  topPick: "Top Pick",
} as const;

// Exact Status select option names
const STATUS = {
  safe: "SAFE Candidates",
  finalists: "This Week’s Finalists",
} as const;

function getSecret(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("secret") || req.headers.get("x-cron-secret");
}

function assertEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
  if (!CRON_SECRET) throw new Error("Missing CRON_SECRET");
}

// Monday -> Sunday (UTC) date-only strings for Notion
function getWeekRangeISO() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diffToMonday = (day === 0 ? -6 : 1) - day;

  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    startISO: monday.toISOString().slice(0, 10),
    endISO: sunday.toISOString().slice(0, 10),
  };
}

function getCheckboxProp(page: any, propName: string): boolean {
  const prop = page?.properties?.[propName];
  return prop?.type === "checkbox" ? Boolean(prop.checkbox) : false;
}

function getSelectProp(page: any, propName: string): string | null {
  const prop = page?.properties?.[propName];
  return prop?.type === "select" ? prop.select?.name ?? null : null;
}

function getDateProp(page: any, propName: string): string | null {
  const prop = page?.properties?.[propName];
  return prop?.type === "date" ? prop.date?.start ?? null : null;
}

async function updateStatus(pageId: string, statusName: string) {
  return notion.pages.update({
    page_id: pageId,
    properties: {
      [PROP.status]: { select: { name: statusName } },
    },
  } as any);
}

export async function GET(req: Request) {
  try {
    assertEnv();

    const provided = getSecret(req);
    if (!provided || provided !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(25, Number(url.searchParams.get("limit") || "5")));

    const { startISO, endISO } = getWeekRangeISO();

    const res = await notion.databases.query({
      database_id: DATABASE_ID!,
      filter: {
        and: [
          { property: PROP.archived, checkbox: { equals: false } },
          {
            property: PROP.dateSubmitted,
            date: { on_or_after: startISO, on_or_before: endISO },
          },
          {
            or: [
              { property: PROP.status, select: { equals: STATUS.safe } },
              { property: PROP.status, select: { equals: STATUS.finalists } },
              { property: PROP.topPick, checkbox: { equals: true } },
            ],
          },
        ],
      },
      sorts: [{ property: PROP.dateSubmitted, direction: "ascending" }],
      page_size: 100,
    } as any);

    const pages = res.results as any[];

    const normalized = pages.map((p) => ({
      id: p.id,
      topPick: getCheckboxProp(p, PROP.topPick),
      status: getSelectProp(p, PROP.status),
      date: getDateProp(p, PROP.dateSubmitted),
    }));

    const topPicks = normalized
      .filter((p) => p.topPick)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id));

    const safe = normalized
      .filter((p) => p.status === STATUS.safe && !p.topPick)
      .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id.localeCompare(b.id));

    const desiredIds: string[] = [];
    for (const p of topPicks) desiredIds.push(p.id);
    for (const p of safe) {
      if (desiredIds.length >= limit) break;
      desiredIds.push(p.id);
    }

    const desiredSet = new Set(desiredIds);

    const toPromote = normalized.filter((p) => desiredSet.has(p.id) && p.status !== STATUS.finalists);
    const toDemote = normalized.filter((p) => p.status === STATUS.finalists && !desiredSet.has(p.id) && !p.topPick);

    let promoted = 0;
    let demoted = 0;

    for (const p of toPromote) {
      await updateStatus(p.id, STATUS.finalists);
      promoted++;
    }

    for (const p of toDemote) {
      await updateStatus(p.id, STATUS.safe);
      demoted++;
    }

    return NextResponse.json({
      ok: true,
      mode: "weekly-finalists",
      week: { startISO, endISO },
      limit,
      promoted,
      demoted,
      totalFinalists: desiredIds.length,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ? String(err.message) : String(err) },
      { status: 500 }
    );
  }
}
