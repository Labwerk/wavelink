import { expect, test } from "vitest";
import {
  parseIngestTokens,
  extractBearerToken,
  constantTimeEqual,
  authenticateIngestRequest,
} from "../backend/lib/ingestAuth";

test("parseIngestTokens splits sourceId from secret on the first dot", () => {
  const entries = parseIngestTokens("sim-1.s3cr3t,sim-2.other.secret");
  expect(entries).toEqual([
    { sourceId: "sim-1", token: "sim-1.s3cr3t" },
    { sourceId: "sim-2", token: "sim-2.other.secret" },
  ]);
});

test("parseIngestTokens drops malformed entries without throwing", () => {
  expect(parseIngestTokens("no-dot-here, ,.emptysource,onlysource.")).toEqual([]);
});

test("parseIngestTokens returns empty for undefined/empty env", () => {
  expect(parseIngestTokens(undefined)).toEqual([]);
  expect(parseIngestTokens("")).toEqual([]);
});

test("extractBearerToken reads the Bearer scheme case-insensitively", () => {
  expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  expect(extractBearerToken("bearer   abc123  ")).toBe("abc123");
});

test("extractBearerToken returns empty string for missing/malformed header", () => {
  expect(extractBearerToken(null)).toBe("");
  expect(extractBearerToken(undefined)).toBe("");
  expect(extractBearerToken("Basic abc123")).toBe("");
  expect(extractBearerToken("")).toBe("");
});

test("constantTimeEqual matches identical strings", () => {
  expect(constantTimeEqual("sim-1.s3cr3t", "sim-1.s3cr3t")).toBe(true);
});

test("constantTimeEqual rejects different strings, including differing lengths", () => {
  expect(constantTimeEqual("sim-1.s3cr3t", "sim-1.wrong")).toBe(false);
  expect(constantTimeEqual("short", "a-lot-longer-string")).toBe(false);
  expect(constantTimeEqual("", "")).toBe(true);
});

test("constantTimeEqual never short-circuits: compare count depends only on length, not mismatch position", () => {
  let earlyMismatchCount = 0;
  let lateMismatchCount = 0;
  let fullMatchCount = 0;

  constantTimeEqual("Xxxxxxxxxx", "Yxxxxxxxxx", () => earlyMismatchCount++);
  constantTimeEqual("xxxxxxxxxX", "xxxxxxxxxY", () => lateMismatchCount++);
  constantTimeEqual("xxxxxxxxxx", "xxxxxxxxxx", () => fullMatchCount++);

  expect(earlyMismatchCount).toBe(10);
  expect(lateMismatchCount).toBe(10);
  expect(fullMatchCount).toBe(10);
  expect(earlyMismatchCount).toBe(lateMismatchCount);
});

test("authenticateIngestRequest matches a configured token", () => {
  const result = authenticateIngestRequest("Bearer sim-1.s3cr3t", "sim-1.s3cr3t,sim-2.other");
  expect(result).toEqual({ sourceId: "sim-1" });
});

test("authenticateIngestRequest rejects a garbage credential", () => {
  const result = authenticateIngestRequest("Bearer garbage", "sim-1.s3cr3t");
  expect(result).toBeNull();
});

test("authenticateIngestRequest rejects a missing credential", () => {
  expect(authenticateIngestRequest(null, "sim-1.s3cr3t")).toBeNull();
  expect(authenticateIngestRequest(undefined, "sim-1.s3cr3t")).toBeNull();
});

test("authenticateIngestRequest always refuses when INGEST_TOKENS is unset or empty (R5)", () => {
  expect(authenticateIngestRequest("Bearer sim-1.s3cr3t", undefined)).toBeNull();
  expect(authenticateIngestRequest("Bearer sim-1.s3cr3t", "")).toBeNull();
  expect(authenticateIngestRequest("Bearer anything-at-all", "")).toBeNull();
});

test("authenticateIngestRequest: rotation overlap — two tokens sharing a sourceId both match (R6)", () => {
  const tokens = "sim-1.oldsecret,sim-1.newsecret";
  expect(authenticateIngestRequest("Bearer sim-1.oldsecret", tokens)).toEqual({
    sourceId: "sim-1",
  });
  expect(authenticateIngestRequest("Bearer sim-1.newsecret", tokens)).toEqual({
    sourceId: "sim-1",
  });
});

test("authenticateIngestRequest: retiring a token immediately stops it matching, with no gap for the other (R6)", () => {
  const beforeRotation = "sim-1.oldsecret,sim-1.newsecret";
  const afterRotation = "sim-1.newsecret";

  // Both work during the overlap window.
  expect(authenticateIngestRequest("Bearer sim-1.oldsecret", beforeRotation)).not.toBeNull();
  expect(authenticateIngestRequest("Bearer sim-1.newsecret", beforeRotation)).not.toBeNull();

  // After retiring the old value, only the new one works.
  expect(authenticateIngestRequest("Bearer sim-1.oldsecret", afterRotation)).toBeNull();
  expect(authenticateIngestRequest("Bearer sim-1.newsecret", afterRotation)).toEqual({
    sourceId: "sim-1",
  });
});

test("authenticateIngestRequest: two distinct sources are told apart (R23 dependency)", () => {
  const tokens = "src-a.secretA,src-b.secretB";
  expect(authenticateIngestRequest("Bearer src-a.secretA", tokens)).toEqual({
    sourceId: "src-a",
  });
  expect(authenticateIngestRequest("Bearer src-b.secretB", tokens)).toEqual({
    sourceId: "src-b",
  });
});

test("authenticateIngestRequest: a Convex Auth-shaped bearer value never matches an ingestion token (R3)", () => {
  // Simulates an end-user session JWT presented as a bearer credential —
  // it simply fails to match any configured ingestion token.
  const endUserJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature";
  expect(authenticateIngestRequest(`Bearer ${endUserJwt}`, "sim-1.s3cr3t")).toBeNull();
});
