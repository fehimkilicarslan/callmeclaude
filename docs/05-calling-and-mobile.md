# 05 · Arama ve Mobil Uygulama

## Hedef deneyim
Telefon, normal bir arama gibi çalar: kilit ekranında tam ekran "CallMeClaude — Acme: onay gerekiyor". Kask interkomunun cevap tuşu çalışır. Araç kullanırken ekrana dokunmak gerekmez.

## Mac → telefon (gelen arama)

```
Hub.calls ──(1) VoIP push──▶ APNs / FCM ──▶ Telefon (uygulama kapalı olsa bile uyanır)
                                              │ (2) CallKit/Telecom "gelen arama" raporu
                                              ▼
                                         Kullanıcı cevaplar
                                              │ (3) Tailscale üzerinden Hub'a WS + ses
                                              ▼
                                         Hub.voice.start(callId)
```

### iOS
- **PushKit VoIP push + CallKit** zorunlu. iOS 13+ kuralı: VoIP push alındığında **hemen** CallKit'e arama raporlanmalı, yoksa sistem uygulamayı cezalandırır.
- Push, Hub'dan doğrudan **APNs HTTP/2** ile gönderilir (developer'ın kendi `.p8` Auth Key'i, Team ID, Bundle ID). Aracı sunucu yok.
- ⚠️ **Ücretli Apple Developer Program üyeliği gerekir.** Ücretsiz "Personal Team" ile USB kurulumu mümkün ama push entitlement yok ve uygulama 7 günde geçersiz olur → uzun yolculuk için uygun değil.
- Push payload'u minimal tutulur (sadece `callId`, kısa başlık); içerik Tailscale üzerinden Hub'dan çekilir.

### Android
> **Güncelleme:** Android uygulaması FCM'siz modla yazıldı ([ADR-0007](adr/0007-android-app.md), [apps/android/README.md](../apps/android/README.md)): Firebase yok; foreground service hub'a kalıcı WebSocket tutar, arama self-managed `ConnectionService` ile çalar. Aşağıdaki FCM maddesi araştırma notu olarak duruyor.

- **FCM high-priority data mesajı** (developer'ın kendi Firebase projesi) → `ConnectionService` (self-managed) + full-screen intent.
- **FCM'siz mod:** Uygulama foreground service olarak Hub'a Tailscale üzerinden kalıcı WS tutar; Hub aramayı doğrudan bu kanaldan başlatır. Pil tüketimi biraz daha yüksek, ama Google servislerine bağımlılık yok.
- Android 14+ full-screen intent izni ve pil optimizasyonu muafiyeti kurulumda istenir.

### Kütüphane seçimi

> **Güncelleme:** iOS uygulaması native Swift ile yazıldı ([ADR-0005](adr/0005-native-ios-app.md)); aşağıdaki tablo Android/RN için referans olarak duruyor.

| Seçenek | Not |
|---|---|
| **`expo-callkit-telecom`** (tercih) | VoIP push'u native tarafta JS başlamadan işleyip OS'a raporlar; iOS CallKit + Android Telecom tek akış |
| `react-native-callkeep` + `react-native-voip-push-notification` | Klasik yol; PushKit delegate'ini kendin yazman gerekir |
| Native Swift/Kotlin modülü | Kütüphaneler yetmezse |

## Telefon → Mac (developer arıyor)
- Uygulamada büyük **"Claude'u ara"** butonu.
- **Siri / App Intent:** "Hey Siri, Claude'u ara" → uygulama CallKit giden araması başlatır. Kask interkomları Siri'yi tetikleyebildiği için (sesli asistan tuşu) **eller tamamen serbest**.
- Android: Google Assistant App Actions / kısayol.
- CallKit giden aramaları telefonun "Son Aramalar" listesinde görünür → oradan tekrar arama.
- iOS "Aramaları Otomatik Yanıtla" erişilebilirlik ayarının VoIP/CallKit aramalarına uygulanıp uygulanmadığı test edilmeli ⚠️ — uygulanıyorsa Hub aramaları tamamen dokunmasız açılır.

## Arama politikası (Call Scheduler)

| Öncelik | Örnek | Davranış |
|---|---|---|
| P0 — acil | Panik, güvenlik uyarısı, tüm oturumlar hata | Hemen ara, cevapsızsa 2 dk'da bir 3 kez |
| P1 — engel | Onay bekleyen işlem, blocked | 60 sn topla (aynı anda başka engel varsa birleştir), sonra ara |
| P2 — bitti | Görev tamamlandı, devam onayı | 5 dk topla; aktif arama varsa içine enjekte et |
| P3 — bilgi | İlerleme, bayat oturum şüphesi | Sadece push bildirim / sonraki aramada brifing |

- **Modlar:** `desk` (sadece P0-P1 arar), `away` (P0-P2 arar), `ride` (P0-P2 arar + daha kısa cümle + "bas-konuş" önerisi), `sleep` (sadece P0). Telefondan veya sesle değiştirilir: *"Sürüş moduna geç."*
- Cevapsız arama → sessiz push bildirim + bir sonraki aramada ilk sırada.
- Aramalar arası minimum aralık (örn. 3 dk) — developer'ı bunaltmamak için.

## Uygulama ekranları
1. **Eşleştirme:** Hub'ın `cmc pair` ile gösterdiği QR kodu (Tailscale adresi + tek seferlik anahtar + sertifika parmak izi).
2. **Ana ekran:** Oturum listesi (durum renkleri), bekleyen kararlar, "Claude'u ara", mod seçici.
3. **Arama ekranı:** CallKit native UI + uygulama içinde altyazı (konuşma transkripti).
4. **Geçmiş:** Aramalar, kararlar, Hub'ın yaptığı computer-use eylemlerinin ekran görüntüleri.
5. **Ayarlar:** Mod, sessiz saatler, ses tercihi, "Mac offline" uyarı eşiği.

## Heartbeat ve offline durumu
- Hub her 30 sn'de bir WS üzerinden heartbeat gönderir; uygulama kapalıysa, Hub periyodik **sessiz push** ile "son görülme"yi günceller.
- Uygulama, N dakika heartbeat alamazsa **yerel bildirim**: "Mac'e 10 dakikadır ulaşılamıyor (son görülme 14:32)." Developer arama yaptığında, Hub'a ulaşılamazsa uygulama yerel TTS ile bunu söyler.
- Ayrıntılar: [09](09-unattended-operation.md).

## PSTN yedeği
Opsiyonel eklenti: Twilio (veya benzeri) numarası. Uygulama/internet sorunu varsa Hub normal telefon numaranı arar; ses akışı aynı Voice Gateway'e bağlanır. Developer'ın kendi Twilio hesabı (BYOK); varsayılan kapalı.
