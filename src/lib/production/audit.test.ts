import { describe, expect, it } from "vitest";

import { stableJsonHash } from "./audit";

describe("stableJsonHash", () => {
  it("hashes equivalent objects consistently", () => {
    expect(stableJsonHash({ a: 1, b: 2 })).toHaveLength(64);
    expect(stableJsonHash({ a: 1, b: 2 })).toBe(stableJsonHash({ a: 1, b: 2 }));
  });

  it("changes when payload changes", () => {
    expect(stableJsonHash({ a: 1 })).not.toBe(stableJsonHash({ a: 2 }));
  });
});
