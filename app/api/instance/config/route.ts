// app/api/instance/config/route.ts
// GET  — returns instance config (uuid7, name, description, canonicalUrl, parentUrl). Admin only.
// PATCH — updates any editable fields. Triggers parent registration if parentUrl+canonicalUrl set.

import { NextRequest, NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { registerWithParent } from "@/lib/register-with-parent";
import { validateCanonicalUrl } from "@/lib/validate-canonical-url";

/**
 * Get instance config
 * @description Returns this instance's UUID, name, description, canonical URL, and parent URL. Admin only.
 * @tag Instance
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const db = await getDb();
  const config = await db.getInstanceConfig();
  return NextResponse.json(config);
}

/**
 * Update instance config
 * @description Updates editable instance fields (name, description, canonicalUrl, parentUrl). Admin only.
 * @tag Instance
 */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await isAdmin(user.id))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Body must be an object" }, { status: 400 });
  }

  const { name, description, canonicalUrl, parentUrl } = body as Record<string, unknown>;
  const fields: { name?: string; description?: string; canonicalUrl?: string; parentUrl?: string } = {};

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim() === "") {
      return NextResponse.json({ error: "name must be a non-empty string" }, { status: 400 });
    }
    fields.name = name.trim();
  }
  if (description !== undefined) {
    if (typeof description !== "string") {
      return NextResponse.json({ error: "description must be a string" }, { status: 400 });
    }
    fields.description = description.trim();
  }
  if (canonicalUrl !== undefined) {
    if (typeof canonicalUrl !== "string") {
      return NextResponse.json({ error: "canonicalUrl must be a string" }, { status: 400 });
    }
    const trimmed = canonicalUrl.trim();
    const urlError = validateCanonicalUrl(trimmed);
    if (urlError) {
      return NextResponse.json({ error: urlError }, { status: 400 });
    }
    fields.canonicalUrl = trimmed;
  }
  if (parentUrl !== undefined) {
    if (typeof parentUrl !== "string") {
      return NextResponse.json({ error: "parentUrl must be a string" }, { status: 400 });
    }
    const trimmed = parentUrl.trim();
    if (trimmed && !trimmed.startsWith("http")) {
      return NextResponse.json({ error: "parentUrl must be an http(s) URL" }, { status: 400 });
    }
    fields.parentUrl = trimmed;
  }

  if (Object.keys(fields).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = await getDb();
  await db.setInstanceConfig(fields);
  const updated = await db.getInstanceConfig();

  // Register with parent if both URLs are configured.
  // This covers first-time setup and any subsequent identity changes.
  const registrationStatus = await registerWithParent(updated);

  return NextResponse.json({ ...updated, registrationStatus });
}
