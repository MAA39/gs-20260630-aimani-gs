import { createAuthClient } from 'better-auth/client';

/**
 * Better Auth client — same-origin 設定。
 * Web Worker の /api/* proxy 経由で API Worker の auth handler へ到達する。
 */
export const authClient = createAuthClient();

export async function signInWithGitHub(callbackURL?: string): Promise<void> {
  await authClient.signIn.social({
    provider: 'github',
    callbackURL: callbackURL ?? (typeof window !== 'undefined' ? window.location.href : '/'),
  });
}
