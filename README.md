<p align="center">
  <img src="apps/ios/CallMeClaude/Assets.xcassets/AppIcon.appiconset/icon.png" width="96" alt="CallMeClaude icon">
</p>

<h1 align="center">CallMeClaude</h1>

<p align="center">
  <b>Your Claude Code agents call you when they get stuck. You answer from your helmet, your car or your couch.</b><br>
  Open source · self-hosted · runs on <i>your own</i> Claude subscription · no SaaS, no accounts, no relay servers
</p>

<p align="center">
  <a href="INSTALLATION.md">Installation</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="docs/">Design docs</a> ·
  <a href="README.tr.md">Türkçe</a>
</p>

---

Claude Code can work for hours on its own, until it stops to ask for a permission, says *"I can't submit this form without your approval"*, or finishes and waits for the next instruction. Each time, you have to go back to the keyboard.

**CallMeClaude takes the keyboard out of that loop.** A small agent on your Mac watches every Claude Code session in real time. When a session gets stuck or finishes, it **rings your iPhone like a real phone call** and tells you what happened in two short sentences. You answer through your motorcycle intercom, AirPods or the phone itself, and say what to do:

> 📞 **Claude:** "acme-web: the application form is filled in and waiting for your OK. Should I submit it?"
> 🧑 **You:** "Send it, you have full authority. Then move on to the email draft."
> 📞 **Claude:** "Submitted, the confirmation page is open. The agent moved on to the email."

You can also call Claude yourself at any time ("Hey Siri, call CallMeClaude"). Ask for a status update, start new sessions, approve permissions, or have the Mac click through something in the browser for you.

## Features

- **Watches every Claude Code session**: terminal, IDE or desktop app. It uses Claude Code's official HTTP hooks and patches nothing.
- **Understands why a session stopped**: a permission prompt, a question, "I can't do this", a finished task or an API error. Claude Haiku does the classification on your own plan.
- **Rings your phone for real** with PushKit and CallKit. It works on the lock screen, the Bluetooth or intercom answer button works, and calls show up in Recents.
- **Natural, interruptible voice**: Gemini Live speech-to-speech with about one second of latency. It talks like a phone call: short sentences, no file paths, one question at a time.
- **Speaks your language**: pick the conversation language in the app or with `cmc setup --language` (`en-US`, `tr-TR`, `de-DE`, `es-ES`, …). Claude speaks it on calls and writes session summaries in it. You can also say "from now on speak German". The app and CLI themselves are in English.
- **Unblocks sessions remotely**. It holds a stopped session open and continues it with your spoken instruction (`Stop` hook `decision: block`). It can also answer permission prompts, type into tmux sessions, resume ended sessions, or queue the instruction for the next step.
- **Uses the computer for you** when an agent can't, with Claude in Chrome, [Peekaboo](https://github.com/steipete/Peekaboo) and `cliclick`. It always asks for explicit voice confirmation first.
- **Built for unattended days away**: a launchd service, sleep-prevention checks, Tailscale for cellular access, calls that survive reconnects, a panic switch and a full audit log.

## How it works

```
        Mac (stays at home)                                   iPhone (with you)
 ┌──────────────────────────────────────┐              ┌─────────────────────────┐
 │  Claude Code sessions                │              │  CallKit incoming call  │
 │        │ HTTP hooks (127.0.0.1)      │   VoIP push  │  (lock screen, Recents) │
 │        ▼                             │  ──────────▶ │           │             │
 │  Hub  (cmc, launchd service)         │  your APNs   │           ▼             │
 │   ├─ classifier  → Claude Haiku      │     key      │  Bluetooth HFP          │
 │   ├─ call scheduler                  │              │  → helmet intercom      │
 │   ├─ voice bridge → Gemini Live      │  ◀════════▶  │                         │
 │   └─ brain → Claude Agent SDK        │  PCM audio   │                         │
 │            + computer use            │  over        │                         │
 └──────────────────────────────────────┘  Tailscale   └─────────────────────────┘
```

