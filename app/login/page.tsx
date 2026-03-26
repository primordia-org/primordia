// app/login/page.tsx — Server component: resolves the current session and
// passes it to the client component. No API round-trip on the browser side.

import { getSessionUser } from "@/lib/auth";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  const user = await getSessionUser();
  const initialUser = user ? { id: user.id, username: user.username } : null;
  return <LoginClient initialUser={initialUser} />;
}
