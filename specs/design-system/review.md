# Review: Design system & app shell

Round 2 (re-review after builder fixes). Round 1 was FAIL on R7 only. Requirement IDs and evidence are kept stable from round 1.

## Verdict: PASS

All R1 to R9 are met in code. The only open items are browser-only manual checks that neither the builder nor I can run here (no browser or running backend). See "Not covered".

## Requirement coverage

| Req | Verdict | Evidence |
|---|---|---|
| R1 tokens documented, single source | Met | `frontend/styles/tokens.css` defines colors, spacing, type, radius and layout. `frontend/styles/README.md` documents them. Doc parity is tested in `frontend/styles/tokens.test.ts`, which passes. Shell, `StatusBadge` and `DeviceCard` use `var(--token)` (`TopBar.module.css`, `SideNav.module.css`, `DeviceCard.module.css`). |
| R2 status color has a non-color cue | Met | `StatusBadge.tsx:16-34` gives each of the 7 kinds a distinct glyph and a text label. `StatusBadge.test.tsx` passes. Existing screens keep text cues: `DeviceCard.tsx:49` `⚠ Stale`, `:58` `Status: <strong>`, and `DeviceDetail.tsx` badges carry text. Contrast is tested in `tokens.test.ts`. The manual grayscale check has not been run. |
| R3 one shared shell with nav and top bar showing identity | Met | `layout.tsx` mounts `<AppShell>` once inside `Providers`. `AppShell.tsx:29-41` renders `SideNav`, `TopBar` (email and role, `TopBar.tsx:27-33`) and the content. `AppShell.test.tsx` passes. `/signin` and signed-out (`me === null`) render bare, as `SiteHeader` did. |
| R4 nav lists only role-permitted sections, omitted not disabled | Met | `lib/nav.ts:15-24` filters `NAV_ITEMS` by capability from `me.capabilities`. `nav.test.ts` checks all four roles against the real `capabilitiesFor`. `AppShell.test.tsx` checks viewer has no Users link and admin does. Manual four-role sign-in has not been run. |
| R5 client-side route change updates active indicator | Met | The shell is in the root layout and uses `next/link` (`SideNav.tsx`). `aria-current` comes from `usePathname` plus `isActive`. `AppShell.test.tsx` checks `aria-current` moves when the pathname changes. Active state also has a left bar and heavier weight (`SideNav.module.css:41-46`). The no-reload check in the browser has not been run. |
| R6 dark theme applied consistently | Met (code) | `globals.css` sets `color-scheme: dark`, body, links, focus and form controls from tokens. The old light literals were swapped for tokens. The literal scan has no color hits. `next build` passes. The manual page sweep has not been run. |
| R7 no page-level literal duplicating a token | Met (was Partial in round 1) | Round 2 grep for exact-token spacing literals (`0.25rem`, `0.5rem`, `0.75rem`, `1rem`, `1.5rem`, `2rem`, `3rem`) and `font-weight: 600` across `app/`, `components/` and `lib/` finds only off-scale values: `0.1rem 0.6rem` (`DeviceDetailView.module.css:11`) and `0.1rem var(--space-2)` (`DeviceCard.module.css:36`, `TopBar.module.css:31`, `StatusBadge.module.css:5`). `frontend/styles/literals.test.ts` now also flags token-equal spacing and font weights, has self-checks for the new patterns, and passes. Colors, `fontFamily` and font sizes are clean as before. |
| R8 correct at 1024px and wider | Met (code), unverified visually | `AppShell.module.css:4` sets `min-width: 1024px`, a fixed `--sidebar-width` and a `minmax(0,1fr)` content column. `TopBar.module.css` uses `white-space: nowrap`. Not testable in jsdom, and the manual 1024/1440 check has not been run. |
| R9 no behavior change | Met | Sign-out (`TopBar.tsx:19-22`) is identical to the old handler. `users.me` is unchanged. Nav hrefs `/`, `/devices` and `/admin/users` match the old destinations. Devices is gated on `data.read`, which all roles hold, so it is visible to everyone as before. The existing 8 suites pass unmodified. Only visual and label changes: "Manage users" became "Users", and "Signed in as X (role)" became an email plus a role chip. Both were sanctioned by the plan. |

## Test results

- `frontend`: `npx vitest run` gave 13 files and 101 tests, all passing (I ran this myself in round 2).
- `frontend`: `NEXT_PUBLIC_CONVEX_URL=https://example.convex.cloud npx next build` compiled successfully and generated all routes (I ran this myself in round 2).
- I did not run tsc or lint separately. The builder reports tsc shows only the pre-existing `*.module.css` module errors, and the build's own type check passes.
- Manual checks (four-role sign-in, 1024px and 1440px, grayscale, no-reload navigation) were not run.

## Issues

### Blocking

None.

### Should-fix

1. Manual verification is outstanding: R2 grayscale, R4 four-role sign-in, R5 no-reload, R6 page sweep and R8 1024px. These cannot be evidenced from jsdom. A human with a browser should tick them off before release.

### Nice-to-have

2. `StatusBadge` is not used by any screen. The plan accepts this as a primitive for follow-on work. Keep the "status color only via StatusBadge" rule in the README, and check it when the next screen is migrated.
3. `--color-decommissioned` was changed from `#8792B0` to `#909BB9` to pass the contrast test. This is documented as a deviation and is consistent with the plan's rule to adjust the hex, not the threshold. No action needed.

## Deviations from plan (tasks.md), checked against the spec

- `--color-decommissioned` changed to `#909BB9`: no requirement violated.
- Literal scan lives in `literals.test.ts` rather than `tokens.test.ts`: same coverage, and it now also covers spacing and font weight.
- Stale card tint layered over surface: visual only, still token-based. No violation.
- `activeNavItem` helper added: it reuses `NAV_ITEMS` and `isActive`, so no drift.
- Round 1 gap (spacing and weight migration not done and not recorded) is now fixed and recorded in tasks.md under "Review round 1 fixes".

## Not covered

- R8 has no automated test. The 1024px layout is CSS only.
- R5 "without full reload" is only approximated in jsdom (`aria-current` follows the pathname). A real browser check is needed.
- R2 grayscale distinguishability is asserted only via distinct glyphs and text, not visually.
- R4 role-by-role sign-in against a live backend was not run. It is covered in unit tests against the real `capabilitiesFor`.
