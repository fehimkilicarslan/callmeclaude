# 11 · Yol Haritası

## Durum (2026-11-04)

| Faz | Durum |
|---|---|
| 0 — Hub iskeleti, hook'lar, oturum kaydı, `cmc` | ✅ |
| 1 — Durum makinesi, Haiku sınıflandırıcı (kendi planın), brifing | ✅ gerçek Claude ile doğrulandı |
| 2 — Developer arar (iOS, Gemini Live, Siri) | ✅ gerçek telefon görüşmesi yapıldı |
| 3 — Hub arar (PushKit + CallKit) | ✅ kilit ekranında VoIP push ile doğrulandı; hücresel ağ + Tailscale ile doğrulandı |
| 4 — Tıkanma çözme (hold, tmux, resume, kuyruk) | ✅ gerçek Claude Code oturumuyla uçtan uca doğrulandı |
| 5 — Computer use (Peekaboo, Claude in Chrome) | ✅ launchd servisinden doğrulandı (`cmc do`) |
| 6 — Gözetimsiz sağlamlık | 🟡 `cmc doctor`, panik, audit hazır; offline uyarısı, sesli PIN, ElevenLabs sırada |
| Linux Hub | ✅ systemd `--user`, libsecret, isteğe bağlı tmux ([ADR-0006](adr/0006-linux-hub.md)); computer-use sürücü seçimi ([ADR-0008](adr/0008-linux-computer-use.md)) |
| Android uygulaması | ✅ FCM'siz, foreground service + self-managed `ConnectionService` ([ADR-0007](adr/0007-android-app.md)) |

## Faz 0 — Temel (Hub iskeleti)
- [ ] Monorepo (pnpm workspaces), TypeScript, lint/test altyapısı
- [ ] Hook server + `cmc setup` hook kurulumu (merge/backup/uninstall)
- [ ] Session Registry + transcript tailer + SQLite
- [ ] `cmc status` CLI: tüm oturumlar ve durumları
- **Çıktı:** Terminalde canlı oturum panosu.

## Faz 1 — Anlama
- [ ] Durum makinesi + Stop sınıflandırıcı (regex + Haiku)
- [ ] Brain (Agent SDK) iskeleti, `cmc` MCP araçları
- [ ] Brifing ve tek cümlelik özetler
- [ ] Metin push bildirimi (araması olmadan)
- **Çıktı:** "Acme: form onayı bekliyor" bildirimi telefona düşer.

## Faz 2 — Developer arar (dial-in sesli MVP)
- [ ] Mobil uygulama: eşleştirme, Tailscale bağlantı, ses akışı (WS-PCM)
- [ ] VoiceProvider: Gemini Live adaptörü, araçlar
- [ ] Siri / App Intent "Claude'u ara"
- **Çıktı:** İnterkomdan arayıp durum sorabilmek. ← **İlk kullanılabilir sürüm**

## Faz 3 — Hub arar
- [ ] PushKit + CallKit (iOS), FCM/foreground + Telecom (Android)
- [ ] Call Scheduler: öncelik, batch, modlar, cevapsız arama
- [ ] Aktif aramaya olay enjeksiyonu

## Faz 4 — Tıkanma çözme
- [ ] Hold-open `Stop`/`PermissionRequest` yanıtları
- [ ] `cmc run` (tmux) + send-keys; headless resume
- [ ] Channel desteği (preview stabil olursa)
- [ ] Policy motoru + sesli onay + PIN
- **Çıktı:** S1 senaryosunun L0 kısmı uçtan uca.

## Faz 5 — Computer use
- [ ] Chrome agent profili + CDP MCP
- [ ] cua-driver / Peekaboo entegrasyonu, kilit, ekran görüntüsü audit
- [ ] Doğrulama adımları, oturuma geri bildirim
- **Çıktı:** "Sen gönder" → Hub tıklar → doğrular.

## Faz 6 — Gözetimsiz sağlamlık
- [ ] Watchdog, heartbeat, offline uyarısı, sesli toparlama komutları
- [ ] `cmc doctor` tam kapsamlı, yolculuk checklist komutu (`cmc preflight`)
- [ ] ElevenLabs adaptörü, direct-mode ses
- [ ] **Dokümanların İngilizce çevirisi** (açık kaynak yayını öncesi)

## Faz 7+ (fikirler)
- Claude Desktop sohbet pencerelerini Accessibility ile okuma
- Windows Hub (Linux Hub: ✅, yukarıdaki tablo)
- Lume VM içinde izole computer-use
- PSTN yedeği (Twilio BYOK)
- Apple Watch / CarPlay arayüzü

## Açık sorular
1. Hook timeout üst sınırı nedir? (Varsayılan 600 sn; Hub `holdSeconds+60` = 1560 sn kullanıyor — uzun süreli tutmada gerçek davranış izlenmeli.) ⚠️
2. Channels research preview'dan çıkacak mı, özel kanal bayrağı kalkacak mı?
3. iOS "Aramaları otomatik yanıtla" CallKit VoIP aramalarına uygulanıyor mu?
4. Gemini Live / ElevenLabs Türkçe kalite ve HFP dar bant performansı — saha testi gerekli.
5. Brain'in plan limitine etkisi: günlük tipik kullanımda ne kadar? Ölçüm gerekli.
6. Lisans: MIT mi Apache-2.0 mı? (Patent hükmü için Apache-2.0 düşünülebilir.)
