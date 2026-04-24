"use client";

import { ApiReferenceReact } from "@scalar/api-reference-react";
import "@scalar/api-reference-react/style.css";
import { withBasePath } from "@/lib/base-path";

export default function ApiDocsPage() {
  return (
    <ApiReferenceReact
      configuration={{
        _integration: "nextjs",
        url: withBasePath("/openapi.json"),
        theme: "moon",
        layout: "modern",
        defaultHttpClient: {
          targetKey: "js",
          clientKey: "fetch",
        },
      }}
    />
  );
}
