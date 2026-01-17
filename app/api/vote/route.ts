import { NextResponse } from "next/server";

export const runtime = "nodejs";

const COOKIE_PREFIX = "weeklypos_vote_";

function weekCookieName(weekStartISO: string) {
  return `${COOKIE_PREFIX}${weekStartISO}`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const weekStartISO = body?.weekStartISO;
    const nomineeId = body?.nomineeId;

    if (typeof weekStartISO !== "string" || typeof nomineeId !== "string") {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    // Read cookie from request header (no next/headers needed)
    const cookieHeader = req.headers.get("cookie") || "";
    const name = weekCookieName(weekStartISO);

    const already = cookieHeader
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`));

    if (already) {
      return NextResponse.json({ ok: false, error: "Already voted" }, { status: 409 });
    }

    const res = NextResponse.json({ ok: true });

    // Cookie is the server-side “backup”; localStorage is the UI source of truth.
    res.cookies.set({
      name,
      value: nomineeId,
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 14, // 14 days
      secure: true,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ? String(err.message) : String(err) },
      { status: 500 }
    );
  }
}
