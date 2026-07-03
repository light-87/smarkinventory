import { describe, expect, test } from "bun:test";
import { deriveProjectStatus } from "@/lib/projects/status";

/**
 * lib/projects/status — derived project card status [R2-03]: "draft (no BOM
 * sourced) / sourcing (any run active) / sourced (≥1 BOM sourced)".
 */
describe("deriveProjectStatus", () => {
  test("no BOMs at all → draft", () => {
    expect(deriveProjectStatus([], [])).toBe("draft");
  });

  test("BOMs exist but none sourced, no active runs → draft", () => {
    expect(deriveProjectStatus([{ sourcing_status: "draft" }], [])).toBe("draft");
  });

  test("any BOM sourced (or ordered) → sourced", () => {
    expect(deriveProjectStatus([{ sourcing_status: "sourced" }], [])).toBe("sourced");
    expect(deriveProjectStatus([{ sourcing_status: "ordered" }], [])).toBe("sourced");
    expect(deriveProjectStatus([{ sourcing_status: "draft" }, { sourcing_status: "sourced" }], [])).toBe("sourced");
  });

  test("an active run outranks a sourced BOM — sourcing wins while a run is in flight", () => {
    expect(deriveProjectStatus([{ sourcing_status: "sourced" }], [{ status: "running" }])).toBe("sourcing");
    expect(deriveProjectStatus([], [{ status: "planning" }])).toBe("sourcing");
    expect(deriveProjectStatus([], [{ status: "review" }])).toBe("sourcing");
  });

  test("a finished/failed run does not count as active", () => {
    expect(deriveProjectStatus([], [{ status: "done" }])).toBe("draft");
    expect(deriveProjectStatus([{ sourcing_status: "sourced" }], [{ status: "failed" }])).toBe("sourced");
  });
});
