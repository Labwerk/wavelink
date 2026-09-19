// Deny-by-default function builders (spec R3, R4).
//
// Every protected query/mutation/action is declared through one of these,
// each of which REQUIRES a `capability` (no default - omitting it is a type
// error, and an unknown name denies every caller at run time). The wrapper
// resolves the caller server-side, checks the capability, and hands the
// resolved `user` to the handler. Using the raw `query`/`mutation`/`action`
// builders for an exported function is only allowed for the entry points
// listed in `lib/publicEntryPoints.ts`; `tests/denyByDefault.test.ts` fails
// for anything else.

import { getAuthUserId } from "@convex-dev/auth/server";
import type {
  RegisteredAction,
  RegisteredMutation,
  RegisteredQuery,
} from "convex/server";
import type { ObjectType, PropertyValidators } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import {
  action,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { NOT_AUTHORIZED, requireCapability } from "./auth";
import type { Capability } from "./permissions";

export function authedQuery<Args extends PropertyValidators, Result>(def: {
  capability: Capability;
  args: Args;
  handler: (
    ctx: QueryCtx & { user: Doc<"users"> },
    args: ObjectType<Args>,
  ) => Promise<Result> | Result;
}): RegisteredQuery<"public", ObjectType<Args>, Promise<Result>> {
  return query({
    args: def.args,
    handler: async (ctx: QueryCtx, args: ObjectType<Args>) => {
      const user = await requireCapability(ctx, def.capability);
      return def.handler({ ...ctx, user }, args);
    },
  } as never) as never;
}

export function authedMutation<Args extends PropertyValidators, Result>(def: {
  capability: Capability;
  args: Args;
  handler: (
    ctx: MutationCtx & { user: Doc<"users"> },
    args: ObjectType<Args>,
  ) => Promise<Result> | Result;
}): RegisteredMutation<"public", ObjectType<Args>, Promise<Result>> {
  return mutation({
    args: def.args,
    handler: async (ctx: MutationCtx, args: ObjectType<Args>) => {
      const user = await requireCapability(ctx, def.capability);
      return def.handler({ ...ctx, user }, args);
    },
  } as never) as never;
}

export function authedAction<Args extends PropertyValidators, Result>(def: {
  capability: Capability;
  args: Args;
  handler: (
    ctx: ActionCtx & { user: Doc<"users"> },
    args: ObjectType<Args>,
  ) => Promise<Result>;
}): RegisteredAction<"public", ObjectType<Args>, Promise<Result>> {
  return action({
    args: def.args,
    handler: async (ctx: ActionCtx, args: ObjectType<Args>): Promise<Result> => {
      const userId = await getAuthUserId(ctx);
      if (userId === null) {
        throw new Error(NOT_AUTHORIZED);
      }
      // Actions have no database access: authorize through an internal query.
      const user: Doc<"users"> = await ctx.runQuery(internal.authz.authorize, {
        userId,
        capability: def.capability,
      });
      return def.handler({ ...ctx, user }, args);
    },
  } as never) as never;
}
