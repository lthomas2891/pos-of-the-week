export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    vercel_git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
    vercel_git_commit_message: process.env.VERCEL_GIT_COMMIT_MESSAGE || null,
    vercel_git_repo_slug: process.env.VERCEL_GIT_REPO_SLUG || null,
    vercel_git_commit_ref: process.env.VERCEL_GIT_COMMIT_REF || null,
  });
}
