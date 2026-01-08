import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const body = await req.json();
  const { nominee, reason, link } = body;

  console.log("NOTION_TOKEN prefix:", process.env.NOTION_TOKEN?.slice(0, 4));

  if (!nominee) {
    return NextResponse.json({ error: "Missing nominee" }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const notionRes = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
     Authorization: `Bearer ${(process.env.NOTION_TOKEN || "").trim()}`,

      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify({
      parent: { database_id: (process.env.NOTION_DATABASE_ID || "").trim() },

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
        Status: {
  select: { name: "Needs AI Review" },
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
