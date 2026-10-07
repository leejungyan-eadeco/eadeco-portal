import { currentUser } from "@/lib/auth";
import { listUsers } from "@/lib/users";
import { UsersView } from "./view";

export const dynamic = "force-dynamic";

export default async function Users() {
  const [me, users] = await Promise.all([currentUser(), listUsers()]);
  return <UsersView users={users} me={me!.username} />;
}
