# 00 · Vizyon ve Kapsam

## Problem

Claude Code ile çalışan bir developer bugün aynı anda 3-10 oturum yürütebiliyor. Ama her oturum:

- izin istemek için (`permission_prompt`),
- yeni talimat beklemek için (`idle_prompt`, iş bitti),
- yapamadığı/yapmak istemediği bir adımda ("bu formu ben gönderemem", "CAPTCHA var", "2FA kodu lazım"),
- API hatası / kullanım limiti nedeniyle (`StopFailure`)

durabiliyor. Developer masadan kalktığı anda bütün iş hattı yavaşlıyor veya duruyor.
Claude'un kendi **Remote Control** özelliği oturuma telefondan devam etmeyi sağlıyor ama:
ekrana bakmayı ve yazmayı gerektiriyor, oturum bazlı, proaktif arama yapmıyor ve oturumlar arası orkestrasyon/masaüstü kontrolü yok.

## Vizyon

> "Bilgisayarımı evde bırakıp motosikletle uzun yola çıkıyorum. Kaskın içindeki interkomdan ajanımı arayıp konuşarak her şeyi yönetiyorum. İşler bittikçe ajan beni arıyor."

CallMeClaude = **ses-öncelikli, proaktif, çok-oturumlu bir Claude Code süpervizörü.**

## Hedefler

| # | Hedef | Ölçüt |
|---|---|---|
| G1 | Mac'teki tüm Claude Code oturumlarını gerçek zamanlı izlemek | Yeni olay → Hub'da < 1 sn |
| G2 | Tıkanmayı otomatik algılamak | İzin/idle/hata %100; "yapamam" tipi mesajlar ≥ %90 doğru sınıflandırma |
| G3 | Telefonu gerçek arama gibi çaldırmak | Kilitli ekranda, uygulama kapalıyken bile; olay → çalma < 5 sn |
| G4 | Akıcı, kesilebilir (barge-in) sesli konuşma | Konuşma bitişi → yanıt sesi başlangıcı < 1 sn (hedef 600-800 ms) |
| G5 | Developer'ın sesli talimatını ilgili oturuma veya masaüstüne uygulamak | Talimat → eylem → sözlü doğrulama |
| G6 | Gözetimsiz günlerce çalışmak | Kesinti sonrası otomatik toparlanma, offline uyarısı |
| G7 | Kurulumu bir developer'ın 30 dakikada bitirebilmesi | `cmc setup` sihirbazı |

## Kapsam dışı (şimdilik)

- Çok kullanıcılı / ekip kullanımı, hosted servis, abonelik satışı veya paylaşımı.
- Windows Hub. (İlk hedef macOS'tu; Linux Hub artık var: [ADR-0006](adr/0006-linux-hub.md), [ADR-0008](adr/0008-linux-computer-use.md). Telefon tarafında iPhone'un yanında Android uygulaması da var: [ADR-0007](adr/0007-android-app.md).)
- Claude Desktop **sohbet** pencerelerinin (claude.ai chat) tam kontrolü — v2'de Accessibility ile okuma düşünülebilir. İlk hedef Claude Code oturumları (terminal, IDE, Desktop içindeki Code sekmesi).
- PSTN (gerçek telefon numarası) araması — opsiyonel eklenti olarak ([05](05-calling-and-mobile.md#pstn-yedeği)).

## Kullanıcı senaryoları

### S1 — Tıkanma ve uzaktan çözüm
1. `acme-web` oturumu Chrome'da bir başvuru formunu doldurmuş; "Formu göndermeden önce onayını almam gerekiyor" deyip durmuş.
2. Hub `Stop` hook'unu alır, son mesajı sınıflandırır → `blocked:needs_approval`.
3. Telefon çalar. Hub: *"Acme'da form hazır, gönderme onayı bekliyor. Göndereyim mi?"*
4. Dev: *"Gönder, sonra mail taslağına geç."*
5. Hub oturuma talimatı iletir (Stop hook'u `block` + talimat ile). Ajan formu gönderemezse Hub masaüstü kontrolüne geçer, butona tıklar, ekran görüntüsüyle doğrular.
6. Hub: *"Gönderildi, onay sayfası açıldı. Ajan mail taslağına geçti."*

### S2 — İş bitti bildirimi
*"API projesi: migration tamam, 42 test geçti. Sırada seed verisi var, devam edelim mi?"* → *"Devam."*

### S3 — Developer'ın araması
Dev, interkomdan Siri ile *"Claude'u ara"* der. Hub açılışta brifing verir: *"3 oturum çalışıyor, biri onay bekliyor, biri 10 dakika önce bitti."* Dev: *"Bekleyeni anlat."*

### S4 — Yeni iş başlatma
*"Blog reposunda yeni oturum aç, README'deki bozuk linkleri düzeltsin, bitince ara."*

### S5 — Acil durdurma
*"Her şeyi durdur."* → Tüm oturumlara interrupt, computer-use kilitlenir, Hub onay ister: *"Tüm oturumlar durduruldu. Tekrar başlatmak için 'devam et' de."*
