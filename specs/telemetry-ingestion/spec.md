# Spec: Hardened telemetry ingestion

> Written by spec-writer. WHAT and WHY only — no technology, no code.
> Feature slug: `telemetry-ingestion`. Realizes section **§6.6 "Ingestion"**
> (requirements 21–23) and the ingestion-related non-functional requirements in
> **§7** of [`../foundation/spec.md`](../foundation/spec.md). It completes the
> ingestion-security work deferred to milestone **M5** in
> [`../foundation/plan.md`](../foundation/plan.md) (the "shared ingestion token
> checked at the HTTP layer" that `backend/ingest.ts` promises in a comment but
> that does not exist), and it supplies the service-credential check that
> [`../auth-roles/spec.md`](../auth-roles/spec.md) **R12** asserts.

## Overview

Telemetry reaches Wavelink today through a single bare mutation that anyone who
can reach the backend can call: there is no credential check, no HTTP entry
point (the foundation architecture calls for the gateway to POST batches, not to
invoke a raw backend mutation), no protection against a misbehaving or malicious
source flooding the system, and readings for unknown or decommissioned devices
are silently discarded mid-loop — directly contradicting foundation R23, which
requires that malformed data be *rejected and logged rather than silently
dropped*. The people hurt by this are the operators and maintenance engineers who
trust the dashboard: silently dropped readings look identical to a healthy but
quiet machine, and an unauthenticated write path means anyone on the network can
fabricate telemetry, trigger or suppress alerts, or bury the backend under write
volume. This feature hardens the gateway→backend path so that every batch is
authenticated with a service credential, every reading is validated against
explicit rules, every rejection is visible and attributable, and no single source
can overwhelm the deployment.

## Goals

- Give the gateway a single, authenticated ingestion entry point that a batching
  HTTP client can post to, as the foundation architecture describes.
- Authenticate ingestion with a **service credential** that is independent of
  end-user sign-in and carries no end-user role.
- Define precisely what makes a reading malformed, and reject malformed readings
  loudly — with a recorded reason — instead of dropping them silently.
- Keep a batch useful when one reading in it is bad: good data still lands, bad
  data is reported back to the sender.
- Preserve batched writes as the volume-control mechanism for high-frequency
  sources, with an explicit, enforced upper bound on batch size.
- Protect the deployment from excessive or bursty request volume from any single
  ingestion source.
- Make ingestion health observable: an operator can tell how much data was
  accepted, rejected, or throttled, and why.
- Ensure rejected data never makes a device *look* fresh — a device fed only
  rejected readings must go stale rather than appear online.

## Non-goals

- **End-user authentication and the four user roles.** That is `auth-roles`
  territory. This feature only establishes the *existence* and behavior of the
  separate service credential that `auth-roles` R12 assumes; it does not define,
  redesign, or depend on the end-user role model.
- Per-device identity or per-device credentials (device certificates, mTLS,
  signed readings). v1 trusts the gateway as one authenticated source.
- Real device protocol adapters (MQTT, OPC-UA, Modbus, vendor SDKs). The
  simulator remains the shipped v1 ingestion client, per the foundation plan.
- Exactly-once delivery, deduplication of retried batches, or reordering
  guarantees for readings that arrive out of order.
