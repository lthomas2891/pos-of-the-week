import { NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export const runtime = "nodejs";

const notion = new Client({ auth: process.env.NOTION_TOKEN });

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const VOTES_DATABASE_ID = process.env.NOTION_VOTES_DATABASE_ID;

const PROP = {
  // nominations DB props
  nominee: "Nominee",
  link: "Link",
  dateSubmitted: "Date Submitted",
  archived: "Archived",
  status: "Status",
  aiSummary: "AI Summary",
  aiRewritten: "AI Rewritten Version",
  topPick: "Top Pick",

  // votes DB props
  voteNomineeId: "NomineeId",
  voteWeekStart: "Week Start",
} as const;

const STATUS = {
  finalists: "This Week’s Finalists",
} as const;

function assertEnv() {
  if (!process.env.NOTION_TOKEN) throw new Error("Missing NOTION_TOKEN");
  if (!DATABASE_ID) throw new Error("Missing NOTION_DATABASE_ID");
  if (!VOTES_DATABASE_ID) throw new Error("Missing NOTION_VOTES_DATABASE_ID");
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
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error("No data_sources found on this database.");
  }
  const id = sources[0]?.id;
  if (!id) throw new Error("data_sources[0].id missing");
  return id;
}

function mapNomination(p: any) {
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

function getVoteNomineeId(votePage: any): string | null {
  const prop = votePage?.properties?.[PROP.voteNomineeId];
  if (prop?.type !== "rich_text") return null;
  const text = (prop.rich_text || []).map((t: any) => t.plain_text).join("");
  return text || null;
}

export async function GET() {
  try {
    assertEnv();

    const { startISO, endISO } = getWeekRangeISO();

    // 1) Pull this week's finalists (archived=false, status=finalists, in week window)
    const nominationsDS = await getPrimaryDataSourceId(DATABASE_ID!);

    const finalistsRes = await (notion as any).dataSources.query({
      data_source_id: nominationsDS,
      filter: {
        and: [
          { property: PROP.archived, checkbox: { equals: false } },
          { property: PROP.status, select: { equals: STATUS.finalists } },
          { property: PROP.dateSubmitted, date: { on_or_after: startISO, on_or_before: endISO } },
        ],
      },
      sorts: [{ property: PROP.dateSubmitted, direction: "ascending" }],
      page_size: 50,
    } as any);

    const finalistsPages = (finalistsRes.results || []) as any[];
    const finalists = finalistsPages.map(mapNomination);

    // 2) Pull votes for this week (Week Start == startISO)
    const votesDS = await getPrimaryDataSourceId(VOTES_DATABASE_ID!);

    const totalsByNomineeId: Record<string, number> = {};
    let totalVotes = 0;

    let cursor: string | undefined = undefined;
    for (let i = 0; i < 20; i++) {
     const votesRes: any = await (notion as any).dataSources.query({

        data_source_id: votesDS,
        filter: {
          and: [
            { property: PROP.voteWeekStart, date: { equals: startISO } },
          ],
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

    // 3) Determine leader among current finalists (by totals; tie-breaker Top Pick; then oldest dateSubmitted)
    let leaderNomineeId: string | null = null;
    let bestVotes = -1;

    for (const f of finalists) {
      const votes = totalsByNomineeId[f.id] || 0;

      if (votes > bestVotes) {
        bestVotes = votes;
        leaderNomineeId = f.id;
        continue;
      }

      if (votes === bestVotes && leaderNomineeId) {
        const currentLeader = finalists.find((x) => x.id === leaderNomineeId);
        if (!currentLeader) continue;

        // Tie-breaker #1: Top Pick wins ties
        if (!currentLeader.topPick && f.topPick) {
          leaderNomineeId = f.id;
          continue;
        }

        // Tie-breaker #2: earlier Date Submitted wins
        const a = currentLeader.dateSubmitted ?? "9999-12-31";
        const b = f.dateSubmitted ?? "9999-12-31";
        if (b < a) {
          leaderNomineeId = f.id;
          continue;
        }
      }
    }

    // 4) Still keep your manual Top Pick winner concept for "currentWinner" display.
    // If you want the UI to show totals-based leader as the winner, use `leaderNomineeId`.
    const currentWinner = leaderNomineeId
      ? finalists.find((f) => f.id === leaderNomineeId) || null
      : null;

    // 5) Past winners = Archived + Top Pick (same as before)
    const pastRes = await (notion as any).dataSources.query({
      data_source_id: nominationsDS,
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
    const pastWinners = pastPages.map(mapNomination);

    return NextResponse.json({
      ok: true,
      week: { startISO, endISO },
      finalists,
      totalsByNomineeId,
      totalVotes,
      leaderNomineeId,
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
