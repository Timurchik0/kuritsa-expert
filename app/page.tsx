import { loadDashboard } from "./actions";
import Workspace from "./workspace";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HomePage() {
  const initial = await loadDashboard();
  return <Workspace initial={initial} />;
}
