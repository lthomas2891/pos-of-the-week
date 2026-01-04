import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const { nominee, reason, link } = body;

  if (!nominee) {
    return NextResponse.json({ error: "Missing nominee" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const notionRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        Nominee: {
          title: [{ text: { content: nominee } }],
        },
        Reason: {
          rich_text: [{ text: { content: reason || "" } }],
        },
        Link: link ? { url: link } : { url: null },
        "Date Submitted": {
          date: { start: today },
        },
      },
    }),
  });

  if (!notionRes.ok) {
  const err = await notionRes.text();
  return new NextResponse(err, { status: 500 });
}


  return NextResponse.json({ success: true });
}
