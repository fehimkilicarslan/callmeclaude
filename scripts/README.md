# scripts/

| Script | |
|---|---|
| `ios-install.sh` | Build the iPhone app and install it on a USB-connected iPhone (asks for Team ID + bundle id once) |

Developer helpers for the hub live in `apps/mac-agent/scripts/`:

| Script | |
|---|---|
| `voice-check.mts` | Measure Gemini Live connect / first-audio latency |
| `computer-check.mts` | Smoke-test the computer-use path (read-only task) |
| `fake-phone.mts` | Act as the phone over WebSocket and answer pending decisions (end-to-end testing without a phone) |

Run them with `node --import tsx <script>` from `apps/mac-agent`.
