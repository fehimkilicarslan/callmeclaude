# 02 · Mimari

## Genel görünüm

```
┌──────────────────────────────── Mac (Hub host) ─────────────────────────────────┐
│                                                                                  │
│  Claude Code oturumları  (terminal / IDE / Desktop "Code" / tmux içinde `cmc run`)│
│     │  HTTP hooks (localhost)     │ transcript .jsonl    │ tmux / channel / resume│
│     ▼                             ▼                      ▲                        │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐                  │
│  │ Hook Server  │──▶│ Session Registry │◀──│ Transcript Tailer│                  │
│  └──────┬───────┘   └────────┬─────────┘   └──────────────────┘                  │
│         │ (hold-open)        │ olaylar                                            │
│         ▼                    ▼                                                    │
│  ┌──────────────┐   ┌──────────────────┐   ┌──────────────────┐                  │
│  │ Session      │◀──│ Stuck Detector + │──▶│ Call Scheduler   │── VoIP push ──┐  │
│  │ Controller   │   │ Event Classifier │   │ (öncelik, batch) │   (APNs/FCM)  │  │
│  └──────▲───────┘   └──────────────────┘   └────────┬─────────┘               │  │
│         │                                           ▼                          │  │
│  ┌──────┴───────────────────────────┐     ┌──────────────────┐                 │  │
│  │ Brain (Claude Agent SDK,         │◀───▶│ Voice Gateway    │◀═ ses (WebRTC/  │  │
│  │  kullanıcının claude login'i)    │tools│ (Gemini Live /   │   WS, Tailscale)│  │
│  │  araçlar: sessions.*, desktop.*, │     │  ElevenLabs)     │                 │  │
│  │  browser.*, notify.*             │     └──────────────────┘                 │  │
│  └──────┬───────────────────────────┘                                          │  │
│         ▼                                                                      │  │
│  ┌──────────────────────────────────┐   ┌──────────────┐  ┌───────────────┐   │  │
│  │ Computer Use (MCP): Chrome MCP,  │   │ Policy &     │  │ Audit Log +   │   │  │
│  │ cua-driver, Peekaboo             │   │ Approvals    │  │ screenshots   │   │  │
│  └──────────────────────────────────┘   └──────────────┘  └───────────────┘   │  │
└────────────────────────────────────────────────────────────────────────────────┼──┘
                                                                                 ▼
                                          ┌──────────── Telefon ─────────────────────┐
                                          │ CallKit/Telecom UI ─ Audio ─ Bluetooth HFP│
                                          │ Hub client (WS control + audio stream)    │
                                          │ Heartbeat watcher ("Mac offline" uyarısı) │
                                          └───────────────────────────────────────────┘
```

## Bileşenler

### Hub süreci (`apps/mac-agent`)
- **Dil/çalışma ortamı:** TypeScript, Node 22+ (Agent SDK TS, MCP SDK, `ws`, Fastify). Tek süreç, launchd `KeepAlive` ile.
- **Durum deposu:** `~/.callmeclaude/state.json` (atomik yazım) + `audit/*.jsonl` + `logs/`.
- **CLI:** `cmc setup | status | run | logs | call-me | doctor | panic`.

| Modül | Sorumluluk |
|---|---|
| `hooks/` | `127.0.0.1:47800/hooks/:event` HTTP hook uç noktaları. Bazı olaylarda isteği **açık tutar** (hold-open) ve developer'ın kararını bekler. |
| `sessions/` | Session Registry: `session_id → {project, cwd, pid, tty/tmux pane, state, lastMessage, startedAt}`; süreç keşfi (`ps`), transcript tail. |
| `detector/` | Olay → durum makinesi (`running / waiting_permission / waiting_input / blocked / done / errored / stale`). "Yapamam" tipi mesajlar için Haiku sınıflandırıcı. |
| `controller/` | Oturuma talimat iletme stratejileri (hook yanıtı → channel → tmux → resume), interrupt, yeni oturum başlatma. |
| `brain/` | Claude Agent SDK `query()` döngüsü; Hub araçlarını MCP olarak sunar; brifing ve kısa özet üretir. |
| `voice/` | `VoiceProvider` arayüzü + adaptörler (`gemini-live`, `elevenlabs`); telefonla ses köprüsü; araç çağrılarını Brain'e yönlendirir. |
| `calls/` | Call Scheduler: öncelik, toplama (batching), sessiz saatler, tekrar deneme; APNs/FCM gönderici. |
| `computer/` | Computer-use MCP sunucularının yaşam döngüsü, kilit (aynı anda tek kontrolör), ekran görüntüsü kaydı. |
| `policy/` | Risk seviyeleri, onay gereksinimleri, panik modu. |
| `transport/` | Telefon bağlantısı: WebSocket (kontrol) + WebRTC/Opus veya WS-PCM (ses). Yalnızca Tailscale arayüzünde dinler; cihaz eşleştirme anahtarı. |

