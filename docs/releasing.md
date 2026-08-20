# Releasing Playlarr

Start from clean, current `master`. Prepare a semantic-version release PR with:

```bash
npm run release -- prepare patch
```

Use `minor` or `major` when appropriate. The helper updates `package.json` and `package-lock.json`, runs Node
validation, commits, pushes, and opens the release PR.

After merge, update `master` and publish the annotated tag:

```bash
npm run release -- publish
```

GitHub Actions validates the tag, publishes the `linux/amd64` Node image to GHCR, and creates the GitHub release. Before
public release, audit full git history for credentials and enable repository secret scanning and push protection.
