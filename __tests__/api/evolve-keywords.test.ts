import { describe, it, expect } from "vitest";
import { extractKeywords } from "@/app/api/evolve/route";

describe("extractKeywords", () => {
  it("returns empty string for empty input", () => {
    expect(extractKeywords("")).toBe("");
  });

  it("filters out words with 3 or fewer characters", () => {
    const result = extractKeywords("add the fix for bug in apps");
    // "add"(3), "the"(3), "fix"(3), "for"(3), "bug"(3), "in"(2) are all ≤ 3 chars; "apps"(4) passes
    expect(result).toBe("apps");
  });

  it("keeps words longer than 3 characters", () => {
    const result = extractKeywords("implement dark mode toggle");
    expect(result).toContain("implement");
    expect(result).toContain("dark");
    expect(result).toContain("mode");
    expect(result).toContain("toggle");
  });

  it("strips punctuation from input", () => {
    const result = extractKeywords("hello, world! testing: punctuation.");
    expect(result).toContain("hello");
    expect(result).toContain("world");
    expect(result).toContain("testing");
    expect(result).toContain("punctuation");
  });

  it("limits output to 6 keywords", () => {
    const result = extractKeywords(
      "alpha beta gamma delta epsilon zeta theta iota kappa"
    );
    const words = result.split(" ");
    expect(words).toHaveLength(6);
    expect(words).toEqual(["alpha", "beta", "gamma", "delta", "epsilon", "zeta"]);
  });

  it("handles a typical evolve request", () => {
    const result = extractKeywords("add dark mode toggle button to settings page");
    expect(result).toContain("dark");
    expect(result).toContain("mode");
    expect(result).toContain("toggle");
    expect(result).toContain("button");
    expect(result).toContain("settings");
    expect(result).toContain("page");
  });
});
