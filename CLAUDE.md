# Solid Groove - Development Guide

## Project Overview

Solid Groove is a browser-based music production tool designed to make music creation accessible and intuitive. It features real-time collaboration, AI assistance, pattern-based sequencing, and a library of sounds and instruments.

## Tech Stack

### Core Framework
- **SolidJS** - Reactive UI framework
  - Use SolidJS best practices: signals, stores, effects, and resource patterns
  - Prefer `createStore` from `solid-js/store` for complex state
  - Use `createEffect` for side effects and `createMemo` for derived values
  - Utilize Context providers for global state (see AuthProvider and AudioProvider patterns)
- **SolidJS Start** - Meta-framework for SolidJS (currently configured as CSR-only with `ssr: false`)
- **Vinxi** - Build tool and dev server

### Backend & Data
- **Firebase Authentication** - User authentication and session management
- **Firebase Firestore** - Real-time database for project storage and synchronization
- **solid-firebase** - SolidJS integration library for Firebase
  - Note: Currently using manual subscriptions in dataService rather than solid-firebase hooks

### Audio
- **Tone.js** - Web Audio API library for audio synthesis and playback
  - Used in SongPlayer for managing audio playback and synthesis

### Development Tools
- **TypeScript** - Strict mode enabled
- **Bun** - Package manager and runtime
- **Biome** - Linting and code formatting
- **Vitest** - Testing framework with jsdom

## Project Structure

```
src/
├── audio/              # Audio playback and synthesis
│   ├── AudioProvider.tsx    # Context provider for SongPlayer
│   └── SongPlayer.ts        # Tone.js integration and playback logic
├── auth/               # Authentication logic
│   ├── AuthProvider.tsx     # Context provider for auth state
│   └── authService.ts       # Firebase auth service wrapper
├── components/         # Reusable UI components
│   ├── editor/              # Music editor components
│   ├── Dashboard.tsx
│   ├── LoginButton.tsx
│   └── ProjectList.tsx
├── domain/             # Canonical schema-v1 domain model (authoritative)
│   ├── entities.ts          # Entity shapes and their Zod schemas
│   ├── ids.ts               # Prefixed stable IDs and ID factories
│   ├── time.ts              # Integer musical time at 192 PPQ
│   ├── parameters.ts        # Shared parameter definitions
│   ├── parse.ts             # Validation and domain invariants
│   ├── serialize.ts         # Deterministic JSON serialization
│   ├── factories.ts         # Blank/entity factories
│   └── fixtures.ts          # Deterministic reference projects
├── persistence/        # Schema-v1 Firestore layout and repository boundary
│   ├── documents.ts         # Collection paths, document shapes, chunk overflow
│   ├── documentSize.ts      # Firestore size accounting and the size budgets
│   ├── projectRepository.ts # The repository contract both stores satisfy
│   ├── inMemoryProjectRepository.ts   # Local/test store
│   ├── firestoreProjectRepository.ts  # Production store (only Firebase import)
│   ├── autosave.ts          # Coalescing, revision-checked optimistic saves
│   └── migrations.ts        # Forward-migration harness (PRJ-04)
├── commands/           # Shared command, transaction, and history kernel
│   ├── types.ts             # Actors, envelopes, issues, command definitions
│   ├── registry.ts          # The one typed command registry
│   ├── execute.ts           # Validation, atomic transactions, revisions
│   ├── history.ts           # Local bounded undo/redo and gestures
│   ├── projectEdits.ts      # Immutable edit helpers with structural sharing
│   └── definitions/         # Registered commands, grouped by entity
├── model/              # Prototype state, superseded by src/domain
│   ├── types.ts             # Prototype types (removed by the FND-009 slice)
│   ├── project.ts           # Project store and update functions
│   └── dataService.ts       # Firestore data access layer
├── selection/          # Selection/focus state (UI-only, never persisted)
│   ├── types.ts             # SelectionScope union and SelectionState
│   └── selection.ts         # Pure selection ops + project-driven reconciliation
├── projection/         # Read-only consumer projections built from a Project
│   ├── fingerprint.ts       # Deterministic content fingerprint for change detection
│   ├── audioProjection.ts        # Audio engine's song projection (PRD 9.7)
│   ├── arrangementProjection.ts  # Arrangement renderer's projection (PRD 9.3)
│   ├── projectSummaryProjection.ts # Dashboard/persistence summary (PRD 9.9)
│   └── assistantContextProjection.ts # Compact assistant context (PRD 9.8)
├── routes/             # File-based routing
│   ├── index.tsx            # Home/landing page
│   ├── dashboard.tsx        # User dashboard
│   └── projects/[id].tsx    # Project editor route
├── shared/             # Helpers production code AND tests depend on
│   ├── id.ts                # PRD 9.4 prefixed-ID factory (+ seeded test variant)
│   ├── clock.ts              # Injectable Clock abstraction
│   ├── scheduler.ts          # Injectable Scheduler for coalescing/deferred work
│   └── schema.ts             # Shared Zod parse helper (PRD 9.1 runtime-schema decision)
├── testing/            # Helpers only tests use
│   └── fixtures.ts          # Browser-safe fixture loading + fixture builders
├── app.tsx             # Root application component
├── entry-client.tsx    # Client entry point
└── firebaseConfig.ts   # Firebase configuration

e2e/                    # Playwright browser E2E suite
tests/emulator/         # Firebase Emulator suite (Firestore rules, etc.)
public/fixtures/        # Fixture data loaded by src/testing/fixtures.ts
```

