import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  parserPreset: {
    parserOpts: {
      headerPattern:
        /^(\p{Extended_Pictographic}\uFE0F?)\s+(feat|fix|chore)\((config|deployment|lidarr|musicbrainz|persistence|playlist|repo|sources|web)\): (.+)$/u,
      headerCorrespondence: ["gitmoji", "type", "scope", "subject"],
    },
  },
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "chore"]],
    "scope-enum": [
      2,
      "always",
      ["config", "deployment", "lidarr", "musicbrainz", "persistence", "playlist", "repo", "sources", "web"],
    ],
    "header-max-length": [2, "always", 100],
    "subject-empty": [2, "never"],
    "subject-full-stop": [2, "never", "."],
    "subject-case": [2, "always", "lower-case"],
  },
};

export default config;
