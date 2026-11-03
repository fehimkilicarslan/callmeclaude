# ADR-0005: Mobil uygulama native Swift (iOS önce), React Native değil

- Durum: Kabul edildi · 2026-11-03 · [docs/05](../05-calling-and-mobile.md)'teki React Native önerisinin yerini alır

## Bağlam
Uygulamanın tüm değeri üç native parçada: PushKit (VoIP push), CallKit (gerçek arama UI'ı, interkom tuşu) ve tam çift yönlü, yankı engellemeli ses (AVAudioEngine voice processing). React Native'de bu üçü ayrı, olgunluğu değişken kütüphanelerle birleştiriliyor; ses akışı için ek native köprü gerekiyordu. İlk kullanıcı cihazı bir iPhone.

## Karar
- `apps/ios`: SwiftUI + CallKit + PushKit + AVAudioEngine, XcodeGen ile üretilen proje (`project.yml`), CLI ile derlenip USB ile kurulur.
- Android ileride ayrı native (Kotlin, ConnectionService + foreground socket) olarak eklenecek; protokol ortak.

## Sonuçlar
- ✅ Daha az bağımlılık, ses ve çağrı akışında tam kontrol, bilinen Apple API'leri.
- ⚠️ Android desteği şimdilik yok.