- Alert-rule evaluation triggered by ingestion (foundation §6.3 / M3).
- Retention, downsampling, or rollup of stored telemetry (foundation §7 / M4).
- Semantic validation of metric *meaning* — unit checks, per-device-type metric
  allowlists, or plausibility ranges per metric (e.g. "temperature_c must be
  −50…300"). v1 validates shape, not physics.
- Auto-registering devices that ingestion has never seen before; unknown devices
  stay an admin-registration concern.
- The dashboard's own "stale data" indicator UI and any background offline-sweep
  job. This feature only guarantees the freshness signal those features read is
  never advanced by data that was rejected.
- Queuing, buffering, or backpressure *inside* the backend. Throttled senders
  retry; the backend does not store what it refused.

## Dependencies and boundaries

- **`auth-roles` R12** states that the ingestion entry point authenticates with a
  service credential distinct from end-user auth and is not governed by the four
  user roles. This spec is where that credential check is actually specified and
  built. If the two specs ever disagree about the ingestion credential, this one
  is authoritative for *how ingestion authenticates*; `auth-roles` remains
  authoritative for everything about end-user identity and roles.
- This feature must not require end-user auth to be finished first: ingestion
  authentication has to stand on its own, because the ingestion path is already
  running in the deployment.

## User stories

- As a **gateway/simulator service**, I want to post a batch of readings to one
  documented, authenticated endpoint, so that I do not need backend-internal
  access or an end-user session to deliver telemetry.
- As a **gateway operator**, I want a bad reading in my batch to be reported back
  to me with a reason and a position in the batch, so that I can fix my adapter
  instead of guessing why data is missing.
- As a **gateway operator**, I want my other devices' readings to still be stored
  when one device's reading is rejected, so that one bad tag does not blind a
  whole production line.
- As a **maintenance engineer**, I want a device that is sending unusable data to
  show as stale rather than online, so that I do not mistake a broken feed for a
  healthy machine.
- As an **admin**, I want telemetry writes to require a credential I control and
  can rotate, so that anyone who merely reaches the backend cannot fabricate or
  flood machine data.
- As an **admin**, I want a single misbehaving source to be throttled rather than
  allowed to degrade the whole deployment, so that the dashboard stays responsive
  for everyone else.
- As an **admin**, I want to see how many readings were accepted, rejected, and
  throttled and for what reasons, so that I can tell a silent gateway from a
  rejected one.

## Terminology

- **Reading** — one metric sample: a device identifier, a timestamp, a metric
  name, and a value.
- **Batch** — one ingestion request carrying one or more readings.
- **Request-level failure** — the whole batch is refused and nothing is written
  (bad credential, unparseable or oversize payload, throttling).
- **Reading-level rejection** — the batch is processed, but one or more
  individual readings are refused and reported.
- **Ingestion source** — the identity a batch is authenticated as, i.e. the
  service credential it presented.

## Requirements

Each is a single, independently testable statement. IDs are stable — the planner
and reviewer reference them.

### Entry point and authentication

- **R1** — The system exposes an ingestion entry point that accepts a batch of
  readings over HTTP from an external gateway service, per foundation §8's data
  flow (gateway POSTs batches; it does not call a backend mutation directly).
- **R2** — Every ingestion request must present a valid service credential. A
  request with a missing, malformed, or invalid credential is refused, writes
  nothing, and returns an error response distinguishable from a successful one.
- **R3** — The ingestion credential is distinct from end-user authentication: an
  end-user session cannot be used to ingest telemetry, and the ingestion
  credential grants ingestion only — it cannot be used to read telemetry,
  manage devices, manage users, or reach any other protected operation.
- **R4** — No telemetry write path is reachable from outside the deployment
  without a valid ingestion credential; in particular, the previously public,
  unauthenticated batch-recording mutation is no longer externally callable.
- **R5** — The ingestion credential is supplied by deployment configuration, with
  no usable default baked into the build; a deployment with no credential
  configured refuses all ingestion rather than accepting everything.
- **R6** — The credential can be rotated without an ingestion outage: more than
  one credential value can be accepted simultaneously during an overlap window,
  and retiring a value immediately stops requests that present it.
- **R7** — Authentication failure responses are uniform and reveal nothing about
  the deployment's contents (no indication of whether a device, metric, or
  credential prefix exists), and each failure is recorded with the time and
  whatever source information the request carries.

### What counts as malformed

- **R8** — A reading is well-formed only if it carries all of: a non-empty device
  external identifier, a numeric timestamp, a non-empty metric name, and a value
  that is either a finite number or a string. A reading missing any required
  field, carrying an unexpected field, or carrying a field of the wrong type is
  rejected as malformed.
- **R9** — A reading is rejected as malformed if its timestamp is not a finite
  millisecond-epoch number within the accepted window: no more than a configured
  tolerance in the future (to absorb clock skew) and no older than a configured
  maximum backfill age.
- **R10** — A reading is rejected as malformed if its identifier, metric name, or
  string value exceeds configured length bounds, or if a numeric value is not
  finite (NaN or infinity).
- **R11** — A reading whose device external identifier matches no registered
  device is rejected with an "unknown device" reason; ingestion never creates a
  device record implicitly.
- **R12** — A reading for a device that exists but is inactive/decommissioned is
  rejected with an "inactive device" reason, distinct from "unknown device".
- **R13** — Every rejected reading — for any reason in R8–R12 — is recorded with
  its rejection reason, its position in the batch, the device identifier and
  metric it claimed, and the time of rejection. No reading is ever discarded
  without such a record. (This closes foundation R23, which the current
  implementation violates by `continue`-ing past unknown and inactive devices.)

### Batch outcome semantics

- **R14** — Reading-level rejections produce **partial success**: well-formed
  readings in a batch are stored even when other readings in the same batch are
  rejected. A single bad reading never discards good data from unrelated devices.
