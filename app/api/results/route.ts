import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

const PROP = {
  nominee: "Nominee",
  link: "Link",
  dateSubmitted: "Date Submitted",
  archived: "Archived",
  status: "Status",
  aiSummary: "AI Summary",
  aiRewritten: "AI Rewritten Version",
  topPick: "Top Pick",
} as const;

function assertEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
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

function getTitle(page: any, propName: string): string {
  const prop = page?.properties?.[propName];
  if (prop?.type !== "title") return "";
  return (prop.title || []).map((t: any) => t.plain_text).join("") || "";
}

function getRichText(page: any, propName: string): string {
  const prop = page?.properties?.[propName];
  if (prop?.type !== "rich_text") return "";
  return (prop.rich_text || []).map((t: any) => t.plain_text).join("") || "";
}

function getUrl(page: any, propName: string): string | null {
  const prop = page?.properties?.[propName];
  if (prop?.type !== "url") return null;
  return prop.url ?? null;
}

function getCheckbox(page: any, propName: string): boolean {
  const prop = page?.properties?.[propName];
  if (prop?.type !== "checkbox") return false;
  return Boolean(prop.checkbox);
}

function getDateStart(page: any, propName: string): string | null {
  const prop = page?.properties?.[propName];
  if (prop?.type !== "date") return null;
  return prop.date?.start ?? null;
}

async function getPrimaryDataSourceId(databaseId: string): Promise<string> {
  const db: any = await notion.databases.retrieve({ database_id: databaseId } as any);
  const sources = db?.data_sources;
  if (!Array.isArray(sources) || sources.length === 0) throw new Error("No data_sources found on this database.");
  const id = sources[0]?.id;
  if (!id) throw new Error("data_sources[0].id missing");
  return id;
}

function mapItem(p: any) {
  return {
    id: p.id,
    nominee: getTitle(p, PROP.nominee),
    summary: getRichText(p, PROP.aiSummary),
    voteCopy: getRichText(p, PROP.aiRewritten),
    link: getUrl(p, PROP.link),
    topPick: getCheckbox(p, PROP.topPick),
    archived: getCheckbox(p, PROP.archived),
    dateSubmitted: getDateStart(p, PROP.dateSubmitted),
  };
}

export async function GET() {
  try {
    assertEnv();

    const { startISO, endISO } = getWeekRangeISO();
    const dataSourceId = await getPrimaryDataSourceId(DATABASE_ID!);

    // This week winner = Top Pick within week range (not archived)
    const currentRes = await (notion as any).dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [
          { property: PROP.archived, checkbox: { equals: false } },
          { property: PROP.topPick, checkbox: { equals: true } },
          { property: PROP.dateSubmitted, date: { on_or_after: startISO, on_or_before: endISO } },
        ],
      },
      sorts: [{ property: PROP.dateSubmitted, direction: "ascending" }],
      page_size: 10,
    } as any);

    const currentPages = (currentRes.results || []) as any[];
    const currentWinner = currentPages.length ? mapItem(currentPages[0]) : null;

    // Past winners = Archived + Top Pick (latest first)
    const pastRes = await (notion as any).dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [
          { property: PROP.archived, checkbox: { equals: true } },
          { property: PROP.topPick, checkbox: { equals: true } },
        ],
      },
      sorts: [{ property: PROP.dateSubmitted, direction: "descending" }],
      page_size: 50,
    } as any);

    const pastPages = (pastRes.results || []) as any[];
    const pastWinners = pastPages.map(mapItem);

    return NextResponse.json({
      ok: true,
      week: { startISO, endISO },
      currentWinner,
      pastWinners,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ? String(err.message) : String(err) },
      { status: 500 }
    );
  }
}
