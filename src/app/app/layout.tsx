import { LostSaveNotice } from "@/components/lost-save-notice";
import { requireUser } from "@/lib/session";

/** Server-side auth guard for every /app route (proxy.ts is only a soft gate). */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      {children}
      <LostSaveNotice />
    </>
  );
}
