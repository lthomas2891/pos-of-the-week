"use client";

import { useState } from "react";

export default function NominateForm() {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<string>("");

  const submit = async () => {
  setStatus("");

  if (!title.trim()) {
    setStatus("Please add a title.");
    return;
  }

  const res = await fetch("/api/nominate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },

    // 👇 THIS is where `body:` lives
    body: JSON.stringify({
      nominee: title,
      reason: details,
      link: "",
    }),
  });

  if (!res.ok) {
    setStatus("Submission failed. Please try again.");
    return;
  }

  setTitle("");
  setDetails("");
  setStatus("Submitted for moderation!");
};

  return (
    <div style={{ marginTop: 16 }}>
      <label>
        <div style={{ fontWeight: 600 }}>Nomination title</div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Example: Reply-All Guy"
          style={{ width: "100%", padding: 8, marginTop: 6 }}
          maxLength={80}
        />
      </label>

      <label style={{ display: "block", marginTop: 12 }}>
        <div style={{ fontWeight: 600 }}>Details (optional)</div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder="Why are they the POS of the week?"
          style={{ width: "100%", padding: 8, marginTop: 6 }}
          rows={4}
          maxLength={500}
        />
      </label>

      <button onClick={submit} style={{ marginTop: 12 }}>
        Submit nomination
      </button>

      {status ? <p style={{ marginTop: 10 }}>{status}</p> : null}
    </div>
  );
}