## Commands

All commands use Bun as the package manager and runtime:

```bash
# Development
bun run dev          # Start development server

# Build and production
bun run build        # Build for production
bun run start        # Start production server
bun run clean        # Delete build/dev caches and test output (see docs/testing.md)

# Code quality
bun run check        # Run Biome linting and formatting (auto-fix)
bun run check:ci     # Same checks, non-mutating (CI gate; use `check` locally)

# Testing
bun run test              # Unit + component tests, once
bun run test:watch        # Unit + component tests, watch mode
bun run test:ui           # Unit + component tests, Vitest UI
bun run test:emulator     # Firebase Emulator suite (Firestore rules, etc.)
bun run test:browser      # Browser E2E suite (Playwright: Chromium/Firefox/WebKit)
bun run test:browser:install  # One-time: download Playwright's browser binaries
```

See [`docs/testing.md`](./docs/testing.md) for what each suite covers, how CI gates on them, and the shared test helpers (`src/shared/id.ts`, `src/shared/clock.ts`, `src/testing/fixtures.ts`).

## Code Style Guidelines

### General Principles
- **Keep code tidy and modular**: Break out functions and components to keep them simple, clear, and easy to read
- **No long, complex blobs**: If a function or component is getting too long, split it into smaller pieces
- **Prefer third-party dependencies**: Use well-maintained libraries rather than implementing common functionality from scratch
- **Use TypeScript strictly**: The project has `strict: true` enabled

### SolidJS Best Practices

1. **State Management**
   - Use `createStore` with `produce` for complex nested state updates (see src/model/project.ts:12)
   - Export setter functions rather than exposing setters directly
   - Keep stores focused on a single domain (auth, project, etc.)

2. **Context Providers**
   - Follow the pattern in AuthProvider.tsx:20 and AudioProvider.tsx:7
   - Always provide a typed hook for consuming context (e.g., `useAuth()`, `useAudio()`)
   - Type assert the context return value to avoid optional checks

3. **Effects and Cleanup**
   - Use `createEffect` for subscriptions and side effects
   - Always call `onCleanup` for subscriptions (see project.ts:30)
   - Example pattern:
   ```typescript
   createEffect(() => {
     const unsubscribe = service.subscribe(...);
     onCleanup(() => unsubscribe());
   });
   ```

4. **Component Structure**
   - Keep components focused on a single responsibility
   - Extract complex logic into separate functions or composables
   - Use functional components with props typing

### Firebase Integration

1. **Authentication**
   - Use AuthProvider for app-wide auth state
   - Access via `useAuth()` hook
   - AuthProvider automatically redirects unauthenticated users to home

2. **Firestore Data Access**
   - All Firestore operations go through dataService (src/model/dataService.ts)
   - Use real-time subscriptions for live updates
   - Security rules enforce owner-based access (see firestore.rules:5)

3. **Data Flow Pattern**
   ```
   Component → Store setter function → Update store → dataService.updateProject() → Firestore
   Firestore → dataService subscription → Update store → Component reactively updates
   ```

### Path Aliases
- Use `~/*` to reference files from `src/` directory (configured in tsconfig.json:20)
- Example: `import { useAuth } from "~/auth/AuthProvider"`

### TypeScript
- Define domain types in `src/domain` alongside their runtime schema; `src/model/types.ts` holds prototype types only
- Use discriminated unions for variant types (see the domain Instrument and ClipContent types)
- Leverage `Partial<T>` for update operations

## Architecture Patterns

### Canonical domain model (`src/domain`)
- `src/domain` is the authoritative schema-v1 contract (PRD sections 9.4 and 9.5). Its types, Zod schemas, invariants, and tests replace any separate domain-model document.
- It has no Firebase, Tone.js, or SolidJS imports. Persistence, commands, audio, and rendering consume it from outside; audio nodes and Firestore `Timestamp`s never enter project state.
- Persistent relationships use prefixed IDs from `createIdFactory()` (`createSeededIdFactory()` in tests), never array positions.
- Musical time is integer ticks at 192 PPQ. Seconds, bars/beats/16ths, and pixels are derived through `src/domain/time.ts`.
- A user-controlled numeric value declares its range, unit, default, clamping policy, and automation capability once in `src/domain/parameters.ts`; UI, validation, audio, and assistant tools read that definition instead of repeating literals.
- `parseProject` is the only way to obtain a `Project`. It either returns a fully valid project or a list of issues, and never partially repairs input.
- Changing this contract is its own backlog task, not incidental work inside a feature.

