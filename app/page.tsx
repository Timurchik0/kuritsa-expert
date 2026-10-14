import { loadDashboard } from "./actions";
import { authEnabled } from "@/lib/auth";
import { currentUser } from "@/lib/session";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const [initial, user] = await Promise.all([loadDashboard(), authEnabled() ? currentUser() : Promise.resolve(null)]);
  return <Workspace initial={initial} user={user} />;
}
