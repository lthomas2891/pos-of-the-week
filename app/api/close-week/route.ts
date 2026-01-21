import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const VOTES_DATABASE_ID = process.env.NOTION_VOTES_DATABASE_ID;
const CRON_SECRET = process.env.CRON_SECRET;

const PROP = {
  // nominations DB props
  archived: "Archived",
  status: "Status",
  dateSubmitted: "Date Submitted",
  topPick: "Top Pick",

  // votes DB props
  voteNomineeId: "NomineeId",
  voteWeekStart: "Week Start",
} as const;

const STATUS = {
  finalists: "This Week’s Finalists",
} as const;

function getSecret(req: Request): string | null {
  const url = new URL(req.url);
  return url.searchParams.get("secret") || req.headers.get("x-cron-secret");
}

function assertEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
  if (!VOTES_DATABASE_ID) throw new Error("Missing NOTION_VOTES_DATABASE_ID");
  if (!CRON_SECRET) throw new Error("Missing CRON_SECRET");
}

function getLastWeekRangeISO() {
  // Last week = previous Monday 00:00 UTC → Sunday 23:59:59 UTC (date-only strings)
  const now = new Date();

  const day = now.getUTCDay(); // 0=Sun
  const diffToMonday = (day === 0 ? -6 : 1) - day;

  const thisMonday = new Date(now);
  thisMonday.setUTCDate(now.getUTCDate() + diffToMonday);
  thisMonday.setUTCHours(0, 0, 0, 0);

  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);
  lastMonday.setUTCHours(0, 0, 0, 0);

  const lastSunday = new Date(lastMonday);
  lastSunday.setUTCDate(lastMonday.getUTCDate() + 6);
  lastSunday.setUTCHours(23, 59, 59, 999);

  return {
    startISO: lastMonday.toISOString().slice(0, 10), // week start key for votes
    endISO: lastSunday.toISOString().slice(0, 10),
  };
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

function getVoteNomineeId(votePage: any): string | null {
  const prop = votePage?.properties?.[PROP.voteNomineeId];
  if (prop?.type !== "rich_text") return null;
  const text = (prop.rich_text || []).map((t: any) => t.plain_text).join("");
  return text || null;
}

async function setArchived(pageId: string) {
  return notion.pages.update({
    page_id: pageId,
    properties: {
      [PROP.archived]: { checkbox: true },
    },
  } as any);
}

async function setTopPick(pageId: string, value: boolean) {
  return notion.pages.update({
    page_id: pageId,
    properties: {
      [PROP.topPick]: { checkbox: value },
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

    const { startISO, endISO } = getLastWeekRangeISO();

    // 1) Fetch last week's finalists (include both archived true/false so it's idempotent)
    const nominationsDS = await getPrimaryDataSourceId(DATABASE_ID!);

    const finalistsRes: any = await (notion as any).dataSources.query({
      data_source_id: nominationsDS,
      filter: {
        and: [
          { property: PROP.status, select: { equals: STATUS.finalists } },
          { property: PROP.dateSubmitted, date: { on_or_after: startISO, on_or_before: endISO } },
        ],
      },
      sorts: [{ property: PROP.dateSubmitted, direction: "ascending" }],
      page_size: 100,
    } as any);

    const pages = (finalistsRes.results || []) as any[];

    if (!pages.length) {
      return NextResponse.json({
        ok: true,
        mode: "close-week",
        lastWeek: { startISO, endISO },
        message: "No finalists found for last week. Nothing to close.",
        winner: null,
        archivedUpdated: 0,
        topPickSet: 0,
        topPickCleared: 0,
      });
    }

    const normalized = pages.map((p) => ({
      id: p.id,
      topPick: getCheckbox(p, PROP.topPick),
      archived: getCheckbox(p, PROP.archived),
      date: getDateStart(p, PROP.dateSubmitted) ?? "9999-12-31",
    }));

    const existingTopPicks = normalized.filter((p) => p.topPick);

    // 2) Determine winner
    let winnerId: string | null = null;
    let winnerReason: "manual-top-pick" | "vote-totals" | "fallback-earliest" = "fallback-earliest";

    if (existingTopPicks.length === 1) {
      // Manual override honored
      winnerId = existingTopPicks[0].id;
      winnerReason = "manual-top-pick";
    } else {
      // Compute vote totals for last week's startISO (Week Start = Monday date)
      const votesDS = await getPrimaryDataSourceId(VOTES_DATABASE_ID!);

      const totalsByNomineeId: Record<string, number> = {};
      let totalVotes = 0;

      let cursor: string | undefined = undefined;

      for (let i = 0; i < 20; i++) {
        const votesRes: any = await (notion as any).dataSources.query({
          data_source_id: votesDS,
          filter: {
            and: [{ property: PROP.voteWeekStart, date: { equals: startISO } }],
          },
          page_size: 100,
          start_cursor: cursor,
        } as any);

        const votes = (votesRes.results || []) as any[];

        for (const v of votes) {
          const nomineeId = getVoteNomineeId(v);
          if (!nomineeId) continue;
          totalsByNomineeId[nomineeId] = (totalsByNomineeId[nomineeId] || 0) + 1;
          totalVotes++;
        }

        if (!votesRes.has_more || !votesRes.next_cursor) break;
        cursor = votesRes.next_cursor;
      }

      // Pick highest votes among last week's finalists. Tie-breaker: earliest dateSubmitted.
      let bestVotes = -1;

      for (const p of normalized) {
        const votes = totalsByNomineeId[p.id] || 0;

        if (votes > bestVotes) {
          bestVotes = votes;
          winnerId = p.id;
          winnerReason = "vote-totals";
          continue;
        }

        if (votes === bestVotes && winnerId) {
          const cur = normalized.find((x) => x.id === winnerId);
          if (!cur) continue;
          if (p.date < cur.date) {
            winnerId = p.id;
            winnerReason = "vote-totals";
          }
        }
      }

      // If literally no votes at all, we still pick earliest (already sorted)
      if (totalVotes === 0) {
        winnerId = normalized.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))[0].id;
        winnerReason = "fallback-earliest";
      }
    }

    // 3) Writebacks (idempotent and minimal)
    // - Ensure winner Top Pick true
    // - Clear Top Pick from other last-week finalists (ONLY within this last week set)
    // - Archive all last-week finalists
    let topPickSet = 0;
    let topPickCleared = 0;
    let archivedUpdated = 0;

    // Set winner Top Pick true if needed
    if (winnerId) {
      const winnerRow = normalized.find((p) => p.id === winnerId);
      if (winnerRow && !winnerRow.topPick) {
        await setTopPick(winnerId, true);
        topPickSet++;
      }
    }

    // Clear Top Pick from others in last week (prevents multiple winners)
    for (const p of normalized) {
      if (winnerId && p.id === winnerId) continue;
      if (p.topPick) {
        await setTopPick(p.id, false);
        topPickCleared++;
      }
    }

    // Archive all
    for (const p of normalized) {
      if (!p.archived) {
        await setArchived(p.id);
        archivedUpdated++;
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "close-week",
      lastWeek: { startISO, endISO },
      winner: { id: winnerId, reason: winnerReason },
      finalistsCount: normalized.length,
      topPickSet,
      topPickCleared,
      archivedUpdated,
      note: "Winners keep Top Pick = true. This endpoint never touches other weeks.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ? String(err.message) : String(err) },
      { status: 500 }
    );
  }
}
