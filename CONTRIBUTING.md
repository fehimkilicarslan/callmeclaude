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

On Linux the same commands work; stop the systemd user service instead of launchd, and start it again afterwards:

```bash
systemctl --user stop dev.callmeclaude.hub     # instead of launchctl bootout …
node bin/cmc.mjs serve
systemctl --user start dev.callmeclaude.hub    # or: cmc restart
CMC_REQUIRE_X11=1 pnpm test                    # as in CI: the X11 driver test fails instead of skipping without Xvfb, xdotool and scrot
```

Use a throwaway `CMC_HOME=$(mktemp -d)` when you try `cmc setup --no-hooks --no-service` or `cmc doctor` without touching your real `~/.callmeclaude`. The service logs go to `~/.callmeclaude/logs/systemd.*.log` (`launchd.*.log` on macOS).

For the iOS app, run `./scripts/ios-install.sh`, or see [apps/ios/README.md](apps/ios/README.md). The phone sends its logs to the hub (`~/.callmeclaude/logs/app-*.log`), so most call bugs can be debugged from the Mac.

For the Android app you need JDK 17 and the Android SDK; see [apps/android/README.md](apps/android/README.md):

```bash
cd apps/android
./gradlew assembleDebug test        # what CI runs; add lintDebug before a PR
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Desk phone (Linux)

`apps/mac-agent/scripts/desk-phone.mts` acts as the phone app on a Linux desktop and carries the call audio through PipeWire (`pw-record`, `pw-play`), so you can test calls without a phone. It reads the hub address and token from the config (`CMC_HOME` works too) and is the reference client for the iOS and Android apps. Use headphones: there is no echo cancellation.

```bash
cd apps/mac-agent
node --import tsx scripts/desk-phone.mts            # wait for the hub to ring (cmc call-me) and answer
node --import tsx scripts/desk-phone.mts --call     # call the hub now; exits when the call ends
node --import tsx scripts/desk-phone.mts --call --input question.wav --record-out answer.wav --no-speaker   # scripted run
```

`--input` takes a PCM16 16 kHz mono wav; `--url ws://…` and `--token …` point it at another hub. Ctrl+C hangs up. It needs PipeWire's tools (Arch: `pipewire`, Debian/Ubuntu: `pipewire-bin`) and a running hub with a Gemini key.

## Ground rules

- **Never commit secrets or personal data.** API keys, `.p8` files, pairing tokens, Team IDs, Tailscale addresses, real project names and transcripts all stay out. `apps/ios/Config/Local.xcconfig` is git-ignored for this reason. If you paste logs into an issue, redact them first.
- **Subscription model:** the hub may reach Claude only through the user's own local Claude Code / Agent SDK login. PRs that proxy, share or extract Claude credentials will not be accepted. See [ADR-0002](docs/adr/0002-subscription-auth.md).
- **Safety first:** anything that acts on the user's machine or accounts must go through the policy and confirmation paths ([docs/08-security.md](docs/08-security.md)). Do not add new ways to bypass them.
- **Keep the phone dumb:** logic lives in the hub. The app rings, streams audio and shows state.
- **Architecture changes get an ADR** in `docs/adr/`.
- New voice providers implement the voice session interface in `apps/mac-agent/src/voice/`. New computer-use drivers plug into `src/brain.ts` as MCP servers.
- Everything that differs per operating system lives behind `apps/mac-agent/src/platform/` (`darwin.ts`, `linux.ts`). Linux computer-use drivers are chosen by the pure `selectComputerDriver` in `src/platform/computerUse.ts`; add a desktop there, with tests. macOS output must stay byte-for-byte the same: the tests compare it with fixtures in `apps/mac-agent/test/fixtures/`.

## Code style

- TypeScript strict, ESM, Node 22.5+, no build step (`tsx`). Prefer the standard library over new dependencies.
- Swift 5, SwiftUI, no third-party pods.
- Everything in the code base is in English: identifiers, comments, CLI output, app UI and prompts. The *spoken* language is a runtime setting (`config.language`, BCP-47). Prompts tell the voice model to speak that language, so don't hard-code any other spoken language.

## Pull requests

1. One focused change per PR, with a short description of *why*.
2. `pnpm typecheck && pnpm test` passes, and `./scripts/ios-install.sh --no-install` builds if you touched the app (`./gradlew assembleDebug test` in `apps/android` for the Android app).
3. For call, audio or permission changes, describe how you tested them on a real device.
