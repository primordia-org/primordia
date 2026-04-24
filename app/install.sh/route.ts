import { readFileSync } from "fs";
import { join } from "path";
import { basePath } from "@/lib/base-path";
import { getPublicOrigin } from "@/lib/public-origin";

export async function GET(request: Request) {
  const origin = getPublicOrigin(request);
  const script = readFileSync(
    join(process.cwd(), "scripts/install.sh"),
    "utf-8",
  ).replaceAll("https://primordia.exe.xyz", `${origin}${basePath}`);
  return new Response(script, {
    headers: {
      "Content-Type": "text/x-shellscript; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
