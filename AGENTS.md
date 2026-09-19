# Project instructions for Codex

Read and follow [CLAUDE.md](CLAUDE.md) before working in this repository. It is
the shared source for project architecture, coding conventions, Firebase data
patterns, environment variable names, and design context. Its project guidance
applies to Codex as well as Claude Code. Keep shared guidance there so the two
agents stay aligned.

## Current repository details

When older descriptions in CLAUDE.md conflict with the implementation, use
`package.json` and the relevant configuration or source files to verify current
behavior. In particular:

- The project currently declares Nuxt `^4.0.0`, uses `srcDir: '.'`, and has
  `ssr: false` in `nuxt.config.ts`.
- Use pnpm 10.11.0. Common commands are `pnpm dev`, `pnpm build`,
  `pnpm preview`, and `pnpm exec eslint .`.
- Run tests once with `pnpm test --run`; `pnpm test` starts Vitest's interactive
  mode. The root Vitest configuration excludes `functions/**`.
- Capacitor iOS support is present. `pnpm app:sync` generates the native build
  and syncs Capacitor; `pnpm app:ios` also opens the iOS project. These commands
  modify generated/native files, so use them when working on the native app.
- With `BUILD_TARGET=app`, the Nuxt configuration disables the PWA module and
  VueFire session cookies; native builds use client Firebase authentication.

## Skills and tool settings

Project skills are available in `.agents/skills/`. Use the relevant skill's
`SKILL.md` when the task calls for it. The existing `.claude/skills/` directory
also contains Claude's project skills.

`.claude/settings.local.json` contains Claude-specific tool permissions. It is
not a Codex configuration file; Codex tool access follows the active session's
permissions and approval settings.
