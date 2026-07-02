import { createAuthClient } from 'better-auth/client';

/**
 * Better Auth client — same-origin 設定。
 *
 * /api/auth/** は Web Worker が直接処理する。
 * /api/v1/** だけ API Worker へ Service Binding proxy する。
 */
export const authClient = createAuthClient();

export async function signInWithGitHub(callbackURL?: string): Promise<void> {
  await authClient.signIn.social({
    provider: 'github',
    callbackURL: callbackURL ?? (typeof window !== 'undefined' ? window.location.href : '/'),
  });
}
