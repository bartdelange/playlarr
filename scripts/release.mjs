#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
const part = process.argv[3];
const run = (executable, args, capture = false) => {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error || result.status !== 0)
    throw new Error(`command failed: ${executable} ${args.join(" ")}`);
  return result.stdout?.trim() ?? "";
};
const output = (executable, ...args) => run(executable, args, true);
const version = () => {
  const value = JSON.parse(readFileSync("package.json", "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/.test(value))
    throw new Error(`invalid package version: ${value}`);
  return value;
};
const requireCleanMaster = () => {
  if (output("git", "status", "--porcelain"))
    throw new Error("working tree must be clean before releasing");
  if (output("git", "branch", "--show-current") !== "master")
    throw new Error("release commands must start on master");
  run("git", ["fetch", "origin"]);
  if (
    output("git", "rev-parse", "HEAD") !==
    output("git", "rev-parse", "origin/master")
  )
    throw new Error("local master must exactly match origin/master");
};
const requireUnusedTag = (tag) => {
  if (output("git", "tag", "--list", tag))
    throw new Error(`tag already exists: ${tag}`);
  const remote = spawnSync("git", [
    "ls-remote",
    "--exit-code",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
  ]);
  if (remote.status === 0)
    throw new Error(`tag already exists on origin: ${tag}`);
  if (remote.status !== 2) throw new Error(`could not verify tag ${tag}`);
};
try {
  requireCleanMaster();
  if (command === "prepare") {
    if (!["major", "minor", "patch"].includes(part))
      throw new Error("usage: npm run release -- prepare <major|minor|patch>");
    const [major, minor, patch] = version().split(".").map(Number);
    const next =
      part === "major"
        ? `${major + 1}.0.0`
        : part === "minor"
          ? `${major}.${minor + 1}.0`
          : `${major}.${minor}.${patch + 1}`;
    const tag = `v${next}`;
    requireUnusedTag(tag);
    const branch = `chore/release-${tag}`;
    run("git", ["switch", "-c", branch]);
    run("npm", ["version", next, "--no-git-tag-version"]);
    run("npm", ["run", "validate"]);
    run("git", ["add", "package.json", "package-lock.json"]);
    const title = `🚀 release(repo): prepare ${next}`;
    run("git", ["commit", "-m", title]);
    run("git", ["push", "-u", "origin", branch]);
    run("gh", [
      "pr",
      "create",
      "--base",
      "master",
      "--head",
      branch,
      "--title",
      title,
      "--body",
      `## Summary\n\n- Prepare release \`${tag}\`.\n\n## Validation\n\n- [x] Lint\n- [x] Strict typecheck\n- [x] Unit tests\n- [x] Production build\n`,
    ]);
  } else if (command === "publish") {
    const tag = `v${version()}`;
    requireUnusedTag(tag);
    run("git", ["tag", "-a", tag, "-m", `Release ${tag}`]);
    run("git", ["push", "origin", tag]);
  } else throw new Error("usage: npm run release -- <prepare|publish>");
} catch (error) {
  console.error(
    `release aborted: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
