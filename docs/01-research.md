# 01 · Araştırma Raporu

> Tarih: 2026-11-03. Bu alan çok hızlı değişiyor; "⚠️ doğrula" ile işaretli maddeler uygulama başlamadan önce resmi kaynaktan tekrar kontrol edilmeli.

## 1. Claude aboneliği ile çalışmak (en kritik konu)

**Bulgu:** Anthropic, Şubat 2026'da Free/Pro/Max OAuth token'larının yalnızca Claude Code ve Claude.ai için olduğunu, **üçüncü tarafların kullanıcılara Claude.ai girişi sunmasının veya kullanıcı adına plan kimlik bilgileriyle istek yönlendirmesinin yasak** olduğunu netleştirdi. **Kişisel kullanım ve yerel geliştirme** için Agent SDK kullanımı ise açıkça kabul edilebilir olarak tanımlandı.

Help Center'ın güncel metnine göre (7 Ekim 2026 güncellemesi): Agent SDK, `claude -p` ve üçüncü taraf uygulama kullanımı **plan kullanım limitlerinden düşer**; Haziran 2026'da duyurulan ayrı "Agent SDK kredisi" değişikliği durduruldu. Max/Ultra/Team planlarındaki aylık API kredileri ise yalnızca Console API anahtarı ile kullanıldığında geçerli.

**CallMeClaude'a etkisi:**
- Hub, her developer'ın **kendi Mac'inde**, **kendi** `claude login` oturumunu kullanan Claude Agent SDK / `claude` CLI'ı çağırır. Bizim sunucumuz yok, token toplamıyoruz, kimseye giriş sunmuyoruz → kişisel kullanım modeli.
- OAuth token'ını **asla** okumayız, kopyalamayız, başka sürece/makineye taşımayız. Auth tamamen Claude Code'un kendisine bırakılır.
- Opsiyonel: kullanıcı isterse `ANTHROPIC_API_KEY` ile API modunda da çalışabilmeli (Max/Ultra API kredisi kullananlar için).
- Brain'in tüketimi plan limitinden düşeceği için: varsayılan olarak küçük model (Haiku) ile sınıflandırma, pahalı modeli yalnızca gerektiğinde kullanma; limit uyarısı.

Kaynaklar: [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) · [Monthly API credits](https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-ultra-and-team-plans) · [AlternativeTo haberi (Şubat 2026)](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use) · [Agent SDK docs](https://platform.claude.com/docs/en/agent-sdk)

## 2. Claude Code oturumlarını izleme ve yönlendirme

| Mekanizma | Ne verir | Not |
|---|---|---|
| **Hooks** (`~/.claude/settings.json`) | `SessionStart/End`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`, `PostToolUse(Failure)`, `Notification`, `Stop`, `StopFailure`, `SubagentStart/Stop`, `TaskCompleted`, `CwdChanged`, `PreCompact` … | **HTTP hook** tipi var: olay JSON'u doğrudan `http://localhost:PORT`'a POST edilir. Ortak alanlar: `session_id`, `transcript_path`, `cwd`, `permission_mode`. |
| `Notification` matcher'ları | `permission_prompt`, `idle_prompt`, `agent_needs_input`, `agent_completed`, `elicitation_dialog`, `quota_auto_resume_*` … | Tıkanmayı doğrudan söyler. |
| Hook yanıtları | `Stop` → `{"decision":"block","reason":"..."}` Claude'u **verilen gerekçeyle çalışmaya devam ettirir**. `PreToolUse`/`PermissionRequest` → `allow/deny/ask/defer`, `updatedInput`. | Oturuma uzaktan talimat iletmenin **resmi ve en temiz yolu**. |
| **Transcript JSONL** (`~/.claude/projects/<proj>/<session>.jsonl`) | Tüm mesajlar, araç çağrıları | Özet ve "son ne dedi" için tail edilir. Format resmi olarak sabit değil ⚠️ |
| **Channels** (research preview, v2.1.80+) | MCP sunucusunun **çalışan oturuma olay itmesi** | Özel kanal için `--dangerously-load-development-channels` gerekiyor; sözdizimi değişebilir ⚠️ |
| **Remote Control** (`claude rc`) | Oturuma telefondan/web'den devam | Bizim için rakip değil, tamamlayıcı; ses/proaktif arama yok. |
| `claude -p --resume <id>` | Kapanmış oturuma headless devam | Plan limitinden düşer. |
| tmux `send-keys` | Etkileşimli TUI'ye yazı göndermek | `cmc run` ile tmux içinde başlatılan oturumlar için tam kontrol. |

Kaynaklar: [Hooks reference](https://code.claude.com/docs/en/hooks.md) · [Channels yazısı](https://lilting.ch/en/articles/claude-code-channels-mcp-event-push) · [Remote Control haberi](https://gigazine.net/gsc_news/en/20260225-claude-code-remote-control) · [Remote Control rehberi](https://claudefa.st/blog/guide/development/remote-control-guide)

## 3. Gerçek zamanlı ses

İki mimari aile var:

**A) Speech-to-speech (tek model, native audio):** Ses doğrudan modele gider, model ses üretir. En düşük gecikme, doğal barge-in.
- **Gemini Live API** — WebSocket, native audio modelleri (2.5 Flash Native Audio GA on Vertex; 3.1 Flash Live preview), function calling, kesme (barge-in), gürültüde iyileştirilmiş kesme, `end_sensitivity` ayarı. Üçüncü taraf kaynaklara göre ~$3/1M ses girişi, ~$12/1M ses çıkışı (≈ dakikada $0.005 giriş / $0.018 çıkış) ⚠️ doğrula. Çok turlu oturumlarda kümülatif bağlam faturalanması sorusu forumda açık ⚠️.

**B) Kaskad (STT → LLM → TTS) / orkestre edilmiş platform:**
- **ElevenLabs Agents (eski adıyla Conversational AI)** — Yönetilen turn-taking, WebRTC (sesli) / WebSocket, `@elevenlabs/react` SDK, Swift SDK; React Native WebRTC desteği "yakında" denmişti ⚠️. **Custom LLM**: OpenAI uyumlu `/v1/chat/completions` veya `/v1/responses` sunan kendi sunucunu bağlayabilirsin; sistem araçları ve özel araçlar desteklenir. Türkçe ses kalitesi bu alandaki en güçlü seçenek kabul ediliyor.
- **Pipecat** (Python, açık kaynak) ve **LiveKit Agents** — kendi pipeline'ını kurmak için framework'ler. 2025-26 topluluk konsensüsü: Deepgram Nova-3 STT + ElevenLabs Flash v2.5 / Cartesia Sonic-3 TTS. Türkçe streaming STT desteği sağlayıcı bazında doğrulanmalı ⚠️.

