// app/install-for-exe-dev.sh/route.ts
// Serves scripts/install-for-exe-dev.sh with the git-clone branch injected
// based on the current NEXT_BASE_PATH.
//
// When the app runs at /preview/<branch>, the script automatically clones that
// branch so preview installs track the same code the preview is serving.

import { readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

export function GET() {
  const scriptPath = join(process.cwd(), "scripts", "install-for-exe-dev.sh");
  let script = readFileSync(scriptPath, "utf-8");

  // Detect branch from base path: /preview/<branch> → <branch>
  const basePath = process.env.NEXT_BASE_PATH ?? "";
  const match = basePath.match(/^\/preview\/(.+)$/);
  if (match) {
    const branch = match[1];
    // Inject --branch flag into the git clone line so the VM gets that branch.
    script = script.replace(
      /(git clone )(https:\/\/primordia\.exe\.xyz\/api\/git)/g,
      `$1--branch ${branch} $2`,
    );
  }

  return new Response(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
