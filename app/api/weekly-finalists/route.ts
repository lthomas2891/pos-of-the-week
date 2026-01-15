import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";
import type {
  QueryDatabaseParameters,
  UpdatePageParameters,
  PageObjectResponse,
  PartialPageObjectResponse,
} from "@notionhq/client/build/src/api-endpoints";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const CRON_SECRET = process.env.CRON_SECRET;

// Notion property names (must match exactly)
const PROP = {
  nominee: "Nominee",
  dateSubmitted: "Date Submitted",
  archived: "Archived",
  status: "Status",
  topPick: "Top Pick",
} as const;

// Status select names (must match exactly)
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

// Monday -> Sunday in UTC, using date-only strings for Notion filters
function getWeekRangeISO() {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sun
  const diffToMonday = (day === 0 ? -6 : 1) - day;

  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() + diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    startISO: monday.toISOString().slice(0, 10), // YYYY-MM-DD
    endISO: sunday.toISOString().slice(0, 10),   // YYYY-MM-DD
  };
}

function isFullPage(
  p: PageObjectResponse | PartialPageObjectResponse
): p is PageObjectResponse {
  return "properties" in p;
}

function getCheckbox(page: PageObjectResponse, propName: string): boolean {
  const prop = page.properties[propName];
  return prop?.type === "checkbox" ? Boolean(prop.checkbox) : false;
}

function getSelectName(page: PageObjectResponse, propName: string): string | null {
  const prop = page.properties[propName];
  return prop?.type === "select" ? prop.select?.name ?? null : null;
}

function getDateStart(page: PageObjectResponse, propName: string): string | null {
  const prop = page.properties[propName];
  return prop?.type === "date" ? prop.date?.start ?? null : null;
}

async function queryThisWeeksPages(): Promise<PageObjectResponse[]> {
  const { startISO, endISO } = getWeekRangeISO();

  const params: QueryDatabaseParameters = {
    database_id: DATABASE_ID!,
    filter: {
      and: [
        { property: PROP.archived, checkbox: { equals: false } },
        {
          or: [
            { property: PROP.status, select: { equals: STATUS.safe } },
            { property: PROP.status, select: { equals: STATUS.finalists } },
          ],
        },
        {
          property: PROP.dateSubmitted,
          date: {
            on_or_after: startISO,
            on_or_before: endISO,
          },
        },
      ],
    },
    sorts: [{ property: PROP.dateSubmitted, direction: "ascending" }],
    page_size: 100,
  };

  const res = await notion.databases.query(params);
  return res.results.filter(isFullPage);
}

async function updateStatus(pageId: string, status: string) {
  const params: UpdatePageParameters = {
    page_id: pageId,
    properties: {
      [PROP.status]: { select: { name: status } },
    },
  };
  return notion.pages.update(params);
}

export async function GET(req: Request) {
  try {
    assertEnv();

    const provided = getSecret(req);
    if (!provided || provided !== CRON_SECRET) {
      return Ne
