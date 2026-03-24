# Agents Guide

This monorepo is a React 19 + TypeScript web dashboard built with Vite, Turbo, and TanStack Router.

## Project Structure

- `apps/web` - Main application with TanStack Router and React Query
- `packages/ui` - Shared UI components built with Radix UI and Tailwind CSS

## Build & Development Commands

```bash
# Build all packages
turbo build

# Development mode (all packages)
turbo dev

# Lint all packages
turbo lint

# Format all packages
turbo format

# Type check all packages
turbo typecheck

# Run commands for specific package
turbo lint --filter=web
turbo build --filter=@workspace/ui
```

Note: No test framework is currently configured. When adding tests, set up Vitest or Jest.

## Code Style Guidelines

### Imports

Import order (grouped, sorted within groups):

1. React and external packages
2. Local components (`@/components/*` or `@workspace/ui/components/*`)
3. Utils, hooks, types

```typescript
import * as React from "react"
import { Link } from "@tanstack/react-router"
import { Button } from "@workspace/ui/components/button"
import { NavMain } from "@/components/nav-main"
import { cn } from "@workspace/ui/lib/utils"
```

### Component Structure

Components files start with `"use client"` directive at the top. Use named exports for both components and utilities.

```typescript
"use client"

import * as React from "react"

export function MyComponent({ prop }: MyComponentProps) {
  return <div>...</div>
}
```

### TypeScript

- Strict mode enabled
- Use `React.ComponentProps` for spreading native element props
- Use `VariantProps` from class-variance-authority for variant types
- Declare module augmentations in separate blocks

```typescript
function Button({
  className,
  variant,
  ...props
}: React.ComponentProps<"button"> & {
  variant?: "default" | "outline"
}) {
  // ...
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
```

### Styling with Tailwind CSS

- Use `cn()` utility for merging Tailwind classes
- Use `cva()` for component variants with class-variance-authority
- Prefer data attributes over arbitrary values for theming
- Use semantic class names from Tailwind v4

```typescript
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@workspace/ui/lib/utils"

const variants = cva("base-classes", {
  variants: {
    size: { default: "h-8", sm: "h-6" }
  },
  defaultVariants: { size: "default" }
})

export function MyComponent({ className, size, ...props }: MyComponentProps) {
  return <div className={cn(variants({ size, className }))} {...props} />
}
```

### Naming Conventions

- **Components**: PascalCase (`AppSidebar`, `Button`)
- **Hooks**: camelCase with `use` prefix (`useIsMobile`, `useEffect`)
- **Utilities**: camelCase (`cn`, `formatDate`)
- **Constants**: UPPER_SNAKE_CASE (`MOBILE_BREAKPOINT`)
- **Interfaces/Types**: PascalCase (`ButtonProps`, `VariantProps`)

### Error Handling

When fetching data with TanStack Query, handle errors in error boundaries or use the `useErrorBoundary` hook. Component errors should use error boundaries.

### Formatting

- **No semicolons** (Prettier rule)
- **Double quotes** for strings
- **Trailing commas** in objects and arrays
- **2 space indentation**
- **80 character line width**

Running `turbo format` applies Prettier automatically. The codebase uses prettier-plugin-tailwindcss to sort Tailwind classes.

### ESLint & TypeScript

Run `turbo typecheck` before committing. The project uses TypeScript ESLint with:

- `typescript-eslint` for TypeScript rules
- `eslint-plugin-react-hooks` for React hooks rules
- `eslint-plugin-react-refresh` for fast refresh in Vite

Always run `turbo lint` and `turbo typecheck` to ensure code quality.

### Key Libraries

- **Router**: TanStack Router - file-based routing with type-safe navigation
- **State**: TanStack Query - server state management
- **UI**: Radix UI primitives, shadcn/ui patterns
- **Icons**: Tabler Icons via `@tabler/icons-react`
- **Styling**: Tailwind CSS v4, class-variance-authority
- **Utilities**: clsx, tailwind-merge, ahooks

### Workspace Package Usage

Import from workspace packages using the configured path aliases:

```typescript
// From apps/web, import UI components:
import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
```

Path aliases are defined in each package's tsconfig.json:

- `@/*` → `./src/*` (in apps/web)
- `@workspace/ui/*` → `../../packages/ui/src/*` (in apps/web)
- `@workspace/ui/*` → `./src/*` (in packages/ui)
