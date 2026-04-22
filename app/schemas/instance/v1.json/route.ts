// app/schemas/instance/v1.json/route.ts
// Serves the JSON Schema for the Primordia instance manifest at
// /schemas/instance/v1.json (matching the $id in the schema itself).

import { NextResponse } from "next/server";

const SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://primordia.app/schemas/instance/v1.json",
  title: "Primordia Instance Manifest",
  description:
    "Machine-readable metadata for a Primordia instance, served at /.well-known/primordia.json",
  type: "object",
  required: ["$schema", "canonical_url", "uuid7"],
  additionalProperties: true,
  properties: {
    $schema: {
      type: "string",
      const: "https://primordia.app/schemas/instance/v1.json",
    },
    canonical_url: {
      type: "string",
      format: "uri",
      description: "The authoritative public URL of this Primordia instance",
    },
    uuid7: {
      type: "string",
      format: "uuid",
      description: "A stable UUID v7 identifier for this instance, independent of URL",
    },
    name: { type: "string" },
    description: { type: "string" },
    source: {
      type: "array",
      items: {
        type: "object",
        required: ["type", "url"],
        additionalProperties: true,
        properties: {
          type: { type: "string", examples: ["git", "web", "archive"] },
          url: { type: "string", format: "uri" },
        },
      },
    },
    nodes: {
      type: "array",
      description: "A partial or complete set of known Primordia instances in the ecosystem",
      items: {
        type: "object",
        required: ["id"],
        additionalProperties: true,
        properties: {
          id: {
            type: "string",
            format: "uuid",
            description: "A stable UUID v7 identifier for this instance, independent of URL",
          },
          url: {
            type: "string",
            format: "uri",
            description: "The current canonical URL of this instance",
          },
          name: { type: "string" },
          description: { type: "string" },
        },
      },
    },
    edges: {
      type: "array",
      description: "Typed relationships between nodes, referenced by UUID",
      items: {
        type: "object",
        required: ["from", "to", "type"],
        additionalProperties: true,
        properties: {
          from: {
            type: "string",
            format: "uuid",
            description: "The source node's UUID",
          },
          to: {
            type: "string",
            format: "uuid",
            description: "The target node's UUID",
          },
          type: {
            type: "string",
            description:
              "The relationship type. Known value: child_of (the source node is a fork/child of the target). Unknown types should be rendered generically.",
            examples: ["child_of"],
          },
          date: {
            type: "string",
            format: "date",
            description: "The date this relationship was established",
          },
        },
      },
    },
    meta: {
      type: "object",
      additionalProperties: true,
      properties: {
        generated_at: { type: "string", format: "date-time" },
      },
    },
  },
};

export function GET() {
  return NextResponse.json(SCHEMA, {
    headers: {
      "Cache-Control": "public, max-age=86400",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
