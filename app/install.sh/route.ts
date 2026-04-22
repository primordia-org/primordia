import { readFileSync } from "fs";
import { join } from "path";

export async function GET() {
  const script = readFileSync(
    join(process.cwd(), "scripts/install.sh"),
    "utf-8",
  );
  return new Response(script, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
