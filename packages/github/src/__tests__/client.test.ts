import { describe, it, expect } from "vitest";
import { parsePrRef } from "../client.js";

describe("parsePrRef", () => {
  it("parses owner/repo#number shorthand", () => {
    expect(parsePrRef("anthropics/diffprism#42")).toEqual({
      owner: "anthropics",
      repo: "diffprism",
      number: 42,
    });
  });

  it("parses HTTPS GitHub URL", () => {
    expect(
      parsePrRef("https://github.com/anthropics/diffprism/pull/123"),
    ).toEqual({
      owner: "anthropics",
      repo: "diffprism",
      number: 123,
    });
  });

  it("parses URL with trailing path segments", () => {
    expect(
      parsePrRef("https://github.com/owner/repo/pull/99/files"),
    ).toEqual({
      owner: "owner",
      repo: "repo",
      number: 99,
    });
  });

  it("handles repos with hyphens and dots", () => {
    expect(parsePrRef("my-org/my.repo#7")).toEqual({
      owner: "my-org",
      repo: "my.repo",
      number: 7,
    });
  });

  it("throws on invalid input", () => {
    expect(() => parsePrRef("not-a-pr-ref")).toThrow("Invalid PR reference");
  });

  it("throws on empty string", () => {
    expect(() => parsePrRef("")).toThrow("Invalid PR reference");
  });

  it("throws on malformed shorthand (missing #)", () => {
    expect(() => parsePrRef("owner/repo/123")).toThrow("Invalid PR reference");
  });
});
