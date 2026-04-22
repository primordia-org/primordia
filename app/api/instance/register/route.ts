// app/api/instance/register/route.ts
// Allows a child Primordia instance to register itself with this instance.
// On success, the child is added as a graph node and a "child_of" edge is created.
//
// POST body: { uuid7: string, name: string, url?: string, description?: string }

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generateUuid7 } from "@/lib/uuid7";

// Basic uuid7 format check (8-4-4-4-12 hex, version nibble = 7).
function isValidUuid7(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const { uuid7, url, name, description } = body as Record<string, unknown>;

  if (!isValidUuid7(uuid7)) {
    return NextResponse.json({ error: "uuid7 must be a valid UUID v7" }, { status: 400 });
  }
  if (url !== undefined && (typeof url !== "string" || !url.startsWith("http"))) {
    return NextResponse.json({ error: "url must be a valid http(s) URL" }, { status: 400 });
  }
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const db = await getDb();
  const config = await db.getInstanceConfig();

  // Don't register ourselves.
  if (uuid7 === config.uuid7) {
    return NextResponse.json({ error: "Cannot register self" }, { status: 400 });
  }

  const now = Date.now();

  await db.upsertGraphNode({
    uuid7,
    url: typeof url === "string" ? url.replace(/\/$/, "") : "",
    name: name.trim(),
    description: typeof description === "string" ? description.trim() || null : null,
    registeredAt: now,
  });

  // Create a child_of edge: child → self (idempotent by deterministic id).
  // Direction: child_of points from the child to its parent.
  const edgeId = `${uuid7}→child_of→${config.uuid7}`;
  const today = new Date().toISOString().slice(0, 10);
  await db.upsertGraphEdge({
    id: edgeId,
    from: uuid7,
    to: config.uuid7,
    type: "child_of",
    date: today,
    createdAt: now,
  });

  return NextResponse.json({ ok: true, message: "Registered successfully" });
}
