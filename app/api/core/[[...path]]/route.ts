import { getSessionUser } from '@/lib/auth';
import { resolvePrimordiaApiKey } from '@/lib/api-keys';
import { getProcessStatusReport } from '@/lib/process-manager';
import { getPublicOrigin } from '@/lib/public-origin';
import { createTinyCommandRestApi } from '@/lib/tiny-command/rest';
import { mainCommand } from '@/scripts/primordia-command-handlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ path?: string[] }> };

async function authorize(request: Request) {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('Authorization header must be Bearer <web-api-key>.');
  const [resolved, user] = await Promise.all([
    resolvePrimordiaApiKey(match[1], 'web'),
    getSessionUser(),
  ]);
  if (!user) throw new Error('Authorization session required.');
  if (resolved.userId !== user.id) throw new Error('User mismatch between `Authorization Bearer` header and login session cookie.');
  return {
    env: {
      PRIMORDIA_API_KEY: match[1],
    },
  };
}

function resolveThreadCwd(threadId: string): string {
  const report = getProcessStatusReport();
  const worktree = report.worktrees.find((entry) => entry.branch === threadId);
  if (!worktree) throw new Error(`Unknown thread/worktree: ${threadId}`);
  return worktree.path;
}

const coreApi = createTinyCommandRestApi({
  command: mainCommand,
  protocol: 'primordia-core.v1',
  authDescription: 'Bearer web API key from /settings/api-keys',
  basePath: '/api/core',
  openApiTitle: 'Primordia Core API',
  openApiDescription: 'OpenAPI description for Primordia Core route-action endpoints generated from the Primordia CLI command metadata.',
  bearerFormat: 'Primordia web API key',
  bearerDescription: 'Create a revokable web API key in Settings → API Keys and pass it as a Bearer token.',
  authorize,
  resolveCwd: resolveThreadCwd,
  serverUrl(request) {
    return `${getPublicOrigin(request)}${process.env.NEXT_BASE_PATH ?? ''}`;
  },
});

export function GET(request: Request, context: RouteContext) {
  return coreApi.GET(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return coreApi.POST(request, context);
}
