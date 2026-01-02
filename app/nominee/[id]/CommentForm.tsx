"use client";

import { useState } from "react";
import { createClient } from "../../../lib/supabase/browser";

export default function CommentForm({ nomineeId }: { nomineeId: string }) {
  const supabase = createClient();
  const [text, setText] = useState("");
  const [status, setStatus] = useState<string>("");

  const submit = async () => {
    setStatus("");

    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;

    if (!user) {
      setStatus("You must be logged in.");
      return;
    }

    const body = text.trim();
    if (!body) return;

    const { error } = await supabase.from("comments").insert({
      nominee_id: nomineeId,
      user_id: user.id,
      body,
    });

    if (error) {
      setStatus(error.message);
      return;
    }

    setText("");
    setStatus("Posted! Refresh to see it.");
  };

  return (
    <div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={500}
        style={{ width: "100%", padding: 8 }}
        placeholder="Write a comment (max 500 chars)…"
      />
      <button onClick={submit} style={{ marginTop: 8 }}>
        Post comment
      </button>
      {status ? <p style={{ marginTop: 8 }}>{status}</p> : null}
    </div>
  );
}
