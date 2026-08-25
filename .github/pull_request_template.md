<!--
PR titles must follow the same convention as commit messages:

<gitmoji> <type>(<optional-scope>): <subject>

Examples:
✨ feat(runtime): Create app host
🐛 fix: Handle startup failure
🔧 chore(repo): Validate pull request titles
-->

## What does this change?

<!--
Briefly explain what this PR changes and why.
Focus on the user-visible or architectural outcome rather than listing files.
-->

## Related issue

<!-- Use "Closes #123", "Fixes #123", etc. where applicable. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor
- [ ] Documentation
- [ ] Tests
- [ ] Build / CI / tooling
- [ ] Dependency update
- [ ] Other

## Implementation notes

<!--
Explain anything reviewers should understand about the implementation.

Especially call out changes involving:
- Spotify or TIDAL integrations
- Lidarr / MusicBrainz matching
- Navidrome
- playlist ordering or duplicate preservation
- persistence / SQLite schema
- background processing or SSE
- authentication / security
- Docker / Unraid behavior
-->

## Behaviour

### Before

<!-- What happened before this change? -->

### After

<!-- What happens now? -->

## Testing

<!--
Describe how this was verified.
-->

- [ ] Unit tests added or updated
- [ ] Integration tests added or updated
- [ ] End-to-end tests added or updated
- [ ] Tested manually
- [ ] Existing tests cover the change

### Manual verification

<!-- Steps someone else can use to verify the change. -->

1.
2.
3.

## Quality checks

- [ ] Type checking passes
- [ ] Linting passes
- [ ] Formatting passes
- [ ] Relevant tests pass
- [ ] Production build passes

## Compatibility

<!-- Check all that apply. -->

- [ ] No database migration required
- [ ] Existing SQLite data remains compatible
- [ ] Existing configuration remains compatible
- [ ] Docker deployment remains compatible
- [ ] Unraid deployment remains compatible
- [ ] No breaking API or behaviour changes

<!--
If any item above cannot be checked, explain why below.
-->

## Screenshots

<!-- Include before/after screenshots for meaningful UI changes. Remove if not applicable. -->

## Additional notes

<!-- Anything else reviewers should know. -->
