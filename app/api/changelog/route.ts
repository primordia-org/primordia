// app/api/changelog/route.ts
//
// GET /api/changelog?filename=YYYY-MM-DD-HH-MM-SS Description.md
//
// Returns the raw markdown content of a single changelog file.
// Used by the ChangelogEntryDetails client component to lazy-load
// entry bodies when a <details> element is first expanded.

/**
 * Get changelog entry
 * @description Returns the raw markdown body of a single changelog file. Pass `filename` as a query parameter (e.g. `2026-01-01-00-00-00 Fix login bug.md`).
 * @tags Changelog
 * @openapi
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

// Validates the filename matches the expected pattern before reading.
// This prevents path traversal attacks.
const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{2}-\d{2}-\d{2}) .+\.md$/;

export async function GET(req: NextRequest) {
  const filename = req.nextUrl.searchParams.get("filename");

  if (!filename || !FILENAME_RE.test(filename)) {
    return new NextResponse("Bad Request", { status: 400 });
  }

  const filePath = path.join(process.cwd(), "changelog", filename);

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }
}
