# Installation

This guide takes you from zero to "my phone rings when Claude Code gets stuck" in about 30 minutes. Each step ends with a check you can run.

**Contents**

1. [Prerequisites](#1-prerequisites)
2. [Install the hub on your Mac](#2-install-the-hub-on-your-mac)
3. [Voice: Gemini API key](#3-voice-gemini-api-key)
4. [Install the iPhone app](#4-install-the-iphone-app)
5. [Let the Mac ring your phone: APNs key](#5-let-the-mac-ring-your-phone-apns-key)
6. [Pair the phone](#6-pair-the-phone)
7. [Reach your Mac from anywhere: Tailscale](#7-reach-your-mac-from-anywhere-tailscale)
8. [macOS permissions for computer use](#8-macos-permissions-for-computer-use)
9. [Keep the Mac awake while you are away](#9-keep-the-mac-awake-while-you-are-away)
10. [First test](#10-first-test)
- [Troubleshooting](#troubleshooting) · [Uninstall](#uninstall)

---

## 1. Prerequisites

| | Install |
|---|---|
| macOS 15+ and Xcode 16+ | App Store |
| Homebrew | https://brew.sh |
| Node.js 22.5+ and pnpm | `brew install node pnpm` (or nvm) |
| Claude Code, logged in to **your own** Pro/Max plan | https://claude.com/claude-code, then run `claude` once and log in |
| Tools used by the hub | `brew install tmux cliclick xcodegen steipete/tap/peekaboo` |
| A paid Apple Developer account | https://developer.apple.com/programs/ (VoIP push needs it; free accounts can't receive VoIP pushes and their builds expire after 7 days) |

Check: `claude --version && node --version && tmux -V && xcodegen --version`

## 2. Install the hub on your Mac

```bash
git clone https://github.com/wutlu/callmeclaude.git
cd callmeclaude
pnpm install
ln -s "$PWD/apps/mac-agent/bin/cmc.mjs" /opt/homebrew/bin/cmc   # or anywhere on your PATH
cmc setup
```

`cmc setup` does three things:

- **Merges** CallMeClaude's HTTP hooks into `~/.claude/settings.json`. It backs the file up first (`settings.json.cmc-backup-*`) and never touches your other hooks. `cmc uninstall` removes only its own hooks.
- Installs a **launchd agent** (`~/Library/LaunchAgents/dev.callmeclaude.hub.plist`) that starts at login and restarts if it crashes.
- Creates `~/.callmeclaude/` (config, state, logs, audit). It starts in **desk mode**, so nothing is held and nobody gets called until you switch modes.

Check: `cmc status` lists your open Claude Code sessions (start one with `claude` in any folder).

## 3. Voice: Gemini API key

1. Create a key at https://aistudio.google.com/apikey.
2. Store it in the macOS Keychain:
   ```bash
   cmc setup --gemini-key <YOUR_KEY> --no-hooks --no-service
   ```

The voice model is `gemini-3.8-live` by default; change it with `--model`. The key never leaves your Mac except to call Google directly.

**Conversation language.** Claude speaks English by default. To use another language, run `cmc setup --language tr-TR --no-hooks --no-service` (any BCP-47 code, e.g. `de-DE`, `es-ES`, `ja-JP`), choose it in the app under Settings → Voice language, or tell Claude on a call: "from now on speak Turkish". The app UI and CLI stay in English.

Check: `cmc doctor` shows `✅ Gemini API key`.

## 4. Install the iPhone app

Connect the iPhone with a USB cable, unlock it, and tap "Trust this computer". Then run:

```bash
./scripts/ios-install.sh
```

The script asks for your **Apple Team ID** and a **unique bundle id** (for example `com.yourname.callmeclaude`) and writes them to `apps/ios/Config/Local.xcconfig`, which is git-ignored. It then generates the Xcode project, builds with automatic signing (`-allowProvisioningUpdates` creates a provisioning profile with Push enabled), and installs and launches the app on the connected iPhone.

You can find your Team ID at https://developer.apple.com/account → Membership details. Xcode must be signed in to that account (Xcode → Settings → Accounts).

On first launch, allow **Microphone**, **Camera** (for the QR code) and **Local Network**. Also enable Settings → CallMeClaude → **Siri & Search** if you want the "Hey Siri, call CallMeClaude" shortcut.

To do the same steps by hand, see [apps/ios/README.md](apps/ios/README.md).

## 5. Let the Mac ring your phone: APNs key

Without this step you can still call the hub from the app, but the hub can only call you while the app is open in the foreground.

1. Go to https://developer.apple.com/account/resources/authkeys/list, click **+**, tick **Apple Push Notifications service (APNs)**, then **Configure**. Choose environment **Sandbox & Production** and **Team Scoped**, then **Save → Continue → Register → Download**. You can download the `.p8` file only once, so keep it safe.
   - One APNs key works for every app in your team. If you already have one (Apple allows only a few), reuse it.
2. Store it in the Keychain:
   ```bash
   cmc setup --no-hooks --no-service \
     --apns-key-file ~/Downloads/AuthKey_XXXXXXXXXX.p8 \
     --apns-key-id XXXXXXXXXX \
     --team-id <TEAM_ID> \
     --bundle-id <the bundle id from step 4> \
     --apns-env development      # Xcode-installed builds use the APNs sandbox
   cmc restart
   ```
3. Delete the downloaded `.p8` from your Downloads folder if you like; the hub keeps its copy in the Keychain.

Check: `cmc doctor` shows `✅ APNs` and, after pairing, `✅ Phone registered (VoIP token)`.

## 6. Pair the phone

```bash
cmc pair
```

A QR code appears in the terminal and in a window. In the app, tap **Pair Mac** and scan it. The QR contains the hub's addresses (Tailscale IP and name, LAN IP) and a random access token. Anyone holding this token can talk to your hub, so don't share it. Run `cmc pair --rotate` to issue a new token; the old pairing then stops working.

Check: the app shows a green dot and "Connected: <your Mac>".

## 7. Reach your Mac from anywhere: Tailscale

The phone talks to the Mac directly, with no relay in between. To make that work on cellular:

1. Install Tailscale on the Mac (Mac App Store, or `brew install --cask tailscale-app`) and log in.
2. Install Tailscale on the iPhone (App Store) and log in with **the same account**. Keep the VPN on.
3. Run `cmc pair` again and re-scan, so the QR includes the Tailscale addresses.

Check: turn Wi-Fi off on the phone, tap **Call Claude**, and ask "what's the status?".

## 8. macOS permissions for computer use

The hub can operate the Mac for you (`cmc do "…"` or "click submit" on a call). It runs as `node` under launchd, so macOS needs to trust that binary:

- System Settings → Privacy & Security → **Screen & System Audio Recording** → add and enable your `node` binary (`cmc doctor` prints its path, e.g. `~/.nvm/versions/node/v24.x/bin/node` or `/opt/homebrew/bin/node`).
- Same place → **Accessibility** → add and enable `node`.
- Allow the "node wants to control System Events" prompt when it appears.
- Peekaboo has its own permissions: `peekaboo permissions`.

Check: `cmc do "Which app is in front? Just look, don't click."` names the correct window.

## 9. Keep the Mac awake while you are away

```bash
# no system sleep (asks for your password)
osascript -e 'do shell script "pmset -a sleep 0" with administrator privileges'
# desktops only: power back on after a power cut
osascript -e 'do shell script "pmset -a autorestart 1" with administrator privileges'
# laptops: don't sleep with the lid closed (undo with disablesleep 0)
osascript -e 'do shell script "pmset -a disablesleep 1" with administrator privileges'
```

Leave a laptop on its charger; the battery acts as a UPS. Give a desktop a UPS. If FileVault is on, the Mac needs your password after an unplanned reboot, so the hub can't start until someone types it in. A UPS avoids that situation. For a long trip, also add a backup internet connection (a 4G/5G router). See [docs/09-unattended-operation.md](docs/09-unattended-operation.md) for the full pre-trip checklist.

## 10. First test

```bash
cmc doctor             # everything ✅
cmc call-me            # lock your phone first: it should ring like a normal call
cmc mode away          # now stuck or finished sessions call you (ride = shorter sentences)
cmc run . "Create hello.txt, then ask me whether to also create bye.txt and stop."
```

The last command starts a Claude Code session in tmux. When it asks its question, your phone rings. Answer "yes, create it", and the session continues.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cmc status`: hub not running | `cmc logs`, then `cmc restart`. Look at `~/.callmeclaude/logs/launchd.err.log` |
| Sessions don't show up | `cmc doctor` → hooks installed? Sessions started **before** `cmc setup` need a restart |
| The phone never rings | `cmc doctor` → APNs + VoIP token. Builds installed from Xcode need `--apns-env development` |
| The call connects but there's no audio | Look at `~/.callmeclaude/logs/app-*.log` (the phone ships its logs to the hub) and the `call.stats` lines in `~/.callmeclaude/audit/*.jsonl` (`micSeconds` / `outSeconds`) |
| Stuck on "Connecting…" on cellular | Is Tailscale on for both devices? Re-run `cmc pair` and re-scan |
| The hub sees only the wallpaper during computer use | Grant Screen Recording and Accessibility to the `node` binary (step 8), then `cmc restart` |
| Claude Code asks "trust this folder?" for a new session | Run `claude` in that folder once yourself, or keep projects under a folder listed in `projectRoots` in `~/.callmeclaude/config.json` |

## Uninstall

```bash
cmc uninstall                                  # removes our hooks + the launchd agent
rm -rf ~/.callmeclaude                         # config, state, logs, audit
security delete-generic-password -s dev.callmeclaude -a gemini-api-key
security delete-generic-password -s dev.callmeclaude -a apns-p8
```

Then delete the app from the iPhone.
