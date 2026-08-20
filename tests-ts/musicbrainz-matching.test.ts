import { expect, it } from "vitest";
import {
  isrcPattern,
  marked,
  nameKey,
  releaseScore,
  searchTitle,
  uniqueValues,
  versionPreference,
  words,
} from "../src/server/integrations/musicbrainz/matching";
it("normalizes MusicBrainz search inputs without discarding version safety signals", () => {
  expect(isrcPattern.test("USABC1234567")).toBe(true);
  expect(searchTitle("Song (feat. Guest)")).toBe("Song");
  expect([...words("The Song (Radio Edit)")]).toEqual(["song"]);
  expect(nameKey("Beyoncé & Co.")).toBe("beyoncco");
  expect(uniqueValues(["a", "a", undefined, "b"])).toEqual(["a", "b"]);
  expect(marked("Song (Extended Mix)")).toBe(true);
  expect(versionPreference("Song (Extended Mix)")).toBeGreaterThan(
    versionPreference("Song (Radio Edit)"),
  );
});
it("prefers exact album releases over unrelated compilations", () => {
  const exact = releaseScore(
    {
      title: "Source Album",
      status: "Official",
      "release-group": { title: "Source Album" },
    },
    "Source Album",
  );
  const compilation = releaseScore(
    {
      title: "Hits",
      "release-group": { title: "Hits", "secondary-types": ["Compilation"] },
    },
    "Source Album",
  );
  expect(exact).toBeGreaterThan(compilation);
});
