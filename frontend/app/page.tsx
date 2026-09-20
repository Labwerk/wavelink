import { redirect } from "next/navigation";

// The device registry (filter/group, admin management, history) lives at
// /devices — see specs/device-registry/plan.md "Frontend". `devices.listActive`
// (this page's old data source) is removed in favor of the paginated,
// reactive `devices.list`. Sign-in gating (R1) is handled by the proxy
// (frontend/proxy.ts); the signed-in header (email/role, sign-out, admin
// link) lives in `SiteHeader` (frontend/app/SiteHeader.tsx), rendered from
// the root layout so it appears on every authenticated page, not just this
// redirect target.
export default function HomePage() {
  redirect("/devices");
}
