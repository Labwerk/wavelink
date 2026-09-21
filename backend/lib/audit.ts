// Attribution (spec R11/R29/R30): every state-changing operation appends an
// `auditLog` row from inside the same mutation that makes the change, so the
// change and its record commit or roll back together — Convex mutations are
// atomic, so a change that throws during validation leaves no trace, and a
// change that succeeds always has exactly one entry (R30). `actorId` always
// comes from the authenticated caller - never from arguments - and `at` from
// the server clock. The one exception is a break-glass operation run with
// the deployment admin key, which has no user: `actorId` is then omitted and
// `details.via` says so.
//
// `details` carries simple key/value context (e.g. a role change's from/to).
// `changes` carries a structured per-field before/after diff, for an edit
// that can touch several fields in one call (e.g. a device edit) — built via
// `diffFields` below.

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type FieldChange = { field: string; before?: string; after?: string };

const MAX_VALUE_LENGTH = 512;

function stringifyForAudit(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return s.length > MAX_VALUE_LENGTH ? s.slice(0, MAX_VALUE_LENGTH) : s;
}

/** Sorts object keys recursively so equality checks aren't sensitive to insertion order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

/** Compares `fields` between `before`/`after`, returning only those that actually changed. */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const field of fields) {
    const b = before[field];
    const a = after[field];
    if (JSON.stringify(canonicalize(b)) !== JSON.stringify(canonicalize(a))) {
      changes.push({ field, before: stringifyForAudit(b), after: stringifyForAudit(a) });
    }
  }
  return changes;
}

export async function recordAudit(
  ctx: MutationCtx,
  entry: {
    actorId?: Id<"users">;
    action: string;
    targetTable?: string;
    targetId?: string;
    details?: Record<string, string>;
    changes?: FieldChange[];
  },
): Promise<void> {
  await ctx.db.insert("auditLog", { ...entry, at: Date.now() });
}
