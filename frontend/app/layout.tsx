import { ReactNode } from "react";
import { Providers } from "./providers";

export const metadata = {
  title: "Wavelink",
  description: "Realtime robot/machine dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
