# ADR-0007: Android uygulaması native Kotlin, Google servisleri olmadan

- Durum: Kabul edildi · 2026-11-03 · [ADR-0005](0005-native-ios-app.md)'te öngörülen Android istemcisinin ilk adımı

## Bağlam
iOS uygulaması "aptal telefon" ilkesiyle yazıldı: çalar, ses taşır, durumu gösterir; mantık hub'dadır. Android'de aynı protokolle konuşan bir istemci gerekiyor. iOS'taki VoIP push'un Android karşılığı FCM'dir; o da Google Play Services'e ve Google sunucularına bağımlılık getirir. Telefon hub'a zaten Tailscale/LAN üzerinden doğrudan bağlanıyor.

## Karar
- `apps/android`: native Kotlin, Jetpack Compose (Material 3), tek modül `app`, Gradle Kotlin DSL + version catalog, wrapper repoda. `applicationId`/`namespace` `dev.callmeclaude`.
- **FCM'siz mod:** Firebase, Play Services veya dış sunucuya bağlanan SDK yok. Uyanık kalma işi ileride foreground service'teki WebSocket'e düşer; bağlantı katmanı (`HubClient`) bunun için Activity'den bağımsız.
- **minSdk 29** (Android 10): `Settings.Global.DEVICE_NAME`, modern Keystore/foreground service API'leri; eski cihaz yükü yok.
- Bağımlılıklar: Compose BOM + `activity-compose` + `lifecycle-runtime-compose` (arayüz), `kotlinx-coroutines` (tek iş parçacıklı bağlantı kuyruğu), OkHttp (WebSocket, ping/pong), Android'in yerleşik `org.json` (ek serileştirici yok), `zxing-android-embedded` (Google ML Kit'siz QR). Testte JUnit 4 ve gerçek `org.json` (Android'inki JVM'de saplama).
- Eşleştirme uygulamaya özel depoda, Android Keystore'daki AES-GCM anahtarıyla şifreli; yedekleme ve cihazdan cihaza aktarım kapalı.
- **Yerel ağ izni (`ACCESS_LOCAL_NETWORK`):** Android 17, SDK 37'yi hedefleyen uygulamalar için yerel ağ trafiğini varsayılan olarak engelliyor; izin yoksa LAN IP'sine açılan TCP bağlantısı hata vermez, zaman aşımına düşer. Uygulama hub'a çoğunlukla LAN adresiyle bağlandığı için bu çalışma zamanı iznini (NEARBY_DEVICES grubu) manifest'te tanımlıyor ve eşleştirmeden hemen sonra mikrofon ve bildirim izinleriyle aynı istekte soruyor. NsdManager seçicisi gibi izinsiz yollar uymuyor, çünkü adresler mDNS'ten değil QR'dan geliyor. İzin yoksa ana ekran genel "Can't reach your computer" yerine gerekçeyi, "Allow" ve "Open settings" düğmelerini gösteriyor. "Bir daha sorulamıyor" durumu kalıcı olarak saklanmıyor: platform bu izin için ret sayacını sıfırlayabildiğinden her açılışta önce sistem penceresi deneniyor. Android 16 ve öncesinde izin tanınmadığından davranış değişmiyor; erişim INTERNET ile sağlanıyor. Loopback (`adb reverse`) bu kısıtlamaya girmediği için sorun ilk cihaz testinde görülmemişti.
- **Cleartext:** hub düz `ws://` dinliyor ve adresler kullanıcıya özel IP'ler; alan adına göre kısıtlanamaz. `network_security_config` cleartext'e genel izin verir. Gerekçe: Tailscale trafiği WireGuard ile şifreler, LAN'da hub token ister. iOS'taki karşılığı `NSAllowsArbitraryLoads`.

## Sonuçlar
- ✅ Google hesabı/Play Services olmayan cihazlarda da çalışır; dışarıya veri gitmez.
- ✅ Protokol ve metinler iOS ile ortak; bağlantı mantığı `HubClient.swift`'in birebir karşılığı.
- ⚠️ Push olmadan arama almak için foreground service ve pil optimizasyonu istisnası gerekecek (sonraki adım).
- ⚠️ Cleartext izni tüm hostlar için geçerli; uygulama hub dışında bir yere bağlanmadığı için kabul edildi.
