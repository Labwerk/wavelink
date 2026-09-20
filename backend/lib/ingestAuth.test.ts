import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIngestTokens,
  extractBearerToken,
  constantTimeEqual,
  authenticateIngestRequest,
} from "./ingestAuth.ts";

test("parseIngestTokens splits sourceId from secret on the first dot", () => {
  const entries = parseIngestTokens("sim-1.s3cr3t,sim-2.other.secret");
  assert.deepEqual(entries, [
    { sourceId: "sim-1", token: "sim-1.s3cr3t" },
    { sourceId: "sim-2", token: "sim-2.other.secret" },
  ]);
});

test("parseIngestTokens drops malformed entries without throwing", () => {
  assert.deepEqual(parseIngestTokens("no-dot-here, ,.emptysource,onlysource."), []);
});

test("parseIngestTokens returns empty for undefined/empty env", () => {
  assert.deepEqual(parseIngestTokens(undefined), []);
  assert.deepEqual(parseIngestTokens(""), []);
});

test("extractBearerToken reads the Bearer scheme case-insensitively", () => {
  assert.equal(extractBearerToken("Bearer abc123"), "abc123");
  assert.equal(extractBearerToken("bearer   abc123  "), "abc123");
});

test("extractBearerToken returns empty string for missing/malformed header", () => {
  assert.equal(extractBearerToken(null), "");
  assert.equal(extractBearerToken(undefined), "");
  assert.equal(extractBearerToken("Basic abc123"), "");
  assert.equal(extractBearerToken(""), "");
});

test("constantTimeEqual matches identical strings", () => {
  assert.equal(constantTimeEqual("sim-1.s3cr3t", "sim-1.s3cr3t"), true);
});

test("constantTimeEqual rejects different strings, including differing lengths", () => {
  assert.equal(constantTimeEqual("sim-1.s3cr3t", "sim-1.wrong"), false);
  assert.equal(constantTimeEqual("short", "a-lot-longer-string"), false);
  assert.equal(constantTimeEqual("", ""), true);
});

test("constantTimeEqual never short-circuits: compare count depends only on length, not mismatch position", () => {
  let earlyMismatchCount = 0;
  let lateMismatchCount = 0;
  let fullMatchCount = 0;

  constantTimeEqual("Xxxxxxxxxx", "Yxxxxxxxxx", () => earlyMismatchCount++);
  constantTimeEqual("xxxxxxxxxX", "xxxxxxxxxY", () => lateMismatchCount++);
  constantTimeEqual("xxxxxxxxxx", "xxxxxxxxxx", () => fullMatchCount++);

  assert.equal(earlyMismatchCount, 10);
  assert.equal(lateMismatchCount, 10);
  assert.equal(fullMatchCount, 10);
  assert.equal(earlyMismatchCount, lateMismatchCount);
});

test("authenticateIngestRequest matches a configured token", () => {
  const result = authenticateIngestRequest("Bearer sim-1.s3cr3t", "sim-1.s3cr3t,sim-2.other");
  assert.deepEqual(result, { sourceId: "sim-1" });
});

test("authenticateIngestRequest rejects a garbage credential", () => {
  const result = authenticateIngestRequest("Bearer garbage", "sim-1.s3cr3t");
  assert.equal(result, null);
});

test("authenticateIngestRequest rejects a missing credential", () => {
  assert.equal(authenticateIngestRequest(null, "sim-1.s3cr3t"), null);
  assert.equal(authenticateIngestRequest(undefined, "sim-1.s3cr3t"), null);
});

test("authenticateIngestRequest always refuses when INGEST_TOKENS is unset or empty (R5)", () => {
  assert.equal(authenticateIngestRequest("Bearer sim-1.s3cr3t", undefined), null);
  assert.equal(authenticateIngestRequest("Bearer sim-1.s3cr3t", ""), null);
  assert.equal(authenticateIngestRequest("Bearer anything-at-all", ""), null);
});

test("authenticateIngestRequest: rotation overlap — two tokens sharing a sourceId both match (R6)", () => {
  const tokens = "sim-1.oldsecret,sim-1.newsecret";
  assert.deepEqual(authenticateIngestRequest("Bearer sim-1.oldsecret", tokens), {
    sourceId: "sim-1",
  });
  assert.deepEqual(authenticateIngestRequest("Bearer sim-1.newsecret", tokens), {
    sourceId: "sim-1",
  });
});

test("authenticateIngestRequest: retiring a token immediately stops it matching, with no gap for the other (R6)", () => {
  const beforeRotation = "sim-1.oldsecret,sim-1.newsecret";
  const afterRotation = "sim-1.newsecret";

  // Both work during the overlap window.
  assert.notEqual(authenticateIngestRequest("Bearer sim-1.oldsecret", beforeRotation), null);
  assert.notEqual(authenticateIngestRequest("Bearer sim-1.newsecret", beforeRotation), null);

  // After retiring the old value, only the new one works.
  assert.equal(authenticateIngestRequest("Bearer sim-1.oldsecret", afterRotation), null);
  assert.deepEqual(authenticateIngestRequest("Bearer sim-1.newsecret", afterRotation), {
    sourceId: "sim-1",
  });
});

test("authenticateIngestRequest: two distinct sources are told apart (R23 dependency)", () => {
  const tokens = "src-a.secretA,src-b.secretB";
  assert.deepEqual(authenticateIngestRequest("Bearer src-a.secretA", tokens), {
    sourceId: "src-a",
  });
  assert.deepEqual(authenticateIngestRequest("Bearer src-b.secretB", tokens), {
    sourceId: "src-b",
  });
});

test("authenticateIngestRequest: a Convex Auth-shaped bearer value never matches an ingestion token (R3)", () => {
  // Simulates an end-user session JWT presented as a bearer credential —
  // it simply fails to match any configured ingestion token.
  const endUserJwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.signature";
  assert.equal(authenticateIngestRequest(`Bearer ${endUserJwt}`, "sim-1.s3cr3t"), null);
});
