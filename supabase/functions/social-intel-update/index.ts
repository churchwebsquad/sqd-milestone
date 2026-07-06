// social-intel-update — Supabase Edge Function
//
// Takes an existing social intel profile + a plain-English description of
// what changed, sends both to Claude, and returns the surgically-updated
// profile JSON with only the relevant fields modified.
//
// Secrets required:
//   ANTHROPIC_API_KEY
// Built-in:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { memberId, updateDescription, currentProfile } = await req.json() as {
      memberId: number;
      updateDescription: string;
      currentProfile: Record<string, unknown>;
    };

    if (!memberId || !updateDescription?.trim() || !currentProfile) {
      return json({ error: "Missing memberId, updateDescription, or currentProfile" }, 400);
    }

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const churchName =
      (currentProfile?.church_overview as Record<string, unknown>)?.church_name as string ??
      `Member ${memberId}`;

    const prompt = `You are an expert social media strategist updating a church intel profile.

Church: ${churchName} (Partner ID: ${memberId})

CURRENT PROFILE JSON:
${JSON.stringify(currentProfile, null, 2)}

CHANGE DESCRIPTION:
"${updateDescription.trim()}"

Your task:
- Read the change description carefully
- Update ONLY the fields in the profile that are directly affected by what's described
- Leave every other field completely unchanged — do not rephrase, improve, or touch anything not mentioned
- If the change mentions new brand colors, update design_notes.primary_colors and/or accent_colors
- If it mentions new fonts, update design_notes.font_suggestions
- If it mentions a new pastor, update church_overview.pastor_name and any references in brand_voice or team_tips
- If it mentions a new series, update whats_happening_now.current_series and related fields
- If it mentions a rebrand or new brand guide, update the relevant design_notes fields
- Add an entry to change_log recording today's date and what changed
- Today's date: ${new Date().toISOString().slice(0, 10)}

Return ONLY the complete updated profile as valid JSON. No explanation, no markdown code fences, just the raw JSON object starting with {.`;

    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 8096,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("[social-intel-update] Anthropic error:", text.slice(0, 300));
      return json({ error: `AI request failed (HTTP ${res.status})` }, 502);
    }

    const data = await res.json() as { content?: { text?: string }[] };
    const rawText = data.content?.[0]?.text ?? "";

    // Strip markdown code fences if Claude wrapped them
    const cleaned = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    let updatedProfile: Record<string, unknown>;
    try {
      updatedProfile = JSON.parse(cleaned);
    } catch {
      console.error("[social-intel-update] JSON parse failed. Raw:", rawText.slice(0, 500));
      return json({ error: "Failed to parse AI response as JSON. Try again." }, 500);
    }

    return json({ profile: updatedProfile });
  } catch (err) {
    console.error("[social-intel-update] error:", err);
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message.slice(0, 400) }, 500);
  }
});
