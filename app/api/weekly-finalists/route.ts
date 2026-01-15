import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

/**
 * Weekly Finalists Automation (Notion-only)
 *
 * Protects with:
 *  - ?secret=CRON_SECRET
 *  - OR x-cron-secret header
 *
 * Logic (this week):
 *  - Always include Top Pick = true
 *  - Fill remaining slots from SAFE Candidates (oldest first)
 *  - Promote chosen to "This Week’s Finalists"
 *  - If more finalists than allowed, demote extras back to "SAFE Candidates" (Top Picks never demoted)
 *
 * Query params:
 *  - limit (optional): number of finalists (default 5)
 *  - tz (optional): IANA timezone string for week boundaries (default "UTC")
 *      e.g. tz=America/Indiana/Indianapolis
 */

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID!;
const CRON_SECRET = process.env.CRON_SECRET!;

// Your existing Notion field names (must match exactly)
const PROP = {
  nominee: "Nominee",
  reason: "Reason",
  link: "Link",
  dateSubmitted: "Date Submitted",
  archived: "Archived",
  status: "Status",
  topPick: "Top Pick",
};

// Your existing Status select option names (must match exactly)
const STATUS = {
  safe: "SAFE Candidates",
  finalists: "This Week’s Finalists",
};

function getSecretFromRequest(req: Request) {
  const url = new URL(req.url);
  return url.searchParams.get("secret") || req.headers.get("x-cron-secret");
}

function assertEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!process.env.NOTION_DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
  if (!process.env.CRON_SECRET) throw new Error("Missing CRON_SECRET");
}

/**
 * Compute start/end of the current week.
 * Default week: Monday 00:00:00 through Sunday 23:59:59.999
 * Uses Intl.DateTimeFormat to respect a given timezone without extra deps.
 */
function getWeekRangeISO(tz: string) {
  const now = new Date();

  // Convert "now" into date parts in target tz
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value;

  const year = Number(get("year"));
  const month = Number(get("month")); // 1-12
  const day = Number(get("day"));
  const weekday = get("weekday"); // e.g. Mon, Tue...

  // Map weekday to index where Monday = 0 ... Sunday = 6
  const weekdayIndexMap: Record<string, number> = {
    Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6,
  };
  const weekdayIndex = weekdayIndexMap[weekday ?? "Mon"] ?? 0;

  // Build a Date that represents "today 00:00:00" in tz, but as a UTC Date.
  // Trick: create a UTC date from the tz's date parts; it's not the same instant as tz midnight,
  // but we only need consistent ISO boundaries for Notion date filtering. Using date-only ISO works best.
  const todayDateOnly = new Date(Date.UTC(year, month - 1, day));

  const weekStart = new Date(todayDateOnly);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekdayIndex); // Monday

  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6); // Sunday

  // Notion date filters work well with date-only strings.
  const startISO = weekStart.toISOString().slice(0, 10); // YYYY-MM-DD
  const endISO = weekEnd.toISOString().slice(0, 10);     // YYYY-MM-DD

  return { startISO, endISO };
}

function getPlainTextTitle(prop: any): string {
  try {
    const title = prop?.title?.[0]?.plain_text;
    return title || "";
  } catch {
    return "";
  }
}

function getDate(prop: any): string | null {
  return prop?.date?.start ?? null;
}

function getCheckbox(prop: any): boolean {
  return Boolean(prop?.checkbox);
}

function getSelectName(prop: any): string | null {
  return prop?.select?.name ?? null;
}

