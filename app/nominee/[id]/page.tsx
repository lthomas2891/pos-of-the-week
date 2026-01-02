import { createClient } from "../../../lib/supabase/server";
import CommentForm from "./CommentForm";

export default async function NomineePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: nominee, error: nomineeError } = await supabase
    .from("nominees")
    .select("id, title, summary")
    .eq("id", id)
    .single();

  if (nomineeError || !nominee) {
    return (
      <main style={{ padding: 24 }}>
        <p>Nominee not found.</p>
      </main>
    );
  }

  const { data: comments } = await supabase
    .from("comments")
    .select("id, body, created_at, user_id")
    .eq("nominee_id", id)
    .order("created_at", { ascending: false });

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  return (
    <main style={{ padding: 24 }}>
      <h1>{nominee.title}</h1>
      <p>{nominee.summary}</p>

      <hr style={{ margin: "24px 0" }} />

      <h2>Comments</h2>

      {user ? (
        <CommentForm nomineeId={id} />
      ) : (
        <p>You must be logged in to comment.</p>
      )}

      <div style={{ marginTop: 16 }}>
        {!comments?.length ? (
          <p>No comments yet.</p>
        ) : (
          comments.map((c) => (
            <div key={c.id} style={{ padding: 12, border: "1px solid #ddd", marginBottom: 10 }}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>
                {new Date(c.created_at).toLocaleString()}
              </div>
              <div>{c.body}</div>
            </div>
          ))
        )}
      </div>
    </main>
  );
}
