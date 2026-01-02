"use client";

import { createClient } from "../../lib/supabase/browser";

export default function GoogleSignInButton() {
  const supabase = createClient();

  const signInWithGoogle = async () => {
    const redirectTo = "http://localhost:3000/auth/callback?next=/";
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) console.error(error);
  };

  return <button onClick={signInWithGoogle}>Sign in with Google</button>;
}
