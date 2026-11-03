# Security Policy

CallMeClaude lets a voice conversation operate a computer and its Claude Code sessions. Please treat security issues seriously and report them privately.

## Reporting a vulnerability

Use **GitHub → Security → Report a vulnerability** (private security advisories) on this repository. Please don't open public issues for vulnerabilities. Include the version or commit, a description, and the impact. A proof of concept is welcome, but don't run it against anyone else's machine.

## In scope

- The hub's network surface: the hook server on `127.0.0.1:47800` and the app WebSocket on `:47801`
- Pairing and authentication (app token, hook token)
- Bypassing the confirmation and policy paths (risky actions without explicit voice confirmation)
- Prompt injection that escalates through computer use or session instructions
- Leaking secrets: Keychain items, pairing token, Claude credentials, transcripts sent to the voice provider

## Design notes

- Hooks are accepted only from localhost and with a per-install bearer token.
- The phone authenticates with a random token from `cmc pair`. Run `cmc pair --rotate` to revoke it. Expose port 47801 only on your tailnet or LAN; never port-forward it to the internet.
- Secrets (Gemini key, APNs key) live in the macOS Keychain. Config and state live in `~/.callmeclaude` (mode 0700).
- The hub never reads or forwards Claude OAuth tokens; Claude Code handles authentication itself.
- Only summaries are sent to the voice provider, and obvious secrets are redacted first.

See [docs/08-security.md](docs/08-security.md) for the threat model.
