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

const STATUS = {
  finalists: "This Week’s Finalists",
} as const;

function assertEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
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

export async function GET(req: Request) {
  try {
    assertEnv();

    const url = new URL(req.url);
    const startISO = url.searchParams.get("startISO");
    const endISO = url.searchParams.get("endISO");

    if (!startISO || !endISO) {
      return NextResponse.json({ ok: false, error: "Missing startISO or endISO" }, { status: 400 });
    }

    const dataSourceId = await getPrimaryDataSourceId(DATABASE_ID!);

    const res = await (notion as any).dataSources.query({
      data_source_id: dataSourceId,
      filter: {
        and: [
          { property: PROP.archived, checkbox: { equals: true } },
          {
            property: PROP.dateSubmitted,
            date: { on_or_after: startISO, on_or_before: endISO },
          },
          // “Finalists” definition for archive: either it remained in finalists status OR it’s a Top Pick winner.
          {
            or: [
              { property: PROP.status, select: { equals: STATUS.finalists } },
              { property: PROP.topPick, checkbox: { equals: true } },
            ],
          },
        ],
      },
      sorts: [{ property: PROP.dateSubmitted, direction: "ascending" }],
      page_size: 100,
    } as any);

    const pages = (res.results || []) as any[];

    const items = pages.map((p) => ({
      id: p.id,
      nominee: getTitle(p, PROP.nominee),
      summary: getRichText(p, PROP.aiSummary),
      voteCopy: getRichText(p, PROP.aiRewritten),
      link: getUrl(p, PROP.link),
      topPick: getCheckbox(p, PROP.topPick),
      dateSubmitted: getDateStart(p, PROP.dateSubmitted),
    }));

    return NextResponse.json({ ok: true, startISO, endISO, count: items.length, items });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ? String(err.message) : String(err) },
      { status: 500 }
    );
  }
}
