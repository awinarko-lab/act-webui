import { NextResponse } from "next/server";

import { InvalidInvocationError, PreFlightError } from "@/lib/runner/types";

/**
 * Map a thrown supervisor error to an API response. Centralized so the create
 * and re-run paths stay byte-identical:
 *  - {@link InvalidInvocationError} → 400 `{error}`
 *  - {@link PreFlightError} → 503 `{error, environment}` (surfaces the detected
 *    environment so the UI can render a startup banner; R24/R25)
 *  - anything else → 500 `{error: "internal error"}`
 */
export function mapSupervisorError(e: unknown): NextResponse {
  if (e instanceof InvalidInvocationError) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  if (e instanceof PreFlightError) {
    return NextResponse.json(
      { error: e.message, environment: e.details },
      { status: 503 },
    );
  }
  return NextResponse.json({ error: "internal error" }, { status: 500 });
}
