import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ReactNode } from "react";
import { Providers } from "./providers";
import { SiteHeader } from "./SiteHeader";

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
            <SiteHeader />
            {children}
          </Providers>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
