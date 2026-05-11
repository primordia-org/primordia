// app/api/claude-auth/complete/route.ts
// POST — submit the authorization code and receive .credentials.json.
//
// Body:    { sessionId: string; code: string }
// Response: { credentials: string }   (raw JSON string from .credentials.json)

import { NextRequest, NextResponse } from 'next/server';
import { completeClaudeAuth } from '@/lib/claude-temp-auth';

export async function POST(req: NextRequest) {
  let sessionId: string;
  let code: string;
  try {
    const body = await req.json();
    sessionId = body.sessionId;
    code = body.code;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!sessionId || !code) {
    return NextResponse.json({ error: 'sessionId and code are required' }, { status: 400 });
  }

  try {
    const credentials = await completeClaudeAuth(sessionId, code.trim());
    return NextResponse.json({ credentials });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
