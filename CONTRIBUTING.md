# Contributing

Thanks for helping. CallMeClaude is small and pragmatic. These notes keep it that way.

## Getting started

```bash
pnpm install
cd apps/mac-agent
pnpm typecheck
pnpm test                 # end-to-end hook/hold/call tests in an isolated CMC_HOME (no real phone, no Gemini)
node bin/cmc.mjs serve    # run the hub in the foreground (stop the launchd one first: launchctl bootout gui/$(id -u)/dev.callmeclaude.hub)
```

For the iOS app, run `./scripts/ios-install.sh`, or see [apps/ios/README.md](apps/ios/README.md). The phone sends its logs to the hub (`~/.callmeclaude/logs/app-*.log`), so most call bugs can be debugged from the Mac.

## Ground rules

- **Never commit secrets or personal data.** API keys, `.p8` files, pairing tokens, Team IDs, Tailscale addresses, real project names and transcripts all stay out. `apps/ios/Config/Local.xcconfig` is git-ignored for this reason. If you paste logs into an issue, redact them first.
- **Subscription model:** the hub may reach Claude only through the user's own local Claude Code / Agent SDK login. PRs that proxy, share or extract Claude credentials will not be accepted. See [ADR-0002](docs/adr/0002-subscription-auth.md).
- **Safety first:** anything that acts on the user's machine or accounts must go through the policy and confirmation paths ([docs/08-security.md](docs/08-security.md)). Do not add new ways to bypass them.
- **Keep the phone dumb:** logic lives in the hub. The app rings, streams audio and shows state.
- **Architecture changes get an ADR** in `docs/adr/`.
- New voice providers implement the voice session interface in `apps/mac-agent/src/voice/`. New computer-use drivers plug into `src/brain.ts` as MCP servers.

## Code style

- TypeScript strict, ESM, Node 22.5+, no build step (`tsx`). Prefer the standard library over new dependencies.
- Swift 5, SwiftUI, no third-party pods.
- Everything in the code base is in English: identifiers, comments, CLI output, app UI and prompts. The *spoken* language is a runtime setting (`config.language`, BCP-47). Prompts tell the voice model to speak that language, so don't hard-code any other spoken language.

## Pull requests

1. One focused change per PR, with a short description of *why*.
2. `pnpm typecheck && pnpm test` passes, and `./scripts/ios-install.sh --no-install` builds if you touched the app.
3. For call, audio or permission changes, describe how you tested them on a real device.
