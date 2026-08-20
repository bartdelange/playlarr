import { describe, expect, it } from "vitest";
import { GET } from "../../../app/api/health/route";

describe("health route", () => {
  it("reports a compatible healthy status", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
