---
name: playlarr-feature
description: Implement or change a Playlarr capability, backend API, provider integration, or capability library. Use for feature work such as Spotify, TIDAL, Lidarr, MusicBrainz, authentication, settings, imports, commands, or creating a library consumed by a Playlarr app; not for documentation-only edits or standalone reviews.
---

# Playlarr feature implementation

Deliver usable behavior through the capability that owns it while preserving Playlarr's application and Nx boundaries.

## Establish ownership

1. Inspect the existing project graph, relevant applications, capability libraries, and surrounding tests.
2. Identify the capability that owns the user behavior. Extend it when it already exists.
3. Create a new project only when real code has an independent responsibility that justifies an Nx boundary.
4. Create only the layers needed now:
   - `contracts` for shared transport models
   - `domain` for framework-independent business rules
   - `web` for capability UI
   - `server` for transport and orchestration
   - `persistence` for feature-owned data

Application projects remain thin composition roots. Route files, bootstrap modules, rewrite configuration, and provider registration may live there; feature components, controllers, services, rules, and repositories do not.

## Preserve communication boundaries

- Compose feature UI from `libs/<capability>/web` into the Next.js App Router.
- Keep NestJS controllers thin: validate transport input, invoke capability orchestration, and translate the result.
- Put request and response models in capability contracts only when they are genuinely shared across the HTTP boundary.
- Never expose ORM entities as contracts or import persistence into web code.
- Browser code calls relative `/api/*` endpoints. Shared server-only transport and internal backend configuration come from `libs/shared/web-infrastructure`; feature-specific server API integrations belong in the owning capability web library, such as `libs/auth/web`.
- Keep provider clients and secrets on the server and normalize external response shapes at the adapter boundary.

## Use Nx without abandoning ownership

Use `nx-workspace` to inspect resolved projects, targets, tags, consumers, and dependencies. When scaffolding is appropriate, use `nx-generate` for generator discovery and dry runs.

Playlarr overrides the generic `nx-generate` recommendation to default internal libraries to non-buildable. This workspace enforces `enforceBuildableLibDependency: true`, and current capability libraries are buildable. Before generation:

1. Inspect the actual consuming project's build target and graph.
2. Inspect similar Playlarr libraries and their package metadata, tags, TypeScript configuration, and bundler.
3. Check supported generator options rather than guessing flags.
4. Generate a library whose buildability is compatible with every buildable consumer and dependency.

If a capability library causes a buildability error, investigate its resolved Nx configuration, build target, package exports, dependency direction, and generator choices. Fix that project boundary. Never move feature UI or other implementation into `apps/web/src/features` or another application directory as a workaround. The prior `libs/auth/web` failure is the regression this rule protects against.

Do not weaken module-boundary enforcement. Use `link-workspace-packages` when a new or existing sibling package needs an actual workspace dependency.

## Implement complete behavior

- Trace the path from UI or caller through transport, orchestration, persistence, and observable result.
- When configuration is required, include the configuration UI, validation, backend behavior, and persistence in the same change unless the user explicitly narrows scope.
- Preserve ordering, duplicates, manual match authority, and Lidarr plan-versus-execution semantics where relevant.
- Use durable persisted commands only when work must survive restarts or outlive a request. Ordinary provider calls remain ordinary requests.
- Prefer concrete code in the owning component over a new interface, token, wrapper, or generic service with no second real use.

## Validate and simplify

Add the smallest tests that protect Playlarr-owned behavior or a realistic regression. Use Nx targets selected from the resolved affected projects.

Before finishing:

- confirm apps remain composition roots and imports follow project tags
- confirm the capability is usable end to end for the requested scope
- remove generated placeholders and obsolete code
- remove any abstraction justified only by future flexibility, testability, or mirroring issue terminology
- inspect realistic partial failures, retries, concurrency, and shutdown behavior introduced by the change
