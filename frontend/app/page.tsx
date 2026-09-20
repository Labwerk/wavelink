import { redirect } from "next/navigation";

// The device registry (filter/group, admin management, history) lives at
// /devices — see specs/device-registry/plan.md "Frontend". `devices.listActive`
// (this page's old data source) is removed in favor of the paginated,
// reactive `devices.list`.
export default function HomePage() {
  redirect("/devices");
}