- **Hub** (`apps/mac-agent`, TypeScript/Node): a launchd service with a `cmc` CLI. It receives Claude Code hooks on `127.0.0.1`, keeps session state, decides when to call, bridges the phone's audio to the voice model, and runs tools.
- **iOS app** (`apps/ios`, Swift): CallKit, PushKit, and AVAudioEngine with voice processing. It is a thin phone: it rings, streams audio and lists your sessions.
- **Two-layer voice**: a fast speech-to-speech model handles the conversation. Anything that matters goes through hub tools to **Claude** and to your sessions: instructions, approvals, questions about the code, computer use. See [ADR-0003](docs/adr/0003-two-layer-voice.md).

## Your subscription, your machine

CallMeClaude never sees, stores or forwards your Claude credentials. It reaches Claude only through the Claude Code you already installed and logged in to on your own Mac, via the Claude Agent SDK, for personal and local use. There is no central server and no shared account. Each install serves exactly one developer, and usage counts against your own plan limits. See [ADR-0002](docs/adr/0002-subscription-auth.md) and Anthropic's [guidance on using the Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).

Everything else is bring-your-own-key and talks directly to the vendor: a **Gemini API key** for voice and your **Apple APNs key** for ringing the phone. Keys are stored in the macOS Keychain.

## Requirements

| | |
|---|---|
| Mac | macOS 15+, Node 22.5+, pnpm, Homebrew, Xcode 16+ |
| Claude | Claude Code installed and logged in to your Pro/Max plan |
| Voice | A Gemini API key ([get one](https://aistudio.google.com/apikey)) |
| Phone | An iPhone on iOS 17+ and a **paid Apple Developer account** (VoIP push requires it) |
| On the road | [Tailscale](https://tailscale.com) on both the Mac and the iPhone (free for personal use) |

Android is on the [roadmap](docs/11-roadmap.md).

## Quick start

```bash
git clone https://github.com/wutlu/callmeclaude && cd callmeclaude
pnpm install
ln -s "$PWD/apps/mac-agent/bin/cmc.mjs" /opt/homebrew/bin/cmc

cmc setup --gemini-key <GEMINI_KEY> --language en-US   # hooks + launchd service; key → Keychain
./scripts/ios-install.sh              # build and install the iPhone app over USB
cmc pair                              # scan the QR code in the app
cmc call-me                           # your phone rings
```

The full guide, including APNs and Tailscale, is in **[INSTALLATION.md](INSTALLATION.md)**.

## Daily use

```bash
cmc status                                    # sessions and pending decisions
cmc mode away                                 # desk | away | ride | sleep: when the hub may call
cmc run ~/code/app "fix the failing tests"    # start Claude Code in tmux so the hub can type into it
cmc do "open the PR in Chrome and press Merge" # let the hub use the computer
cmc ignore ~/code/private                     # watch only: report status, never hold or call
cmc panic                                     # interrupt everything and pause automation (cmc resume)
cmc doctor                                    # check the whole setup
```

On the phone, tap **Call Claude**, or say *"Hey Siri, call CallMeClaude"*.

## Safety

This software can operate your computer by voice. The defaults are conservative:

- Risky actions need an explicit spoken confirmation: payments, deploys, `git push`, deleting, sending messages, computer use.
- Destructive shell commands and sensitive paths (`~/.ssh`, the Keychain, `.env`) are blocked for the hub's own agent.
- Web page content is treated as data, never as instructions.
- Everything goes into an append-only audit log in `~/.callmeclaude/audit`.

Read [docs/08-security.md](docs/08-security.md) and [SECURITY.md](SECURITY.md) before you rely on it.

## Project layout

```
apps/mac-agent/     Hub: hook server, session state, classifier, calls, voice bridge, CLI
apps/ios/           iPhone app (XcodeGen project)
packages/protocol/  Hub ↔ app message types
scripts/            install helpers
docs/               design docs, research and ADRs (in Turkish)
```

## Status

Early, but it works end to end on real devices: hooks → classification → VoIP call → voice conversation → instruction delivered to the session. Expect rough edges. Issues and PRs are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)

CallMeClaude is an independent open-source project. It is not affiliated with or endorsed by Anthropic or Google. "Claude" is a trademark of Anthropic.
