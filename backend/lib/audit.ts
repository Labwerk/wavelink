// Attribution (spec R11): every state-changing operation appends an
// `auditLog` row from inside the same mutation that makes the change, so the
// change and its record commit or roll back together. `actorId` always comes
// from the authenticated caller - never from arguments - and `at` from the
// server clock. The one exception is a break-glass operation run with the
// deployment admin key, which has no user: `actorId` is then omitted and
// `details.via` says so.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function recordAudit(
  ctx: MutationCtx,
  entry: {
    actorId?: Id<"users">;
    action: string;
    targetTable?: string;
    targetId?: string;
    details?: Record<string, string>;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
