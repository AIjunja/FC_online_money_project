import { describe, expect, it } from "vitest";
import { excludedTeams, teams } from "./teams";

describe("FC online team pool", () => {
  it("contains 39 teams and excludes all requested top teams", () => {
    expect(teams).toHaveLength(39);
    expect(teams.some((team) => excludedTeams.includes(team))).toBe(false);
    expect(new Set(teams).size).toBe(39);
  });
});
