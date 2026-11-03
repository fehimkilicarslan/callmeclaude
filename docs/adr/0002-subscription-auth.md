# ADR-0002: Claude erişimi yalnızca kullanıcının kendi yerel Claude Code oturumu üzerinden

- Durum: Kabul edildi · 2026-11-03

## Bağlam
Hedef, "developer kurduğunda doğrudan kendi Claude aboneliğiyle çalışsın". Anthropic politikası (Şubat 2026): üçüncü tarafların Claude.ai girişi sunması veya plan kimlik bilgileriyle kullanıcı adına istek yönlendirmesi yasak; **kişisel kullanım ve yerel geliştirme** için Agent SDK kabul edilebilir. Güncel Help Center (Ekim 2026): Agent SDK / `claude -p` kullanımı plan limitlerinden düşer.

## Karar
1. Hub, Claude'a yalnızca **developer'ın kendi Mac'inde kurulu ve giriş yapılmış** Claude Code / Claude Agent SDK üzerinden erişir.
2. Hub OAuth token'larını okumaz, saklamaz, aktarmaz; giriş akışı sunmaz.
3. Hiçbir merkezi sunucu, paylaşılan hesap veya proxy yoktur. Her kurulum tek bir kişinin kendi kullanımıdır.
4. Opsiyonel: `ANTHROPIC_API_KEY` ile API modu.
5. README ve kurulum, bu kullanım modelini ve politikanın değişebileceğini açıkça belirtir.

## Sonuçlar
- ✅ Politika ile uyumlu kişisel kullanım modeli; ek maliyet yok.
- ⚠️ Brain kullanımı plan limitini tüketir → model yönlendirme ve limit izleme zorunlu.
- ⚠️ Politika değişirse (ör. ayrı SDK kredisi) yalnızca dokümantasyon ve limit izleme güncellenir; mimari değişmez.