### iOS uygulaması (`apps/ios`)
- SwiftUI + CallKit + PushKit + AVAudioEngine (voice processing). Ses WebSocket ikili çerçeveleriyle (PCM16) taşınır.
- "Aptal terminal" felsefesi: iş mantığı Hub'da. Uygulama: çağrı UI, ses akışı, eşleştirme, durum listesi, son olaylar, Siri/App Intent "Claude'u ara".

### Ortak paket (`packages/protocol`)
- Hub ↔ App mesaj tipleri ve sürümleme. Bkz. [protocol.md](protocol.md).

## Ana akışlar

### Akış 1 — Tıkanma → arama → çözüm
```
Claude Code ─Stop hook (HTTP)─▶ Hub.hooks   [istek açık tutulur, timeout T]
Hub.detector: son mesaj = "formu gönderemem, onay gerekiyor" → blocked:needs_approval
Hub.brain: 1-2 cümlelik telefon özeti üretir
Hub.calls: VoIP push ─▶ Telefon çalar ─▶ interkomdan cevap
Voice: "Acme'da form hazır, gönderme onayı bekliyor. Göndereyim mi?"
Dev: "Gönder, tam yetkilisin."
Voice ─tool: resolve_pending(id, instruction)─▶ Brain
Brain: policy kontrolü (form gönderme = risk:medium, sesli onay alındı ✓)
Brain ─▶ Controller: Stop hook yanıtı = {"decision":"block","reason":"Kullanıcı onayladı: formu gönder ve devam et."}
Claude Code devam eder. Eğer ajan yine yapamazsa → Brain computer-use ile kendi tıklar → doğrular → oturuma "Form gönderildi, devam et" iletir.
Voice: "Gönderildi. Ajan devam ediyor."
```
Hook timeout dolarsa: hook boş döner (oturum normal durur), karar kuyruğa alınır; cevap gelince `channel`/`tmux`/`resume` ile iletilir.

### Akış 2 — Developer arıyor
```
App "Claude'u ara" ─▶ WS connect (Tailscale) ─▶ Hub.voice.startSession()
Hub: önceden hesaplanmış brifing'i ses modeline sistem bağlamı olarak verir (gecikme ≈ 0)
Dev soruları → ses modeli basit olanları brifingden cevaplar, gerisini tools ile Brain'e sorar
```

### Akış 3 — Arama sırasında yeni olay
Aktif aramada yeni bir olay gelirse ayrı arama başlatılmaz; ses oturumuna "araya giren bilgi" olarak enjekte edilir: *"Bu arada API projesi bitti."*

## Teknoloji seçimleri (özet)

| Alan | Seçim | Alternatif | Gerekçe |
|---|---|---|---|
| Hub dili | TypeScript / Node 22 | Swift, Python | Agent SDK TS + MCP + ses SDK'ları; topluluk katkısı kolay |
| macOS izin taşıyıcı | Küçük Swift helper app (v1.x) | Node binary'ye TCC izni | Accessibility / Screen Recording izinlerinin imzalı bir bundle'a verilmesi daha stabil |
| Brain | Claude Agent SDK (kullanıcının login'i) | `claude -p` alt süreç | Araç tanımı, MCP, oturum yönetimi |
| Ses | Gemini Live (MVP) + ElevenLabs Agents | Pipecat kaskad | Bkz. [ADR-0003](adr/0003-two-layer-voice.md) |
| Ağ | Tailscale | WireGuard, Cloudflare Tunnel | Sıfır port açma, ücretsiz, mobil uygulaması var |
| Mobil | Native Swift (iOS) — [ADR-0005](adr/0005-native-ios-app.md) | React Native | CallKit + PushKit + voice processing doğrudan; Android ileride Kotlin |
| Depo | Atomik yazılan JSON (`state.json`, `devices.json`) + JSONL audit | SQLite | Bağımlılıksız; veri hacmi küçük |