async function queryThisWeekPages(tz: string) {
  const { startISO, endISO } = getWeekRangeISO(tz);

  // Fetch pages that are:
  // - Archived = false
  // - Date Submitted within this week
  // - Status in { SAFE Candidates, This Week’s Finalists } OR Top Pick true
  //
  // We do it in two queries to keep filters simple/reliable:
  //   A) SAFE candidates + finalists in week
  //   B) Top Pick in week (any status) to guarantee manual overrides are included

  const baseWeekFilter = {
    and: [
      { property: PROP.archived, checkbox: { equals: false } },
      { property: PROP.dateSubmitted, date: { on_or_after: startISO } },
      { property: PROP.dateSubmitted, date: { on_or_before: endISO } },
    ],
  };

  const [a, b] = await Promise.all([
    notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          baseWeekFilter,
          {
            or: [
              { property: PROP.status, select: { equals: STATUS.safe } },
              { property: PROP.status, select: { equals: STATUS.finalists } },
            ],
          },
        ],
      } as any,
      sorts: [
        { property: PROP.dateSubmitted, direction: "ascending" },
      ],
      page_size: 100,
    }),
    notion.databases.query({
      database_id: DATABASE_ID,
      filter: {
        and: [
          baseWeekFilter,
          { property: PROP.topPick, checkbox: { equals: true } },
        ],
      } as any,
      page_size: 100,
    }),
  ]);

  // Merge unique pages by id
  const map = new Map<string, any>();
  for (const p of a.results) map.set(p.id, p);
  for (const p of b.results) map.set(p.id, p);

  return {
    startISO,
    endISO,
    pages: Array.from(map.values()),
  };
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

    const provided = getSecretFromRequest(req);
    if (!provided || provided !== CRON_SECRET) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(25, Number(url.searchParams.get("limit") || "5")));
    const tz = url.searchParams.get("tz") || "UTC";

    const { startISO, endISO, pages } = await queryThisWeekPages(tz);

    // Normalize page data
    const normalized = pages.map((p: any) => {
      const props = p.properties || {};
      return {
        id: p.id,
        nominee: getPlainTextTitle(props[PROP.nominee]),
        date: getDate(props[PROP.dateSubmitted]),
        topPick: getCheckbox(props[PROP.topPick]),
        status: getSelectName(props[PROP.status]),
      };
    });

    // Partition
    const topPicks = normalized
      .filter((p) => p.topPick)
      // deterministic ordering for top picks
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));

    const safeCandidates = normalized
      .filter((p) => p.status === STATUS.safe && !p.topPick)
      .sort((a, b) => (a.date || "").localeCompare(b.date || "") || a.id.localeCompare(b.id));

    const existingFinalists = normalized
      .filter((p) => p.status === STATUS.finalists);

    // Build desired finalists
    const desired: string[] = [];
    for (const p of topPicks) desired.push(p.id);

    for (const p of safeCandidates) {
      if (desired.length >= limit) break;
      desired.push(p.id);
    }

    const desiredSet = new Set(desired);

    // Promote: any desired that is not already finalists
    const toPromote = normalized.filter(
      (p) => desiredSet.has(p.id) && p.status !== STATUS.finalists
    );

    // Demote: any existing finalists this week not in desired, but never demote Top Pick
    const toDemote = normalized.filter(
      (p) => p.status === STATUS.finalists && !desiredSet.has(p.id) && !p.topPick
    );

    // Writeback (small batches; hobby plan friendly)
    const promoted: string[] = [];
    const demoted: string[] = [];
    const errors: Array<{ id: string; action: string; error: string }> = [];

    for (const p of toPromote) {
      try {
        await updateStatus(p.id, STATUS.finalists);
        promoted.push(p.id);
      } catch (e: any) {
        errors.push({ id: p.id, action: "promote", error: String(e?.message || e) });
      }
    }

    for (const p of toDemote) {
      try {
        await updateStatus(p.id, STATUS.safe);
        demoted.push(p.id);
      } catch (e: any) {
        errors.push({ id: p.id, action: "demote", error: String(e?.message || e) });
      }
    }

    const finalists = normalized.filter((p) => desiredSet.has(p.id)).map((p) => ({
      id: p.id,
      nominee: p.nominee,
      date: p.date,
      topPick: p.topPick,
      status: p.status,
    }));

    return NextResponse.json({
      ok: true,
      mode: "weekly-finalists",
      tz,
      week: { startISO, endISO },
      limit,
      counts: {
        foundThisWeek: normalized.length,
        topPicks: topPicks.length,
        safeCandidates: safeCandidates.length,
        existingFinalists: existingFinalists.length,
      },
      actions: {
        promoted: promoted.length,
        demoted: demoted.length,
        errors: errors.length,
      },
      finalists,
      errorDetails: errors.length ? errors : undefined,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}
