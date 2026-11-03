# CallMeClaude (Türkçe)

> Claude Code ajanların takıldığında **seni telefonla arar**. Kaskın, araban ya da kanependen sesle cevap verirsin.
> Açık kaynak · self-hosted · **kendi** Claude aboneliğinle çalışır · SaaS yok, hesap yok, aracı sunucu yok.

Claude Code saatlerce kendi başına çalışabiliyor, ama bir izin istediğinde, *"bu formu senin onayın olmadan gönderemem"* dediğinde ya da işi bitirip yeni talimat beklediğinde durup seni bekliyor. CallMeClaude bu döngüyü klavyesiz hale getirir.

- Mac'indeki küçük bir ajan (Hub), tüm Claude Code oturumlarını Claude Code'un resmi hook'larıyla gerçek zamanlı izler.
- Bir oturum takılınca ya da bitince iPhone'unu **gerçek bir telefon gibi arar** (CallKit + VoIP push, kilit ekranında da çalar, interkom tuşuyla açılır).
- Ne olduğunu iki kısa cümleyle söyler. Sen konuşarak cevap verirsin; talimatın oturuma iletilir.
- Gerekirse Mac'i senin yerine kullanır (tarayıcıda tıklama, form gönderme). Bunu her zaman sesli onayından sonra yapar.
- İstediğin an "Hey Siri, CallMeClaude ara" diyerek sen de arayabilirsin.

**Kurulum:** [INSTALLATION.md](INSTALLATION.md) (İngilizce, adım adım).
**Tasarım dokümanları (Türkçe):** [docs/](docs/): vizyon, araştırma, mimari, ses, güvenlik, gözetimsiz çalışma ve yolculuk checklist'i.

```bash
pnpm install && ln -s "$PWD/apps/mac-agent/bin/cmc.mjs" /opt/homebrew/bin/cmc
cmc setup --gemini-key <ANAHTAR>   # hook'lar + servis
./scripts/ios-install.sh           # iPhone uygulaması (USB)
cmc pair                           # QR'ı uygulamada okut
cmc mode ride                      # sürüş modu: takılan/biten oturumlar seni arar
```

Lisans: [MIT](LICENSE)
