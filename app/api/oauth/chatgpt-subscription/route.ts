// app/api/oauth/chatgpt-subscription/route.ts
// ChatGPT subscription OAuth helpers. This mirrors the Codex device-code
// "Sign in with ChatGPT" flow directly in Next.js, without spawning Codex or
// any other CLI process.

import { getSessionUser } from '@/lib/auth';

const ISSUER = 'https://auth.openai.com';
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const DEVICE_API_BASE = `${ISSUER}/api/accounts`;
const DEVICE_CALLBACK = `${ISSUER}/deviceauth/callback`;

function upstreamUnavailable(error: unknown) {
  const detail = error instanceof Error ? error.message : String(error);
  return Response.json(
    { error: 'Could not reach ChatGPT OAuth service', detail: detail.slice(0, 500) },
    { status: 502 },
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split('.');
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requireUser() {
  return getSessionUser();
}

/** JSON body for POST /api/oauth/chatgpt-subscription */
export interface ChatGptSubscriptionBody {
  action: 'start' | 'complete';
  deviceAuthId?: string;
  userCode?: string;
}

/**
 * Start or complete ChatGPT device-code OAuth
 * @description Starts the ChatGPT device authorization flow, or polls once for completion and returns ordinary OAuth credentials when authorized. The route does not spawn a CLI process.
 * @tag OAuth
 * @body ChatGptSubscriptionBody
 * @response { deviceAuthId?: string; userCode?: string; verificationUri?: string; expiresIn?: number; credentials?: object }
 */
export async function POST(req: Request) {
  const user = await requireUser();
  if (!user) return Response.json({ error: 'Authentication required' }, { status: 401 });

  let body: ChatGptSubscriptionBody;
  try {
    body = (await req.json()) as ChatGptSubscriptionBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (body.action === 'start') {
    let upstream: Response;
    try {
      upstream = await fetch(`${DEVICE_API_BASE}/deviceauth/usercode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CLIENT_ID }),
      });
    } catch (err) {
      return upstreamUnavailable(err);
    }

    if (!upstream.ok) {
      return Response.json({ error: `Device-code request failed with status ${upstream.status}` }, { status: 502 });
    }

    let data: {
      device_auth_id?: string;
      user_code?: string;
      usercode?: string;
      interval?: string | number;
    };
    try {
      data = (await upstream.json()) as typeof data;
    } catch {
      return Response.json({ error: 'Device-code response was not valid JSON' }, { status: 502 });
    }
    const userCode = data.user_code ?? data.usercode;
    if (!data.device_auth_id || !userCode) {
      return Response.json({ error: 'Device-code response was missing required fields' }, { status: 502 });
    }

    const interval = typeof data.interval === 'number' ? data.interval : Number.parseInt(data.interval ?? '5', 10);
    return Response.json({
      status: 'started',
      verificationUrl: `${ISSUER}/codex/device`,
      userCode,
      deviceAuthId: data.device_auth_id,
      interval: Number.isFinite(interval) && interval > 0 ? interval : 5,
    });
  }

  if (body.action === 'complete') {
    if (!body.deviceAuthId || !body.userCode) {
      return Response.json({ error: 'deviceAuthId and userCode required' }, { status: 400 });
    }

    let poll: Response;
    try {
      poll = await fetch(`${DEVICE_API_BASE}/deviceauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: body.deviceAuthId, user_code: body.userCode }),
      });
    } catch (err) {
      return upstreamUnavailable(err);
    }

    if (poll.status === 403 || poll.status === 404) return Response.json({ status: 'pending' });
    if (!poll.ok) {
      const text = await poll.text().catch(() => '');
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error === 'token_pending' || parsed.error === 'authorization_pending' || parsed.error === 'slow_down') {
          return Response.json({ status: 'pending' });
        }
      } catch {
        // Fall through to the upstream-error response below.
      }
      return Response.json({ error: `Device authorization failed with status ${poll.status}`, detail: text.slice(0, 500) }, { status: 502 });
    }

    let codeData: {
      authorization_code?: string;
      code_verifier?: string;
      id_token?: string;
      access_token?: string;
      refresh_token?: string;
    };
    try {
      codeData = (await poll.json()) as typeof codeData;
    } catch {
      return Response.json({ error: 'Device authorization response was not valid JSON' }, { status: 502 });
    }

    let tokens: { id_token?: string; access_token?: string; refresh_token?: string } = codeData;
    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) {
      if (!codeData.authorization_code || !codeData.code_verifier) {
        return Response.json({ error: 'Authorized response was missing tokens or an authorization-code exchange payload' }, { status: 502 });
      }

      const form = new URLSearchParams({
        grant_type: 'authorization_code',
        code: codeData.authorization_code,
        redirect_uri: DEVICE_CALLBACK,
        client_id: CLIENT_ID,
        code_verifier: codeData.code_verifier,
      });
      let tokenRes: Response;
      try {
        tokenRes = await fetch(`${ISSUER}/oauth/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: form,
        });
      } catch (err) {
        return upstreamUnavailable(err);
      }
      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => '');
        return Response.json({ error: `Token exchange failed with status ${tokenRes.status}`, detail: text.slice(0, 500) }, { status: 502 });
      }
      try {
        tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string; refresh_token?: string };
      } catch {
        return Response.json({ error: 'Token exchange response was not valid JSON' }, { status: 502 });
      }
    }

    if (!tokens.id_token || !tokens.access_token || !tokens.refresh_token) {
      return Response.json({ error: 'Token response was missing required tokens' }, { status: 502 });
    }

    const idClaims = decodeJwtPayload(tokens.id_token);
    const accessClaims = decodeJwtPayload(tokens.access_token);
    const accessTokenExpiresAt = typeof accessClaims?.exp === 'number' ? accessClaims.exp * 1000 : null;
    const accountId = typeof idClaims?.chatgpt_account_id === 'string' ? idClaims.chatgpt_account_id : null;

    return Response.json({
      status: 'connected',
      credentials: {
        authMode: 'chatgpt',
        issuer: ISSUER,
        clientId: CLIENT_ID,
        tokens: {
          idToken: tokens.id_token,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          accountId,
          accessTokenExpiresAt,
        },
        lastRefresh: new Date().toISOString(),
      },
      accountId,
      accessTokenExpiresAt,
    });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
}
