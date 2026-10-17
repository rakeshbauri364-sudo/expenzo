
async function googleLogin() {
  if (!configured || !sb) {
    message("authMsg", "Supabase सेटअप पूरा नहीं है।", true);
    return;
  }

  const button = $("googleLoginBtn");

  if (button) button.disabled = true;

  message("authMsg", "Google Login खोला जा रहा है…");

  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          "https://rakeshbauri364-sudo.github.io/expenzo/www/"
      }
    });

    if (error) throw error;
  } catch (error) {
    message(
      "authMsg",
      error.message || "Google Login शुरू नहीं हुआ।",
      true
    );

    if (button) button.disabled = false;
  }
}

$("googleLoginBtn")?.addEventListener("click", googleLogin);
