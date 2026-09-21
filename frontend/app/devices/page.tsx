import { Suspense } from "react";
import { DevicesView } from "./DevicesView";

// `DevicesView` reads filter state from the URL via `useSearchParams`, which
// requires a Suspense boundary (see frontend/AGENTS.md — Next.js 16 caveat;
// confirmed against node_modules/next/dist/docs/01-app/.../use-search-params.md).
export default function DevicesPage() {
  return (
    <Suspense fallback={<p style={{ padding: "var(--space-6)" }}>Loading…</p>}>
      <DevicesView />
    </Suspense>
  );
}
