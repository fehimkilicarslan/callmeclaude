# ADR-0006: Hub Linux'ta da çalışır (platform katmanı)

- Durum: Kabul edildi · 2026-11-03

## Bağlam
Hub (`apps/mac-agent`) yalnızca macOS'ta çalışıyordu: sırlar Keychain'de (`security`), servis launchd'de, doctor `pmset`'e, shell `/bin/zsh`'e bağlıydı. Claude Code Linux'ta da yaygın; hub'ı orada çalıştırmak macOS davranışını değiştirmeden mümkün olmalı.

## Karar
- `src/platform/`: tek arayüz (`Platform`), iki uygulama (`darwin`, `linux`), seçim `process.platform` ile. Sırlar, servis, doctor kontrolleri, login shell, Tailscale/LAN ve güvenlik desenlerinin OS'a özel parçaları burada. `darwin` mevcut kodun birebir taşınmasıdır.
- Linux sırları: libsecret (`secret-tool`, `service=dev.callmeclaude account=<ad>`, çok satırlılar `b64:`). secret-tool yoksa düz metin dosyaya **yazılmaz**; setup ne yapılacağını söyler. Ortam değişkeni önceliği aynı.
- Linux servisi: `systemd --user` unit (`~/.config/systemd/user/dev.callmeclaude.hub.service`, `Restart=always`, loglar `LOG_DIR`'de). Doctor linger, sleep hedefleri ve lid ayarını yalnızca kontrol eder ve önerir; sudo çalıştırmaz.
- Veri dizini her iki OS'ta `~/.callmeclaude` (`CMC_HOME`) olarak kalır; config, durum ve log formatları ortak.
- Linux computer-use (Peekaboo/cliclick karşılığı) bu adımın dışında; Linux'ta Peekaboo bulunamaz ve computer task'lar yalnızca Chrome/Bash ile sınırlı kalır.

## Sonuçlar
- ✅ Tek kod tabanı, macOS çıktısı bayt bayt aynı; CI hub testlerini ubuntu'da da koşar.
- ⚠️ Başsız (headless) Linux'ta keyring kilitli olabilir; o durumda anahtar servis ortamından (`GEMINI_API_KEY`) verilmeli.
- ⚠️ Linux masaüstü kontrolü sonraki adımda.
