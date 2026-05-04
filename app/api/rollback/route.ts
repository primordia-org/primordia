// app/api/rollback/route.ts
// This endpoint was removed (superseded by /api/admin/rollback). The file
// exists only to satisfy the .next/types/validator.ts module reference
// generated before the route was deleted. Returns 410 Gone for any request.
/**
 * @ignore
 */
export async function GET() {
  return Response.json({ error: "This endpoint has been removed. Use /api/admin/rollback instead." }, { status: 410 });
}

/**
 * @ignore
 */
export async function POST() {
  return Response.json({ error: "This endpoint has been removed. Use /api/admin/rollback instead." }, { status: 410 });
}
