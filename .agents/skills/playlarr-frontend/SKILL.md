---
name: playlarr-frontend
description: Implement or change Playlarr's React/Next.js UI, including pages, forms, settings screens, loading states, styling, accessibility, or browser API interactions. Use for UI work in apps/web or capability web libraries; not for backend-only or documentation-only changes.
---

# Playlarr frontend implementation

Build UI that fits the application as it exists and remains owned by the relevant capability.

## Start from the current UI

Inspect the route being changed, its capability web library, global styles, nearby components, CSS modules, tests, and loading/error patterns before choosing markup or styling. Reuse established layout, typography, spacing, controls, feedback, and naming where they solve the same problem.

Do not introduce a design system, generic component layer, or arbitrary visual convention without a current need. A reusable component should represent repeated behavior or presentation already present in the change, not hypothetical consistency.

## Keep the application shell thin

- Put feature components, forms, UI state, and feature-specific presentation in `libs/<capability>/web`.
- Keep `apps/web/src/app` focused on routes, layouts, metadata, framework boundaries, parameters, and composing capability entrypoints.
- Do not move capability UI into `apps/web/src/features` to avoid an Nx build or import problem. Use `playlarr-feature` and `nx-workspace` to correct the project boundary.
- Keep shared server-only transport and internal backend configuration in `libs/shared/web-infrastructure`, feature-specific server API integrations in their capability web libraries, and application composition such as routes and rewrites in `apps/web`.

## Choose the rendering boundary deliberately

- Prefer Server Components for data loading and non-interactive composition.
- Add `'use client'` only where browser state, effects, event handlers, or browser APIs require it, and keep the client boundary narrow.
- Use Suspense and route or component loading states when asynchronous rendering would otherwise leave an unclear wait.
- Browser requests use relative `/api/*` URLs. Never expose or assemble the internal NestJS host or port in capability UI.
- Server-side feature requests use their owning capability's server API integration rather than calling the public origin or duplicating shared transport behavior.

## Protect user behavior

- Use semantic HTML, associated labels, keyboard-operable controls, meaningful focus behavior, and appropriate live status or alert semantics.
- Make pending, success, empty, validation, and failure states understandable when the interaction can produce them.
- Preserve user input when practical after recoverable failures and prevent accidental duplicate submissions where they could cause duplicate side effects.
- Validate untrusted API responses at the boundary when the UI relies on their shape.
- Preserve playlist order and duplicate entries in rendering and interaction.

Use Testing Library for behavior that matters to users. Avoid tests that assert incidental markup, CSS implementation, or React/Next.js behavior without a Playlarr regression risk. Run the relevant Nx lint, typecheck, test, and build targets for both the capability library and its consuming app when affected.
