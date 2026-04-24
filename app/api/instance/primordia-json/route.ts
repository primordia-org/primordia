// app/api/instance/primordia-json/route.ts
// Served at /.well-known/primordia.json via a rewrite in next.config.ts.
// Returns this instance's identity + its known social graph (nodes + edges).

import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const db = await getDb();
  const [config, nodes, edges] = await Promise.all([
    db.getInstanceConfig(),
    db.getGraphNodes(),
    db.getGraphEdges(),
  ]);

  // Canonical URL: DB value preferred, otherwise derive from request origin.
  const canonicalUrl =
    config.canonicalUrl.trim().replace(/\/$/, "") ||
    (() => {
      const proto = req.headers.get("x-forwarded-proto") ?? "http";
      const host = req.headers.get("host") ?? "localhost";
      return `${proto}://${host}`;
    })();

  // Build the self-node (always included as the first node).
  const selfNode = {
    id: config.uuid7,
    url: canonicalUrl,
    name: config.name,
    description: config.description || undefined,
  };

  // Peer nodes from DB.
  const peerNodes = nodes.map((n) => ({
    id: n.uuid7,
    url: n.url,
    name: n.name,
    ...(n.description ? { description: n.description } : {}),
  }));

  const allEdges = edges.map((e) => ({
    from: e.from,
    to: e.to,
    type: e.type,
    date: e.date,
  }));

  const body = {
    $schema: "https://primordia.exe.xyz/schemas/instance/v1.json",
    canonical_url: canonicalUrl,
    name: config.name,
    description: config.description || undefined,
    source: [{ type: "git", url: `${canonicalUrl}/api/git` }],
    uuid7: config.uuid7,
    nodes: [selfNode, ...peerNodes],
    edges: allEdges,
    meta: {
      generated_at: new Date().toISOString(),
    },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
