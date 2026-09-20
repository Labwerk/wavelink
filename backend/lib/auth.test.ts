import { describe, expect, test } from "vitest";
import { setupTest } from "../testUtils";
import { requireAuth } from "./auth";

describe("requireAuth", () => {
  test("throws when there is no authenticated identity", async () => {
    const t = setupTest();
    await expect(t.run((ctx) => requireAuth(ctx))).rejects.toThrow(/not authenticated/i);
  });

  test("resolves with the identity when one is present", async () => {
    const t = setupTest().withIdentity({ subject: "user-1" });
    const identity = await t.run((ctx) => requireAuth(ctx));
    expect(identity.subject).toBe("user-1");
  });
});
