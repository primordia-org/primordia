export async function GET() {
  return Response.json(
    { error: 'Per-credential server keys are available at /api/secrets/{source}/server-public-key.' },
    { status: 410 },
  );
}
