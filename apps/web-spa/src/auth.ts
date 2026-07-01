import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient();

export type SessionUser = {
  id?: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
};

export type SessionPayload = {
  user?: SessionUser | null;
  session?: unknown;
};

export async function getSession(): Promise<SessionPayload | null> {
  const response = await fetch('/api/auth/get-session', {
    credentials: 'include',
    headers: { accept: 'application/json' },
  });

  if (!response.ok) return null;
  const data = (await response.json().catch(() => null)) as SessionPayload | null;
  if (!data?.user) return null;
  return data;
}

export async function signInWithGitHub(callbackURL = '/chat/new'): Promise<void> {
  await authClient.signIn.social({
    provider: 'github',
    callbackURL,
  });
}

export async function signOut(): Promise<void> {
  await authClient.signOut();
}
