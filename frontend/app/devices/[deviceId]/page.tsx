import type { Id } from "../../../../backend/_generated/dataModel";
import { DeviceDetailView } from "./DeviceDetailView";

// Next.js 16: `params` is a Promise (frontend/AGENTS.md — read the local
// upgrade guide before assuming sync params work). This stays a thin server
// shell that awaits it once, then hands the plain string down to the client
// component that actually subscribes to data.
export default async function DeviceDetailPage(props: {
  params: Promise<{ deviceId: string }>;
}) {
  const { deviceId } = await props.params;
  return <DeviceDetailView deviceId={deviceId as Id<"devices">} />;
}
