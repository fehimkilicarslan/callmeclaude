# 09 · Gözetimsiz Çalışma (Günlerce Evde Tek Başına Mac)

Senaryo: Developer motosikletle uzun yola çıkıyor, Mac evde. Uzak masaüstü yok, yalnızca CallMeClaude var.

## 1. Mac'in hep açık ve ulaşılabilir kalması

| Risk | Önlem |
|---|---|
| Uyku | `sudo pmset -a sleep 0 displaysleep 10 disksleep 0`; Hub ayrıca `caffeinate -s` benzeri `IOPMAssertion` tutar |
| Elektrik kesintisi | **UPS** (Mac mini için 30-60 dk yeter); `sudo pmset -a autorestart 1` (elektrik gelince otomatik açılış); MacBook ise pil zaten UPS gibi davranır, şarjda bırak |
| Kesinti sonrası açılış | Otomatik giriş (FileVault açıksa açılışta parola gerekir ⚠️ — aşağıya bak); Hub launchd `RunAtLoad` + `KeepAlive` |
| İnternet kesintisi | Yedek **4G/5G router** veya Wi-Fi + USB/Ethernet hücresel modem; macOS ağ servis sırası ile otomatik failover; Tailscale ağ değişimini kendisi toparlar |
| Router donması | Akıllı priz ile zamanlı/uzaktan power-cycle (opsiyonel) |
| Hub çökmesi | launchd `KeepAlive`; çökme döngüsünde safe mode; crash raporu sonraki aramada sözlü |
| Claude Code güncellemesi / bozulma | Yolculuk öncesi otomatik güncellemeyi dondur (`DISABLE_AUTOUPDATER` vb. ⚠️) |
| Kullanım limiti | `StopFailure` / quota olaylarında Hub haber verir; `quota_auto_resume` olayları izlenir; işler limite göre sıraya alınır |
| macOS güncellemesi / yeniden başlatma | Otomatik güncellemeleri yolculuk boyunca kapat |
| Disk dolması | Hub periyodik disk kontrolü, eşik altında uyarı |

### FileVault ve otomatik açılış ödünleşimi
FileVault açıkken elektrik kesintisi sonrası Mac, açılışta disk parolası bekler ve Hub başlayamaz. Seçenekler:
1. **UPS ile kesintiyi tamamen önle** (önerilen) — FileVault açık kalır.
2. `sudo fdesetup authrestart` yalnızca planlı yeniden başlatmalar içindir; plansız kesintide yardımcı olmaz.
3. FileVault'u kapatmak güvenlik riski — önerilmez; Mac'in fiziksel güvenliği tam ise bilinçli karar.

## 2. Hayatta kalma sinyalleri (watchdog)

- **Hub → telefon heartbeat** (30 sn, WS) + periyodik sessiz push.
- **Telefon tarafı alarm:** 10 dk heartbeat yok → yerel bildirim "Mac offline".
- **Harici dead-man switch (opsiyonel):** Hub her 5 dk'da self-hosted veya ücretsiz bir ping servisine (örn. healthchecks.io / kendi Uptime Kuma'n) ping atar; kesilirse e-posta/SMS. Varsayılan kapalı (SaaS bağımlılığı).
- **Hub içi sağlık:** oturum sayısı, son olay zamanı, disk, ağ, Claude erişimi → `get_overview` brifinginin ilk cümlesi bozukluk varsa onu söyler.

## 3. Uzaktan toparlama araçları (yalnızca ses)
- *"Hub'ı yeniden başlat"* → launchd restart.
- *"X oturumunu yeniden başlat"* → `claude --resume` ile tmux'ta.
- *"Mac'i yeniden başlat"* → `high` risk, PIN; `fdesetup authrestart` ile (FileVault açıkken disk kilidini atlayarak tek seferlik).
- *"Ağ durumunu söyle"* → aktif arayüz, failover durumu.

## 4. Yolculuk öncesi checklist

```
[ ] cmc doctor → tüm kontroller yeşil (izinler, hook'lar, Tailscale, APNs/FCM, ses sağlayıcı, Claude login)
[ ] UPS bağlı, test edildi (fişi çek → Hub "güç kesildi" diye aradı mı?)
[ ] pmset: sleep 0, autorestart 1
[ ] Yedek internet failover test edildi (ana modemi kapat → Hub hâlâ ulaşılabilir mi?)
[ ] Otomatik güncellemeler (macOS, Claude Code, Chrome) donduruldu
[ ] Önemli oturumlar `cmc run` ile tmux içinde başlatıldı
[ ] Agent Chrome profilinde gerekli sitelere giriş yapıldı
[ ] policy.yaml gözden geçirildi; sesli PIN belirlendi
[ ] Mod: `ride`
[ ] Telefondan test araması: interkom ile cevapla, "durum ne?" sor, "test oturumuna devam de" komutu ver
[ ] Hub'ın seni araması testi: `cmc call-me --test`
[ ] Telefon: pil optimizasyonu muafiyeti (Android), bildirim izinleri, Tailscale "always on"
[ ] Kask interkomu: telefonla eşleşik, Siri/Assistant tuşu test edildi
```
