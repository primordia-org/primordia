import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/check-keys/route";

describe("GET /api/check-keys", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns empty missing array when all keys are set", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPO = "owner/repo";

    const response = await GET();
    const data = await response.json();

    expect(data.missing).toEqual([]);
  });

  it("reports all missing keys when env is empty", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;

    const response = await GET();
    const data = await response.json();

    expect(data.missing).toHaveLength(3);
    expect(data.missing.map((m: { key: string }) => m.key)).toEqual([
      "ANTHROPIC_API_KEY",
      "GITHUB_TOKEN",
      "GITHUB_REPO",
    ]);
  });

  it("reports only the missing keys", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    delete process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_REPO;

    const response = await GET();
    const data = await response.json();

    expect(data.missing).toHaveLength(2);
    expect(data.missing.map((m: { key: string }) => m.key)).toEqual([
      "GITHUB_TOKEN",
      "GITHUB_REPO",
    ]);
  });

  it("includes descriptions for missing keys", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.GITHUB_TOKEN = "ghp_test";
    process.env.GITHUB_REPO = "owner/repo";

    const response = await GET();
    const data = await response.json();

    expect(data.missing[0]).toEqual({
      key: "ANTHROPIC_API_KEY",
      description: "Chat (Anthropic API)",
    });
  });
});
