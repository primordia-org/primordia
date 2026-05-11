// app/api/claude-auth/cancel/route.ts
// POST — cancel an in-progress session (kills claude, cleans up temp dir).
//
// Body:    { sessionId: string }
// Response: {}

import { NextRequest, NextResponse } from 'next/server';
import { cancelClaudeAuth } from '@/lib/claude-temp-auth';

export async function POST(req: NextRequest) {
  let sessionId: string;
  try {
    const body = await req.json();
    sessionId = body.sessionId;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
  }

  cancelClaudeAuth(sessionId);
  return NextResponse.json({});
}
