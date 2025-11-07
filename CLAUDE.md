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
├── model/              # Data models and state management
│   ├── types.ts             # TypeScript types for data models
│   ├── project.ts           # Project store and update functions
│   └── dataService.ts       # Firestore data access layer
├── routes/             # File-based routing
│   ├── index.tsx            # Home/landing page
│   ├── dashboard.tsx        # User dashboard
│   └── projects/[id].tsx    # Project editor route
├── app.tsx             # Root application component
├── entry-client.tsx    # Client entry point
└── firebaseConfig.ts   # Firebase configuration
```

## Commands

All commands use Bun as the package manager and runtime:

```bash
# Development
bun run dev          # Start development server

# Build and production
bun run build        # Build for production
bun run start        # Start production server

# Code quality
bun run check        # Run Biome linting and formatting (auto-fix)

# Testing
bun run test         # Run tests once
bun run test:watch   # Run tests in watch mode
bun run test:ui      # Run tests with UI
```

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
- Define types in `src/model/types.ts` for data models
- Use discriminated unions for variant types (see Instrument type)
- Leverage `Partial<T>` for update operations

## Architecture Patterns

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
