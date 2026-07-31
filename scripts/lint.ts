#!/usr/bin/env bun
/* eslint-disable @typescript-eslint/no-require-imports */

import Module from "module";
import { join } from "path";

type CommonJsModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown;
};

const commonJsModule = Module as CommonJsModuleLoader;
const originalLoad = commonJsModule._load;

// ESLint 9 still pulls in a few legacy minimatch@3 copies. Those copies expect
// require("brace-expansion") to return the expand function directly, while the
// audit-fixed brace-expansion@5 CommonJS entry returns an object containing
// { expand }. Keep the security override in place and adapt only the legacy
// CommonJS require shape for the lint process.
commonJsModule._load = function loadWithBraceExpansionCompat(
  request: string,
  parent: NodeModule | null,
  isMain: boolean,
) {
  const loaded = originalLoad.apply(this, [request, parent, isMain]);

  if (
    request === "brace-expansion" &&
    loaded &&
    typeof loaded === "object" &&
    "expand" in loaded &&
    typeof loaded.expand === "function"
  ) {
    return loaded.expand;
  }

  return loaded;
};

process.argv = [process.argv[0] ?? "bun", "eslint", ...process.argv.slice(2)];
require(join(process.cwd(), "node_modules/eslint/bin/eslint.js"));
