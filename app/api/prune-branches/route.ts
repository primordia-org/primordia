// app/api/prune-branches/route.ts
// This endpoint was removed. The file exists only to satisfy the
// .next/types/validator.ts module reference generated before the route
// was deleted. Returns 410 Gone for any request.
export async function POST() {
  return Response.json({ error: "This endpoint has been removed." }, { status: 410 });
}
