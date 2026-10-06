// Why a ScoutAI turn failed, in words the planner can act on. Every failure used to read "couldn't
// answer just now", which hid the common case: a past-performance analysis outrunning both of
// its attempts on a slow Gemini day.

export type ScoutFailure = "timeout" | "unreadable" | "unavailable";

export function classifyScoutError(err: unknown): ScoutFailure {
  const message = String((err as Error)?.message ?? err ?? "");
  if ((err as Error)?.name === "AbortError" || /timed out|timeout|aborted/i.test(message)) return "timeout";
  // The model answered, but not with the JSON the response schema asks for.
  if (err instanceof SyntaxError || /no output text|unexpected token|json/i.test(message)) return "unreadable";
  return "unavailable";
}

export function scoutFailureMessage(failure: ScoutFailure, analysis: boolean, limitMs?: number): string {
  if (failure === "timeout") {
    const minutes = limitMs ? Math.round((limitMs / 60000) * 2) / 2 : null;
    const allowed = minutes ? ` (two tries, about ${minutes} minutes in all)` : "";
    return analysis
      ? `This analysis took longer than ScoutAI allows${allowed}. Try again; past-performance analysis is the slowest thing ScoutAI does.`
      : `ScoutAI took too long to answer${allowed}. Try again.`;
  }
  if (failure === "unreadable") return "ScoutAI's answer came back incomplete. Try again.";
  return "ScoutAI couldn't reach the AI service just now. Try again in a moment.";
}
