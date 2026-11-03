# ADR-0004: Telefon ↔ Mac bağlantısı için Tailscale

- Durum: Kabul edildi · 2026-11-03

## Bağlam
Telefon hücresel ağda, Mac ev NAT'ının arkasında. SaaS relay işletmek istemiyoruz; port açmak güvensiz.

## Karar
Varsayılan taşıma Tailscale (WireGuard). Hub yalnızca tailnet arayüzünde dinler. Alternatif olarak Headscale / düz WireGuard desteklenir (adres yapılandırılabilir).

## Sonuçlar
- ✅ Sıfır port açma, uçtan uca şifreleme, ağ değişikliğinde otomatik toparlanma.
- ⚠️ Developer'ın Tailscale hesabı/kurulumu gerekir. iOS'ta Tailscale VPN'in "always on" olması gerekir.
- ⚠️ VoIP push (APNs/FCM) yine Apple/Google üzerinden gider; payload'da içerik bulunmaz.
