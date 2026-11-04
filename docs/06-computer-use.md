# 06 · Bilgisayar Kullanımı (Desktop & Browser Control)

Bir oturum "bunu yapamam" dediğinde ve developer *"sen yap"* dediğinde Hub, masaüstünü kendisi kullanır.

> **Linux:** Bu belge macOS yolunu anlatır. Linux'ta Hub, görev başlarken masaüstüne göre sürücü seçer (X11: scrot/import/maim + xdotool; Wayland + KDE: spectacle + ydotool; Wayland + wlroots: grim + ydotool; GNOME Wayland'de ekran görüntüsü yok, yalnızca Claude in Chrome). Bkz. [ADR-0008](adr/0008-linux-computer-use.md).

## Katmanlı strateji: önce yapı, sonra piksel

| Seviye | Araç | Ne zaman | Güvenilirlik |
|---|---|---|---|
| L0 | **Oturumun kendisi** | Ajan yetkiyle/izinle işi yapabiliyorsa (çoğu durumda yeterli) | ★★★★★ |
| L1 | **Tarayıcı MCP** — Chrome DevTools MCP / Playwright MCP | Web formu, buton, sayfa okuma | ★★★★☆ |
| L2 | **Accessibility ağacı** — `cua-driver` (MCP), `macos-mcp` | Native uygulamalar, sistem diyalogları | ★★★☆☆ |
| L3 | **Ekran görüntüsü + koordinat** — `Peekaboo` (MCP) | L1-L2 başarısızsa | ★★☆☆☆ |

Brain (Agent SDK), bu MCP sunucularını **yalnızca computer-use görevi sırasında** yükler (`mcpServers` seçeneği) ve görev bitince kapatır.

## Entegre edilecek açık kaynak projeler

### trycua/cua — Cua Driver
- İmleci ve odağı **çalmadan** tıklama/yazma/doğrulama (kullanıcı yokken bile güvenli, birden fazla işi bozmaz). CLI + MCP.
- **Lume**: Apple Silicon'da macOS VM'leri — riskli işler için izole bir VM'de tarayıcı çalıştırma seçeneği (v2).
- Repo: https://github.com/trycua/cua

### steipete/Peekaboo
- Hızlı ekran görüntüsü, pencere/uygulama hedefleme, GUI otomasyonu; MCP sunucusu.
- `brew install steipete/tap/peekaboo` veya npm (paket adı doğrulanmalı ⚠️). macOS 15+ ⚠️.
- Screen Recording + Accessibility izinleri gerekir.

### Tarayıcı
- **Ayrı bir Chrome profili** ("CallMeClaude Agent") — developer'ın oturum açtığı siteler orada; uzaktan debug portu yalnızca localhost.
- Chrome DevTools MCP veya Playwright MCP bu profile `connectOverCDP` ile bağlanır → mevcut çerezler/oturumlar korunur.
- Claude in Chrome eklentisini kullanan oturumlar için: Hub aynı sekmeyi CDP üzerinden görebilir; ajanın kaldığı yerden devam eder.

### Diğer referanslar
- `Jeomon/macos-mcp`, `CursorTouch/MacOS-Use` (Accessibility tabanlı), Macbeth (TCP açmayan güvenli MCP deseni).

## Computer-use görev akışı

```
1. Kilit al (computer.lock) — aynı anda tek kontrolör; insan klavyeye dokunursa (HID olayı) iptal.
2. Bağlam topla: ilgili oturumun son mesajı + transcript'teki URL / pencere adı.
3. Planı tek cümleyle sesli doğrula (risk ≥ medium ise): "Acme sekmesindeki 'Başvuruyu gönder' butonuna basacağım, tamam mı?"
4. Uygula: L1 → L2 → L3. Her adımdan önce/sonra ekran görüntüsü (audit).
5. Doğrula: başarı ölçütü (URL değişti, "Teşekkürler" metni, hata yok).
6. Oturuma bildir: "Form gönderildi, onay sayfası açık. Kaldığın yerden devam et."
7. Developer'a 1 cümlelik sonuç.
8. Kilidi bırak.
```

## Sınırlar ve güvenlik
- Bkz. [08-security.md](08-security.md). Özetle:
  - **Asla otomatik yapılmayanlar (varsayılan):** CAPTCHA çözme, şifre/2FA girme (2FA kodunu developer sesle söylerse ve kural izin veriyorsa hariç), ödeme onayı, hesap silme, dışarıya e-posta/mesaj gönderme — her biri açık sesli onay gerektirir.
  - **Prompt injection:** Web sayfasındaki metin talimat değildir. Computer-use sırasında sayfadan okunan içerik "veri" olarak etiketlenir; Brain, developer'ın talimatı dışında hedef değiştiremez.
  - Bir oturumun (ör. Claude in Chrome) kendi güvenlik gerekçesiyle reddettiği eylemi Hub yaparken, bu eylem **developer'ın açık, kayıtlı onayına** dayanmalı ve Hub'ın kendi modeli de yargısını kullanır; Hub bir "güvenlik atlatma" aracı değil, insan onayını uzaktan taşıyan bir araçtır.
- macOS TCC izinleri (Accessibility, Screen Recording, Automation) tek bir imzalı helper bundle'a verilir; `cmc doctor` eksik izinleri raporlar.
- Ekran kilitliyken GUI otomasyonu çalışmaz → gözetimsiz modda ekran kilidi/uyku ayarları ([09](09-unattended-operation.md)). Bu bir güvenlik ödünleşimidir; fiziksel güvenliği olan bir ortamda tercih edilmeli, FileVault açık kalmalı.
