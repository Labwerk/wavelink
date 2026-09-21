import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ReactNode } from "react";
import { AppShell } from "../components/shell/AppShell";
import "../styles/tokens.css";
import "../styles/globals.css";
import { Providers } from "./providers";

export const metadata = {
  title: "Wavelink",
  description: "Realtime robot/machine dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <body>
          <Providers>
            <AppShell>{children}</AppShell>
          </Providers>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