- **R15** — The response to an accepted request reports the number of readings
  stored and, for each rejected reading, its position in the batch and a
  machine-readable rejection reason code, so the sender can act without parsing
  prose.
- **R16** — Request-level failures (R2 credential failure, unparseable payload,
  batch exceeding the size limit, throttling) are all-or-nothing: no reading from
  that request is stored, and the response identifies the failure category so the
  sender can tell a retry-worthy failure from a permanent one.
- **R17** — Readings stored from an accepted request are durably persisted before
  the request is reported as successful; a request reported successful never
  leaves its accepted readings unwritten.

### Batching and volume control

- **R18** — One request may carry many readings, up to a configured maximum
  number of readings and maximum payload size; a batch exceeding either bound is
  refused as a request-level failure whose reason names the exceeded limit.
- **R19** — Device freshness (current status and last-seen time) is updated at
  most once per device per batch, and only from readings that were accepted;
  rejected readings never advance a device's freshness.
- **R20** — A device's last-seen time never moves backwards: an accepted reading
  older than the device's current last-seen time is stored as telemetry but does
  not regress the device's freshness signal. (The pre-feature implementation
  patched freshness from every reading in order, so late-arriving data could
  rewind it — this requirement closes that gap; see Acceptance criteria below
  and `backend/lib/ingestValidation.ts`'s `computeFreshnessPatches`.)

### Rate limiting

- **R21** — Ingestion enforces a configured rate limit per ingestion source, over
  both requests and readings per unit time, with a configured burst allowance so
  normal bursty batching is not penalized.
- **R22** — A request that exceeds the rate limit is refused with a distinct
  "rate limited" outcome that the sender can tell apart from a validation or
  credential failure, writes nothing, and includes a hint of when to retry.
- **R23** — Rate limits are applied per ingestion source identity, so one
  throttled source does not consume another source's allowance.
- **R24** — Limits (rate, burst, batch size, timestamp window, length bounds) are
  deployment-configurable without a code change, and their configured values are
  documented.

### Observability and client behavior

- **R25** — An operator can determine, for a recent period, how many readings
  were accepted, how many were rejected broken down by reason, and how many
  requests were refused for credential or rate-limit reasons.
- **R26** — The bundled gateway/simulator authenticates with the service
  credential, respects the batch-size limit, and on a rate-limited or failed
  request backs off and retries rather than exiting or retrying immediately in a
  tight loop; it logs reading-level rejections it receives.
- **R27** — Deployment documentation (README and compose configuration) covers
  the ingestion endpoint, how to configure and rotate the credential, and the
  tunable limits, such that a new engineer can bring up a working authenticated
  ingestion path from a clean checkout.

## Acceptance criteria

- **R1** — A batch posted over HTTP to the documented ingestion endpoint by a
  client with no backend-internal access results in stored telemetry visible to a
  device's live query.
- **R2** — Posting a batch with no credential, a garbage credential, and a
  retired credential each returns an error and leaves telemetry row count
  unchanged.
- **R3** — A signed-in end-user session cannot post a batch; and a request
  carrying only the ingestion credential is refused when it attempts any
  non-ingestion operation (device list, user list, telemetry read).
- **R4** — An audit of externally reachable entry points finds no path that
  writes telemetry without presenting the ingestion credential; a direct call to
  the old batch mutation from outside the deployment fails.
- **R5** — With the credential configuration absent or empty, every ingestion
  request is refused; the credential value appears in no committed source file.
- **R6** — With two credentials configured, batches presenting either succeed;
  after removing the first, batches presenting it fail while batches presenting
  the second still succeed, with no gap where both fail.
- **R7** — Failure responses for "wrong credential" against a real device and
  against a nonexistent device are byte-identical; each attempt leaves a recorded
  failure entry.
- **R8** — A batch containing readings that each omit one required field, and a
  reading with a wrong-typed field (e.g. boolean value, string timestamp), yields
  one rejection per bad reading with a shape-related reason.
- **R9** — Readings timestamped beyond the future tolerance and older than the
  maximum backfill age are rejected with a timestamp reason; a reading just
  inside each bound is accepted.
- **R10** — An over-length identifier, an over-length metric name, an over-length
  string value, and a non-finite number are each rejected with a bounds reason.
- **R11** — A reading for an unregistered external identifier is rejected with
  "unknown device", and no new device row is created.
- **R12** — A reading for a deactivated device is rejected with "inactive
  device", a reason distinct from R11's, and no telemetry row is written for it.
