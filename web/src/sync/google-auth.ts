import type { Settings } from '../settings';
import { type DriveAuth, DRIVE_SCOPE } from './drive';

const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const TOKEN_KEY = 'drive.token';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: TokenResponse) => void;
            error_callback: (error: { type: string; message?: string }) => void;
          }): TokenClient;
          revoke(token: string, done: () => void): void;
        };
      };
    };
  }
}

let script: Promise<void> | undefined;

function loadGoogleIdentity(): Promise<void> {
  script ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GIS_SCRIPT;
    el.onload = () => resolve();
    el.onerror = () => {
      script = undefined;
      reject(new Error('Could not reach Google to sign in. Check your connection.'));
    };
    document.head.append(el);
  });
  return script;
}

/**
 * Google sign-in for a page with no server behind it: Google hands the
 * browser a short-lived access token (about an hour). There is no way to
 * renew it silently, so when it runs out the user taps once to get another.
 */
export class GoogleAuth implements DriveAuth {
  constructor(private readonly settings: Settings) {}

  private stored(): { token: string; expires: number } | null {
    try {
      const parsed = JSON.parse(this.settings.get(TOKEN_KEY) ?? 'null');
      // Stop using a token a minute early, so an upload does not start with
      // one that expires half-way through.
      return parsed && parsed.expires - 60_000 > Date.now() ? parsed : null;
    } catch {
      return null;
    }
  }

  async token(): Promise<string | null> {
    return this.stored()?.token ?? null;
  }

  get signedIn(): boolean {
    return this.stored() !== null;
  }

  invalidate(token: string): void {
    if (this.stored()?.token === token) this.settings.remove(TOKEN_KEY);
  }

  /**
   * Opens Google's sign-in window. Must be called from a tap or click, or the
   * browser blocks the window.
   */
  async signIn(): Promise<void> {
    const clientId = this.settings.driveClientId;
    if (!clientId) throw new Error('Enter your Google OAuth client ID first.');
    await loadGoogleIdentity();
    const response = await new Promise<TokenResponse>((resolve, reject) => {
      window.google!.accounts.oauth2
        .initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: resolve,
          error_callback: (e) =>
            reject(
              new Error(
                e.type === 'popup_closed'
                  ? 'Sign-in was cancelled.'
                  : e.type === 'popup_failed_to_open'
                    ? 'The browser blocked the sign-in window. Allow pop-ups for this site.'
                    : (e.message ?? 'Google sign-in failed.'),
              ),
            ),
        })
        // After the first approval Google only needs the account confirmed.
        .requestAccessToken({ prompt: this.settings.driveEnabled ? '' : 'consent' });
    });
    if (!response.access_token) {
      throw new Error(response.error_description ?? response.error ?? 'Google sign-in failed.');
    }
    this.settings.set(
      TOKEN_KEY,
      JSON.stringify({
        token: response.access_token,
        expires: Date.now() + (response.expires_in ?? 3600) * 1000,
      }),
    );
  }

  /** Forgets the token and withdraws this app's access at Google. */
  signOut(): void {
    const token = this.stored()?.token;
    this.settings.remove(TOKEN_KEY);
    if (token) window.google?.accounts.oauth2.revoke(token, () => {});
  }
}
