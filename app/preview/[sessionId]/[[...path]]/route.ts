// app/preview/[sessionId]/[[...path]]/route.ts
// Proxies HTTP requests to a local preview dev server for the given evolve session.
//
// Preview servers run with NEXT_BASE_PATH=/preview/{sessionId}, so their pages
// are served at paths matching /preview/{sessionId}/... — exactly the paths
// this proxy intercepts. This keeps previews on the same origin as the main
// app, so cookies and auth work without cross-origin issues.
//
// WebSocket (HMR) connections cannot be proxied via route handlers and are
// intentionally not supported here — previews are for viewing, not hot-reloading.

import { getDb } from '../../../../lib/db';

type Params = { sessionId: string; path?: string[] };

async function proxy(
  request: Request,
  { params }: { params: Promise<Params> },
): Promise<Response> {
  const { sessionId, path = [] } = await params;

  const db = await getDb();
  const session = await db.getEvolveSession(sessionId);

  if (!session || session.port === null) {
    return new Response('Preview server not available — session not found or server not yet started.', {
      status: 502,
    });
  }

  const pathSuffix = path.length > 0 ? `/${path.join('/')}` : '';
  const { search } = new URL(request.url);
  const targetUrl = `http://localhost:${session.port}/preview/${sessionId}${pathSuffix}${search}`;

  // Forward all headers except host (fetch sets it automatically for the target).
  const headers = new Headers();
  for (const [key, value] of request.headers.entries()) {
    if (key.toLowerCase() !== 'host') headers.append(key, value);
  }

  const isBodyMethod = request.method !== 'GET' && request.method !== 'HEAD';

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body: isBodyMethod ? request.body : undefined,
      // @ts-expect-error — duplex is required for streaming request bodies in some runtimes
      duplex: isBodyMethod ? 'half' : undefined,
      redirect: 'manual',
    });
  } catch {
    return new Response('Preview server unreachable.', { status: 502 });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: new Headers(upstream.headers),
  });
}

export {
  proxy as GET,
  proxy as POST,
  proxy as PUT,
  proxy as PATCH,
  proxy as DELETE,
  proxy as HEAD,
  proxy as OPTIONS,
};
