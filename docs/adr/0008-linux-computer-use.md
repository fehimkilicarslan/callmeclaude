# ADR-0008: Linux'ta computer-use (sürücü seçimi)

- Durum: Kabul edildi · 2026-11-04 · ADR-0006'daki "Linux masaüstü kontrolü sonraki adımda" maddesini tamamlar

## Bağlam
Hub'ın computer task'i macOS'ta Peekaboo, cliclick, screencapture ve osascript ile çalışıyor. Linux'ta tek bir masaüstü yok: X11 ile Wayland ve GNOME, KDE ile wlroots tabanlılar (Sway, Hyprland) ekran görüntüsü ve sentetik giriş için farklı araçlar istiyor. Hedefler: Ubuntu 22.04+, Debian 12+, Fedora, Mint 21+, Arch.

## Karar
- **Sürücü seçimi saf bir fonksiyondur** (`src/platform/computerUse.ts`, `selectComputerDriver`). Girdisi ortam değişkenleri (`XDG_SESSION_TYPE`, `XDG_CURRENT_DESKTOP`, `WAYLAND_DISPLAY`, `DISPLAY`, `SWAYSOCK`, `HYPRLAND_INSTANCE_SIGNATURE`) ve PATH'teki ikililer, çıktısı sürücüdür. `XDG_SESSION_TYPE` belirtilmişse kazanır. DISPLAY'i de olan bir Wayland oturumu Wayland sayılır, çünkü xdotool orada yalnızca XWayland pencerelerine ulaşır.

  | Ortam | Ekran görüntüsü | Giriş |
  |---|---|---|
  | X11 (her masaüstü) | scrot → import → maim | xdotool |
  | Wayland + KDE | `spectacle -b -n -f -o` | ydotool |
  | Wayland + wlroots | `grim -c` | ydotool |
  | Wayland + GNOME | **desteklenmiyor** | ydotool |
- Ekran görüntüsü görev başına açılan 0700 izinli geçici bir dizine alınır. Ajan dosyayı Read ile görür ve `rm -f` ile siler. Hub da görev bitince dizini her durumda kaldırır.
- **Masaüstü kontrolü, ekran görüntüsü alınabiliyorsa açılır.** Ajan her adımı doğrulayabilmeli; yalnızca giriş varken "kör" tıklama sunulmaz. Ekran görüntüsü olup giriş yoksa ajan yalnızca bakar ve raporlar.
- Koordinatlar: X11'de ekran görüntüsü pikseli X ekran koordinatıdır. Bu, Xvfb'de ölçüldü (CI). Çoklu monitörde görüntü tüm X ekranını kapsar; bu X11'in tasarımından çıkarıldı, ölçülmedi. Wayland'de görüntü fiziksel piksel verir, ydotool ise sanal bir aygıtla göreli hareket ettirir. Ölçekleme ve ivme bu yüzden sapma yaratabilir. Bu ölçülmedi, çünkü gerçek oturumda giriş üretmek yasak. Ajan her hareketten sonra ekran görüntüsüyle kontrol eder ve klavyeyi tercih eder.
- **GNOME Wayland sonucu: desteklenmiyor.** GNOME Shell'in `org.gnome.Shell.Screenshot` D-Bus arayüzü yalnızca `org.gnome.SettingsDaemon.MediaKeys` ve `org.freedesktop.impl.portal.desktop.gnome` adlarına izin verir (`js/ui/screenshot.js`, `DBusSenderChecker`). gnome-screenshot GNOME 41'den beri bu nedenle reddediliyor. Kalan yol xdg-desktop-portal Screenshot'tır. Etkileşimsiz istekte bile ilk seferde ekrandaki kişiye izin sorar; bu diyalog yalnızca odaktaki uygulama için açılabiliyor. Kalıcı izin, uygulama kimliğiyle permission store'da tutulur ve kimliği olmayan (Flatpak dışı) bir servis için güvenilir biçimde önceden verilemiyor. Kimse başında değilken çalışan bir yol bulunmadığı için bu ortamda yalnızca tarayıcı yolu kullanılır.
- **ydotool isteğe bağlıdır.** `/dev/uinput` erişimi gerekir ve bunu uygulama değil, kullanıcı bir kez kendisi kurar. Doctor dağıtıma göre adımları yazdırır: paket, ayrı bir `uinput` grubu, udev kuralı, modül ve ydotoold servisi. Bilerek `input` grubu kullanılmaz, çünkü o grup klavyeleri okumaya da izin verir. **Güvenlik bedeli:** izin verilince o kullanıcı hesabındaki her program sentetik klavye ve fare girişi üretebilir.
- **Tarayıcı yolu:** Claude in Chrome masaüstünden bağımsızdır ve resmi olarak Linux'ta desteklenir. Belgeler Linux native host yolunu verir: `~/.config/google-chrome/NativeMessagingHosts/…`; desteklenmeyen tek ortam WSL'dir. Hub `--chrome` ile başlatır. Masaüstü sürücüsü yoksa ajan yalnızca tarayıcıyla devam eder. İkisi de yoksa görev ajan çalıştırılmadan "bu ortamda desteklenmiyor" yanıtıyla döner.
- Doctor yalnızca kontrol eder ve önerir: oturum, sürücü, eksik araçlar (apt/dnf/pacman komutu), uinput, ydotoold, servisin oturum değişkenlerini görüp görmediği ve Chrome native host'u.
- macOS: araç talimatları ve Peekaboo yolu `darwin.computerUse()` içine birebir taşındı. Prompt ve sesli metinler, testte bayt bayt karşılaştırılan fixture'larla aynıdır. Linux metinleri "Mac" yerine "computer" der.

## Sonuçlar
- ✅ Tek arayüz, saf ve test edilen sürücü matrisi; CI X11 sürücüsünü gerçek bir Xvfb'de dener.
- ⚠️ GNOME Wayland'de masaüstü kontrolü yok, yalnızca tarayıcı var.
- ⚠️ Wayland'de işaretçi konumu ölçülmedi; ölçekli ve çoklu monitörlü kurulumlarda sapabilir.
- ⚠️ Talimatlar ydotool 1.x sözdizimi içindir; eski dağıtımlar 0.1.x paketliyor olabilir (Ubuntu 22.04 için doğrulanmadı). Güncelleme: Hub sürümü algılar, 1.x olmayan ydotool'u yok sayar ve doctor "ydotool 1.x required" der.
- ⚠️ Hub servisi oturumdan önce başladıysa `WAYLAND_DISPLAY` veya `DISPLAY` göremeyebilir. Güncelleme: computer task başlarken bu değerler süreç ortamında yoksa Hub onları `systemctl --user show-environment`'tan okur ve yalnızca o görevin ajanına verir; doctor ancak systemd'de de yoksa `import-environment` önerir (yeniden başlatma gerekmez).
