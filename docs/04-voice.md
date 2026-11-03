# 04 · Ses Katmanı

## Tasarım: iki katman

Claude (Agent SDK) mükemmel bir beyin ama telefonda "anında" cevap verecek kadar hızlı değil (ilk token + araç çağrıları saniyeler sürebilir). Speech-to-speech modeller ise 300-800 ms'de cevap veriyor, araya girmeyi (barge-in) doğal destekliyor. Bu yüzden:

```
Developer ⇄ [ Ses modeli: "resepsiyonist" ]  ── tools ──▶  [ Brain: Claude ]  ──▶ oturumlar / masaüstü
             Gemini Live / ElevenLabs                        kullanıcının planı
             • anında cevap, kesilebilir                     • gerçek iş, kararlar, policy
             • brifingden basit soruları yanıtlar            • uzun süren işler async
             • "bakıyorum, bir saniye" der                   • sonucu kısa metin olarak döner
```

Ses modeli **hiçbir zaman** oturumlara veya masaüstüne doğrudan erişmez; yalnızca Hub'ın tanımladığı araçları çağırır ve her eylem Brain + Policy'den geçer.

## VoiceProvider arayüzü

```ts
interface VoiceProvider {
  id: 'gemini-live' | 'elevenlabs' | 'cascade';
  start(opts: {
    systemPrompt: string;          // persona + konuşma kuralları (07)
    briefing: string;              // anlık durum özeti
    tools: VoiceToolSpec[];        // aşağıdaki araç listesi
    language: 'tr-TR' | 'en-US' | string;
    audioIn: AsyncIterable<PCM16>; // telefondan gelen mikrofon
  }): VoiceSession;
}
interface VoiceSession {
  audioOut: AsyncIterable<PCM16>;  // telefona giden ses
  onToolCall(handler: (call) => Promise<ToolResult>): void;
  inject(text: string, mode: 'say_now' | 'context'): void; // araya giren olay
  interrupt(): void;
  end(reason: string): Promise<CallTranscript>;
}
```

## Ses modeline sunulan araçlar

| Araç | Açıklama | Brain'e gider mi? |
|---|---|---|
| `get_overview()` | Tüm oturumların tek satırlık durumu | Hayır (önbellek) |
| `get_session(project)` | Bir oturumun kısa detay kartı | Hayır (önbellek) |
| `resolve_pending(id, instruction)` | Bekleyen bir kararı developer talimatıyla çöz | Evet |
| `send_instruction(project, text)` | Oturuma serbest talimat | Evet |
| `start_session(repo, task)` | Yeni oturum aç | Evet |
| `do_on_computer(task)` | Masaüstü/tarayıcıda iş yaptır | Evet (computer-use) |
| `stop(project | 'all')` | Durdur / panik | Evet (anında) |
| `set_rule(text)` | "Bu projede testlere sorma" gibi kural | Evet (onaylı) |
| `ask_brain(question)` | Diğer her şey | Evet |
| `end_call()` | Görüşmeyi kapat | Hayır |

Brain'e giden çağrılar **asenkron** tasarlanır: ses modeli hemen "Tamam, hallediyorum" der; sonuç gelince Hub `inject(say_now)` ile konuşmaya ekler.

## Sağlayıcı adaptörleri

### 1) Gemini Live (MVP varsayılanı)
- Hub → Gemini Live WebSocket (server-to-server); telefon sesini Hub köprüler. API anahtarı yalnızca Mac'te.
- Native audio modeli, function calling, barge-in; `end_sensitivity` ayarı (kask içinde rüzgar → dikkatle ayarlanmalı).
- Maliyet tahmini: ~$0.02-0.03/dakika ⚠️ (fiyatlar ve kümülatif bağlam faturalaması doğrulanmalı).
- Türkçe: desteklenen diller listesinden doğrula ⚠️.

### 2) ElevenLabs Agents
- Hub → ElevenLabs WebSocket konuşma oturumu (server-side), araçlar "client tool" olarak Hub'da çalışır → Hub'ı internete açmaya gerek yok.
- Alternatif mod: **Custom LLM** = Hub'ın OpenAI uyumlu `/v1/chat/completions` ucu (Claude'a köprü). Bu, ElevenLabs'in Hub'a internetten erişmesini gerektirir (Cloudflare Tunnel / Tailscale Funnel + secret). Gecikme daha yüksek; "tamamen Claude konuşsun" isteyenler için.
- En iyi Türkçe ses kalitesi beklentisi; dakika maliyeti daha yüksek ⚠️.

### 3) Cascade (ileride)
- STT (Deepgram / Google STT / ElevenLabs Scribe streaming) → Claude Haiku (Agent SDK) → TTS (ElevenLabs Flash).
- Avantaj: konuşan model de Claude. Dezavantaj: gecikme ve turn-taking'i kendimiz yönetmek (VAD, endpointing). Pipecat ilham/referans.

## Ses taşıma (telefon ↔ Hub)

- **Kontrol kanalı:** WebSocket (JSON, [protocol.md](protocol.md)).
- **Ses kanalı:** WebRTC (Opus, 16-48 kHz, jitter buffer, AEC/NS telefonun ses birimiyle) — tercih. Basit başlangıç: WS üzerinden 16 kHz PCM/Opus çerçeveleri.
- Tümü Tailscale içinde; hücresel ağda NAT sorunu yok.

## Gecikme bütçesi (hedef < 1 sn)

| Adım | Hedef |
|---|---|
| Endpointing (konuşma bitti algısı) | 200-300 ms |
| Telefon → Mac (Tailscale, 4G/5G) | 50-150 ms |
| Mac → sağlayıcı → ilk ses çerçevesi | 300-500 ms |
| Mac → telefon | 50-150 ms |
| **Toplam** | **~600-1100 ms** |

Optimizasyon: v2'de "direct mode" — telefon doğrudan sağlayıcıya bağlanır (kısa ömürlü token Hub'dan alınır), araçlar Tailscale üzerinden Hub'a gider. Bir ağ atlaması kazanılır.

## Kask / interkom koşulları
- Ses Bluetooth HFP (8/16 kHz, mono) üzerinden gelir → modeller dar bantta test edilmeli.
- Rüzgar ve motor gürültüsü: telefon tarafında gürültü bastırma açık; barge-in hassasiyeti düşük; yanlış kesmeler için "Devam et" deme alışkanlığı.
- Opsiyonel **"bas-konuş" modu**: interkom tuşu/medya tuşu (AVRCP play/pause) ile konuşma turu sinyali.
- Kısa, net, tekrar edilebilir cevaplar: *"Tekrar et"* her zaman çalışır.
