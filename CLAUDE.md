# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Payback is a Nuxt 3 PWA for tracking and splitting expenses during trips. It uses Firebase/Firestore for data storage, Firebase Auth for authentication, and shadcn-vue for UI components.

## Development Commands

**Package Manager**: This project uses `pnpm` (v10.11.0).

```bash
# Install dependencies
pnpm install

# Development server (http://localhost:3000)
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Linting
npx eslint .
```

## Architecture Overview

### Firebase Integration

The app uses a dual Firebase setup:
- **Client-side**: VueFire for reactive Firestore bindings
- **Server-side**: Firebase Admin SDK for session verification

**Authentication Flow**:
1. Client authenticates with Firebase Auth
2. Server middleware (`server/middleware/session.ts`) verifies session cookies via Firebase Admin
3. User context is set in `event.context.appUser`
4. Client-side auth state managed via `useLogin()` composable

### Data Model

**Firestore Structure**:
```
trips/{tripId}
  - name, tripCurrency, exchangeRate, defaultCurrency
  - totalExpenses, enabledTotalExpenses, disabledTotalExpenses
  - expenseCount
  /members/{memberId}
    - name, avatarEmoji, spending, isHost
  /expenses/{expenseId}
    - description, grandTotal, paidByMemberId
    - sharedWithMemberIds, paidAt
    - enabled, isProcessing
    - items[] (ExpenseDetailItem)
    - imageUrls[]
```

**Type Converters**: All Firestore documents use type converters in `utils/converter.ts`:
- `tripConverter` - Converts Trip documents, calculates totals
- `tripMemberConverter` - Converts member documents
- `expenseConverter` - Converts expense documents with date formatting

### Directory Structure

- **pages/**: File-based routing (Nuxt convention)
  - `index.vue` - Trip list
  - `login.vue` - Authentication page
  - `trips/[tripId]/` - Trip detail pages
  - `trips/[tripId]/expenses/` - Expense pages

- **components/**: Vue components
  - `ui/` - shadcn-vue components (prefixed with `ui-`)
  - Custom components (LoginForm, Navbar, etc.)

- **composables/**: Reusable Vue composables
  - `useTrip()` - Fetch single trip with reactive updates
  - `useTripMembers()` - Fetch trip members, provides `hostMember` and `tripMembersMap`
  - `useTripExpenses()` - Fetch expenses with optional limit, provides `enabledExpenses`
  - `useSessionUser()` - Global state for authenticated user
  - `useLogin()` - Authentication logic

- **server/**: Nitro server
  - `api/` - API routes
  - `middleware/session.ts` - Sets `event.context.appUser` from session cookie
  - `utils/session.ts` - Firebase Admin initialization and session verification

- **utils/**: Shared utilities
  - `converter.ts` - Firestore type converters
  - `date.ts` - Firebase Timestamp formatting utilities

- **middleware/**: Nuxt route middleware
  - `auth.ts` - Redirects to /login if not authenticated

- **types/**: TypeScript type definitions
  - `index.ts` - Core types (Trip, TripMember, Expense, etc.)

### UI Framework

- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`)
- **Components**: shadcn-vue with `ui` prefix (e.g., `<ui-button>`)
- **Icons**: `@nuxt/icon` with Lucide icons (e.g., `<Icon name="lucide-plus" />`)
- **Forms**: vee-validate + zod for validation
- **Notifications**: vue-sonner for toasts

### Key Patterns

**Component Naming**: Use kebab-case in templates (enforced by ESLint):
```vue
<ui-button>  <!-- Correct -->
<UiButton>   <!-- Incorrect -->
```

**Date Handling**: Always use utilities from `utils/date.ts`:
- `formatFirebaseTimestamp()` - Full datetime
- `formatFirebaseDate()` - Date only
- `formatFirebaseTime()` - Time only
- `formatFirebaseDateAndTime()` - Object with year/month/day/hour/minute

**Authentication**:
- Pages requiring auth must use `definePageMeta({ middleware: ['auth'] })`
- Access current user via `useSessionUser()` composable

**Firestore Queries**:
- Always use type converters when querying: `.withConverter(tripConverter)`
- Use `ssrKey` for SSR hydration: `{ ssrKey: 'unique-key' }`
- Use `usePendingPromises()` to await initial data load

**PWA**:
- Configured with `@vite-pwa/nuxt`
- Manifest in `nuxt.config.ts` under `pwa.manifest`
- Service worker strategy: `generateSW`

### Environment Variables

Required environment variables (set in `.env`):
```
NUXT_PUBLIC_FIREBASE_API_KEY
NUXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NUXT_PUBLIC_FIREBASE_PROJECT_ID
NUXT_PUBLIC_FIREBASE_APP_ID
NUXT_PUBLIC_FIREBASE_STORAGE_BUCKET
NUXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_NAME
NUXT_PUBLIC_FIREBASE_AUTH_COOKIE_EXPIRES
GOOGLE_APPLICATION_CREDENTIALS  # JSON string of service account
```

### ESLint Configuration

Uses `@antfu/eslint-config` with custom rules:
- Enforces kebab-case component naming in templates
- Allows `process` usage without global preference

### Important Notes

- **Firestore Security**: Currently set to allow all reads/writes (`firestore.rules`). This should be restricted in production.
- **Sentry**: Integration is commented out pending upstream fix (see `nuxt.config.ts:13`)
- **Layouts**: Two layouts available:
  - `default.vue` - Standard layout
  - `defaultWithBottomBar.vue` - Layout with bottom navigation (used in trip pages)