**Sonuç:** Ses katmanı "hızlı ve kesilebilir resepsiyonist", Claude ise "arka plandaki beyin" olacak şekilde **iki katmanlı** tasarım (bkz. [04](04-voice.md), [ADR-0003](adr/0003-two-layer-voice.md)). Sağlayıcı soyutlanır; MVP'de **Gemini Live** (maliyet/gecikme), ikinci adaptör **ElevenLabs Agents** (ses kalitesi).

Kaynaklar: [Gemini Live API overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api) · [Gemini 2.5 Flash Live](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash-live-api) · [Gemini Live fiyat derlemesi](https://www.developersdigest.tech/voice-agents/gemini-live-api) · [Gemini Live analiz](https://rywalker.com/research/gemini-live-api) · [Faturalama forumu](https://discuss.ai.google.dev/t/does-gemini-live-native-audio-bill-cumulative-prompt-tokens-on-every-turn-cost-seems-to-scale-with-turn-count-not-call-duration/173248) · [ElevenLabs React SDK](https://elevenlabs.io/docs/conversational-ai/libraries/react) · [ElevenLabs WebRTC](https://elevenlabs.io/blog/conversational-ai-webrtc) · [ElevenLabs Custom LLM](https://elevenlabs.io/docs/eleven-agents/customization/llm/custom-llm) · [Pipecat vs LiveKit](https://www.forasoft.com/blog/article/pipecat-vs-livekit-agents) · [Voice framework karşılaştırması](https://dev.to/agdex_ai/best-voice-ai-agent-platforms-and-frameworks-in-2026-livekit-vs-pipecat-vs-vapi-vs-retell-47jk)

## 4. Telefonu "gerçek arama gibi" çaldırmak

- **iOS:** Uygulama kapalıyken çaldırmanın tek yolu **PushKit VoIP push + CallKit**. Push, APNs'e doğrudan Hub'dan (developer'ın kendi `.p8` anahtarıyla) gönderilebilir — aracı servis gerekmez. ⚠️ **Ücretli Apple Developer hesabı ($99/yıl) gerekir**: ücretsiz provisioning push entitlement'ı vermez ve 7 günde sona erer.
- **Android:** FCM high-priority data mesajı + `ConnectionService`/self-managed Telecom + full-screen intent. FCM için developer'ın kendi Firebase projesi. Alternatif (FCM'siz): Tailscale üzerinden kalıcı bağlantı tutan foreground service.
- **React Native kütüphaneleri:** `react-native-callkeep` yalnızca çağrı UI'ını yönetir, VoIP push'u ayrıca ele almanı gerektirir. Daha yeni seçenek **`expo-callkit-telecom`**: VoIP payload'ını JS çalışmadan native tarafta işleyip OS'a raporluyor; Software Mansion 2026 yazısında callkeep alternatifi olarak öneriliyor. Expo Go çalışmaz; `expo prebuild` / development build gerekir.
- **Interkom:** CallKit / Telecom aramaları Bluetooth HFP üzerinden normal arama gibi yönlenir → Sena/Cardo gibi interkomların "cevapla" tuşu çalışır.

Kaynaklar: [expo-callkit-telecom](https://github.com/mfairley/expo-callkit-telecom/wiki) · [react-native-callkeep alternatifleri 2026](https://swmansion.com/blog/react-native-callkeep-alternative-2026/) · [Native incoming calls rehberi](https://dev.to/maxwell_lin_d59a2746f8a27/native-incoming-calls-in-react-native-callkit-on-ios-full-screen-calls-on-android-671) · [Stream Expo ringing setup](https://getstream.io/video/docs/react-native/incoming-calls/ringing-setup/expo) · [PushKit + EAS tartışması](https://react-native-webrtc.discourse.group/t/integrating-pushkit-with-expo-eas-build-for-voip-notifications-any-workarounds/1998)

## 5. Masaüstü / tarayıcı kontrolü (computer use) — açık kaynak repolar

| Proje | Yaklaşım | Neden ilgilenelim |
|---|---|---|
| [**trycua/cua**](https://github.com/trycua/cua) | Computer-use agent platformu; **Cua Driver** (CLI + MCP) imleci/odağı çalmadan tıklama/yazma/doğrulama; Lume ile Apple Silicon VM | Kullanıcı yokken arka planda kontrol + istenirse izole macOS VM'de çalışma |
| [**steipete/Peekaboo**](https://steipete.me/posts/2025/peekaboo-mcp-lightning-fast-macos-screenshots-for-ai-agents) | macOS CLI + MCP: hızlı ekran görüntüsü + GUI otomasyonu | Olgun, MIT, MCP olarak doğrudan Agent SDK'ya takılır. Screen Recording + Accessibility izni gerekir; macOS 15+ ⚠️ |
| [**Jeomon/macos-mcp**](https://pypi.org/project/macos-mcp/0.3.5/) | Accessibility ağacı üzerinden MCP | Piksel değil eleman bazlı → daha güvenilir; sandbox yok uyarısı |
| [**CursorTouch/MacOS-Use**](https://pypi.org/project/macos-use) | Accessibility + herhangi bir LLM | Referans implementasyon |
| [Macbeth](https://mcpservers.org/servers/wende/macbeth) | stdio MCP + Unix socket, TCP dinlemiyor | Güvenlik açısından iyi desen |
| Chrome DevTools MCP / Playwright MCP | Tarayıcıyı DOM seviyesinde kontrol | Web işleri için piksel kontrolünden çok daha güvenilir |
| Claude in Chrome (`claude --chrome`) | Anthropic'in Chrome eklentisi | Zaten kurulu olabilir; ancak kendi güvenlik onaylarını sorar — tıkanmaların kaynağı da olabiliyor |

**Sonuç:** Önce DOM (tarayıcı MCP), sonra Accessibility ağacı (cua-driver / macos-mcp), en son piksel + ekran görüntüsü (Peekaboo). Bkz. [06](06-computer-use.md).

## 6. Ağ: telefon ↔ Mac

- **Tailscale** (WireGuard tabanlı, kişisel kullanım ücretsiz): port açmadan, NAT arkasından, hücresel ağdan doğrudan bağlantı. Hub yalnızca tailnet arayüzünü dinler. **Önerilen.**
- Alternatifler: self-hosted Headscale, düz WireGuard, Cloudflare Tunnel (public URL gerektiren ElevenLabs Custom LLM için gerekebilir).

## 7. Benzer projeler / ilham

- Claude Code Remote Control (resmi) — ekran tabanlı uzaktan devam.
- Claude Code Channels (Telegram/Discord/iMessage pluginleri) — metin tabanlı itme.
- `switchboard-relay` gibi Channels üzerine kurulu deneysel relay'ler.
- Sesli ajan platformları (Vapi, Retell) — hosted, bizim self-hosted modelimize uymuyor.

**Boşluk:** Proaktif arayan, sesli, çok-oturumlu, masaüstünü de kontrol edebilen, tamamen self-hosted bir süpervizör yok. CallMeClaude bu boşluğu dolduruyor.
