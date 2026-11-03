# ADR-0003: İki katmanlı ses mimarisi (hızlı ses modeli + Claude beyin)

- Durum: Kabul edildi · 2026-11-03

## Bağlam
Hedef: kesilebilir, doğal, < 1 sn gecikmeli telefon konuşması. Claude, Agent SDK üzerinden araç kullanırken saniyeler mertebesinde yanıt verir; ayrıca native audio sunmaz. Speech-to-speech modeller (Gemini Live) ve yönetilen ses ajanları (ElevenLabs Agents) bu gecikmeyi ve turn-taking'i çözüyor.

## Karar
- Konuşmayı **ses sağlayıcısının modeli** yürütür ("resepsiyonist"): selamlama, brifingden cevap, netleştirme, geri okuma.
- Tüm gerçek işler ve kararlar Hub araçları üzerinden **Claude Brain**'e gider; asenkron sonuçlar konuşmaya enjekte edilir.
- Sağlayıcı `VoiceProvider` arayüzüyle soyutlanır. MVP: Gemini Live. İkinci: ElevenLabs Agents. İleride: Claude ile kaskad.
- Ses oturumu Hub'dan açılır (anahtarlar Mac'te kalır, araçlar yerelde çalışır).

## Sonuçlar
- ✅ Düşük gecikme, barge-in, sağlayıcı bağımsızlığı.
- ⚠️ Konuşan model Claude değil; ses modeline yalnızca özetler gider (gizlilik + doğruluk). Kararlar her zaman Brain + Policy'de.
- ⚠️ Ek ama düşük bir BYOK maliyeti (dakika başı).