- **R13** — For a batch containing one instance of every rejection reason, the
  recorded rejections account for every rejected reading, each with reason,
  batch position, claimed device identifier and metric, and timestamp. Rejected
  count plus stored count equals the number of readings submitted.
- **R14** — A batch of readings for three devices, where one device's reading is
  malformed, stores the other devices' readings; their live values update.
- **R15** — The response to that batch reports the stored count and lists the bad
  reading's index and reason code; a consumer can map each rejection back to the
  input array position without string parsing.
- **R16** — For each request-level failure category (bad credential, unparseable
  body, oversize batch, throttled), telemetry row count is unchanged afterwards,
  and the response's failure category is machine-distinguishable from the others.
- **R17** — After a successful response, a fresh read of the device's telemetry
  returns the accepted readings.
- **R18** — A batch one reading over the configured maximum, and a batch over the
  payload-size limit, are each refused with a reason naming the exceeded limit;
  a batch at exactly the limit succeeds.
- **R19** — After a batch in which every reading for a device is rejected, that
  device's last-seen time and status are unchanged from before the batch; a
  device with accepted readings is updated once, not once per reading.
- **R20** — Submitting an accepted reading older than a device's current
  last-seen time stores the telemetry row but leaves last-seen time unchanged.
- **R21** — A sender exceeding the configured rate is throttled; a sender posting
  at normal batching cadence, including a burst within the configured allowance,
  is never throttled.
- **R22** — A throttled request returns the rate-limited outcome with a retry
  hint, writes nothing, and is distinguishable in the response from a validation
  failure and from a credential failure.
- **R23** — With two sources configured, saturating one source's limit leaves the
  other source's batches accepted.
- **R24** — Each limit can be changed via deployment configuration and the new
  value takes effect without editing code; the documented values match the
  defaults actually enforced.
- **R25** — After a mixed run (valid, invalid, unauthenticated, and throttled
  traffic), an operator can retrieve counts of accepted readings, rejections by
  reason, credential failures, and throttled requests for that period.
- **R26** — With an invalid credential configured, the simulator logs the failure
  and keeps running with backoff rather than exiting or spinning; when the
  credential is corrected it resumes ingesting without a restart, and rejection
  reasons returned to it appear in its logs.
- **R27** — Following only the README on a clean checkout produces a running
  stack whose gateway successfully ingests authenticated batches, with no
  undocumented step.

## Open questions

Decisions already reasoned through and settled as requirements above — recorded
here so later phases do not reopen them without cause:

- **Partial success over whole-batch rejection (R14).** Batches mix devices and
  metrics, so failing a whole batch for one bad reading would blind unrelated
  machines and would hand a single misconfigured tag an easy denial-of-service.
  Request-level failures (R16) remain all-or-nothing, which also makes them
  safely retryable.
- **Unknown and inactive devices are rejections, not drops (R11, R12).** They are
  reported with distinct reasons rather than `continue`-d past, as foundation R23
  requires; they remain non-creating, matching the foundation plan's M1 decision.

Genuinely unresolved, for the planner or the team:

- **Retry duplication.** Because throttled and failed requests write nothing,
  senders will retry, and a retry after an ambiguous timeout can duplicate
  readings. v1 accepts duplicates; whether a later version needs idempotency keys
  or dedup on (device, metric, timestamp) is unresolved.
- **Where rejection records live and how long they are kept.** R13/R25 require
  rejections be recorded and countable, not that they be stored forever; the
  planner chooses the mechanism and a retention bound that does not let a
  malicious flood of bad readings become unbounded storage growth.
- **Concrete default limit values.** Batch size, rate, burst, timestamp window,
  and length bounds are configurable (R24), but sensible defaults depend on the
  device count and telemetry frequency that foundation §14 still lists as
  unknown. Defaults should be set from the simulator's observed volume with
  headroom, and revisited when real device counts are known.
- **One credential or several.** R23 assumes sources can be told apart. With a
  single shared token, "per source" collapses to "per deployment". Whether v1
  issues one credential per gateway instance (enabling true per-source limits and
  targeted revocation) or one shared token is a deployment-model decision.
- **Metric-name governance.** v1 accepts any bounded, non-empty metric name. If
  typos in metric names later pollute the dashboard, a per-device-type metric
  allowlist becomes a follow-up feature — deliberately out of scope here.
- **Throttled-source visibility.** Whether sustained throttling or a high
  rejection rate should raise an operator-visible alert (which would couple this
  feature to foundation §6.3 alerting, currently unbuilt) or stay as a metric an
  admin must look at.