### Schema-v1 persistence (`src/persistence`)
- The PRD section 9.9 three-tier Firestore layout is a contract: `projects/{projectId}` metadata, `projects/{projectId}/song/current`, `projects/{projectId}/clips/{clipId}`, and `projects/{projectId}/arrangement/{trackId}` chunks when the song document exceeds its budget. See [`docs/persistence.md`](./docs/persistence.md).
- `src/persistence/documents.ts` owns every collection path and document body. No other module builds a Firestore path or document for a project.
- Every write is revision-checked and every tier is written independently: a note edit writes one clip document, never song structure.
- `ProjectRepository` has an in-memory and a Firestore implementation, and both run the same contract suite. Only `firestoreProjectRepository.ts` imports `firebase/firestore`, so it is not re-exported from the directory barrel.
- Autosave (`autosave.ts`) coalesces rapid edits, exposes save state, keeps a failed write queued for retry, and ignores remote echoes at or below the local revision.

### Shared command layer (`src/commands`)
- Every project mutation — pointer, keyboard, or assistant — is a registered command (PRD section 9.6). Components never write to project state; they build a typed command and hand it to `CommandHistory`.
- A command declares a versioned type, a Zod payload schema, a pure `apply`, a generated `invert`, and a one-line `summarize`. Payloads carry explicit IDs for anything they create, so replay, redo, and assistant previews reproduce the same project.
- `executeTransaction` is the atomic unit: commands apply to a working copy, the result is checked against every domain invariant, and any failure returns the original project object untouched. One committed transaction produces exactly one revision and one history entry.
- Continuous gestures use `history.beginGesture()`; every step applies immediately but the whole drag commits as one entry and one revision.
- Undo/redo is session-local, bounded, and replays inverse commands rather than project snapshots. Only an explicit `replaceProject` clears it — a save acknowledgement or remote echo must never touch it.
- Like `src/domain`, this layer imports no Firebase, Tone, or Solid. Adding or changing a command is a contract change; see the registry test's pinned command list.

### Service Layer
- Create service modules for external integrations (authService, dataService)
- Services handle all direct Firebase API calls
- Services provide clean, typed interfaces to the rest of the app

### Real-time Synchronization
- Use Firestore's `onSnapshot` for real-time updates
- Subscriptions are set up in `createEffect` with proper cleanup
- Store updates use `produce` for immutable updates

### Audio Playback
- SongPlayer class manages Tone.js instances
- AudioProvider makes SongPlayer available via context
- Audio state is separate from UI state

### File-based Routing
- Routes are defined by files in `src/routes/`
- Dynamic routes use `[param]` syntax
- Use `useParams()` to access route parameters

## Testing

- Test files use `.test.ts` or `.test.tsx` extension
- Vitest configured with jsdom for DOM testing
- Use `@solidjs/testing-library` for component tests
- Use `@testing-library/jest-dom` for DOM assertions
- Beyond unit/component tests, the project has a Firebase Emulator suite (`tests/emulator/`, `bun run test:emulator`) and a Playwright browser E2E suite (`e2e/`, `bun run test:browser`) — see [`docs/testing.md`](./docs/testing.md) for what each covers and how CI gates on them
- Use `src/shared/id.ts`'s `createId`/`createSeededIdFactory` for entity IDs and `src/shared/clock.ts`'s `Clock` for anything that needs the current time, rather than calling `nanoid()`/`Date.now()` directly, so tests can be deterministic
- Use `src/testing/fixtures.ts`'s builders (`buildProject`, `buildTrack`, ...) instead of hand-writing fixture literals in new tests

## Important Configuration Notes

1. **SSR is disabled** - The app runs client-side only (app.config.ts:4)
2. **Module system** - Using ESNext with bundler resolution
3. **JSX** - Preserved with `solid-js` import source
4. **Strict TypeScript** - All strict checks enabled
5. **Package Management** - This project uses Bun as the package manager
   - **NEVER commit package-lock.json** - This file is auto-generated by npm and conflicts with Bun's package management
   - Use `bun install` for installing dependencies, not `npm install`
   - package-lock.json is in .gitignore and should remain there

## Common Tasks

### Adding a new route
1. Create file in `src/routes/`
2. File name becomes the route (e.g., `about.tsx` → `/about`)
3. Default export is the page component

### Adding a new data model
1. Define types in `src/model/types.ts`
2. Add Firestore operations to `src/model/dataService.ts`
3. Create store and hooks in a new file like `src/model/[feature].ts`

### Adding a new component
1. Create in appropriate directory under `src/components/`
2. Keep focused on single responsibility
3. Extract complex logic to separate functions
4. Use TypeScript for props

### Working with audio
1. Use `useAudio()` hook to access SongPlayer
2. All Tone.js code should be in `src/audio/`
3. Keep audio logic separate from UI components
