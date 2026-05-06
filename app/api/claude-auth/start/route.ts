// app/api/claude-auth/start/route.ts
// POST — start a new Claude OAuth session.
//
// Response: { sessionId: string; url: string }

import { NextResponse } from 'next/server';
import { startClaudeAuth } from '@/lib/claude-temp-auth';

export async function POST() {
  try {
    const { sessionId, url } = await startClaudeAuth();
    return NextResponse.json({ sessionId, url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
