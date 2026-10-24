# d2-armor-proxy (Worker)

Worker che espone all'app `index.html`:

| Rotta | Metodo | Descrizione |
|---|---|---|
| `/proxy/<path>` | GET / HEAD | proxy verso `https://www.bungie.net`, con **allowlist** dei path e API key lato server |
| `/sync/<code>` | GET | legge il backup cloud (richiede `X-Sync-Secret`) |
| `/sync/<code>` | POST | salva il backup cloud (richiede `X-Sync-Secret`, max 256 KB) |
| `/sync/<code>` | DELETE | elimina il backup (richiede `X-Sync-Secret`, usato da "New code") |
| qualsiasi | OPTIONS | preflight CORS |

## Modello di sync

- **codice** (`<code>`): identificativo pubblico, può comparire negli screenshot.
- **secret** (`X-Sync-Secret`): 32 byte generati sul dispositivo. Il Worker salva solo il suo SHA-256 in `auth:<code>`; il backup è in `checklist:<code>`.
- Il codice completo da copiare tra dispositivi è `codice:secret`.
- Record **legacy** (creati prima di questa versione, senza `auth:`): leggibili con il solo codice finché un client non li reclama con un POST che include il secret. Un client nuovo lo fa automaticamente al primo avvio.
- Creare un record nuovo richiede sempre il secret.
- La rigenerazione crea il nuovo record, poi elimina il vecchio con il suo secret.
- Nota: il KV è eventualmente consistente, quindi dopo una cancellazione una lettura può restare stantia per circa un minuto.

## Cosa è cambiato rispetto al Worker precedente

- **Allowlist**: solo `Platform/Destiny2/Manifest/` e `common/destiny2_content/` sono proxabili (403 per tutto il resto). Niente URL assoluti, niente `..`, niente `//`.
- **Rate limit per IP**: 240 req/min sul proxy, 120/min in lettura sync, 60/min in scrittura sync. Usa il binding nativo `RATE_LIMITER` se configurato, altrimenti un contatore in-memory per isolate (best effort).
- **Cache edge** dei manifest (`caches.default`): le richieste ripetute non consumano la quota Bungie. L'indice è cachato 5 min, i JSON hashati 7 giorni.
- **CORS** ristretto: `Access-Control-Allow-Origin` viene emesso solo per `https://tigredomino.github.io` (più eventuali origin in `EXTRA_ORIGINS`).
- **Validazione sync**: codice `[A-Za-z0-9_-]{8,64}`, body max 256 KB, payload con `armor` array, `wishlist` max 500 voci, `bonusIcons` oggetto; le chiavi extra vengono scartate.
- **Header**: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` sul sync.
- **TTL** dei backup cloud: 365 giorni (`SYNC_TTL_DAYS`, `0` = per sempre). Il dato resta comunque in locale nel browser.

## Deploy

Serve Node.js (per `wrangler`) e un account Cloudflare con il Worker già esistente.

```bash
npm install -g wrangler
wrangler login

cd worker

# 1) Riusa il namespace KV ESISTENTE, altrimenti perdi i backup già sincronizzati
wrangler kv namespace list
#    copia l'id dentro wrangler.toml -> [[kv_namespaces]] id

# 2) La API key Bungie resta un secret, non va nel file
wrangler secret put BUNGIE_API_KEY

# 3) Deploy
wrangler deploy
```

Il Worker mantiene lo stesso nome (`d2-armor-proxy`): l'URL usato da `index.html`
(`https://d2-armor-proxy.alessioceccarelli95.workers.dev`) resta valido.

### Alternativa senza wrangler (dashboard Cloudflare)

1. Workers & Pages → `d2-armor-proxy` → **Edit code**
2. incolla il contenuto di `index.js`, **Deploy**
3. Settings → Variables → aggiungi il secret `BUNGIE_API_KEY`
4. Settings → Bindings → KV namespace `SYNC_KV` = namespace esistente
5. Settings → Variables → `SYNC_TTL_DAYS` = `365` (opzionale)

## Verifica dopo il deploy

```bash
B=https://d2-armor-proxy.alessioceccarelli95.workers.dev

# manifest: 200
curl -s -o /dev/null -w "%{http_code}\n" $B/proxy/Platform/Destiny2/Manifest/

# path fuori allowlist: 403
curl -s -o /dev/null -w "%{http_code}\n" $B/proxy/foo

# URL assoluto: 400 · traversal: 403
curl -s -o /dev/null -w "%{http_code}\n" "$B/proxy/https://example.com/"
curl -s -o /dev/null -w "%{http_code}\n" "$B/proxy/Platform/Destiny2/../x"

# sync senza secret su record reclamato: 401
curl -s -o /dev/null -w "%{http_code}\n" $B/sync/<codice-reclamato>

# sync: 404 con codice valido mai usato, 400 con codice non valido
curl -s -o /dev/null -w "%{http_code}\n" $B/sync/00000000000000000000
curl -s -o /dev/null -w "%{http_code}\n" $B/sync/1

# seconda chiamata al manifest: X-Proxy-Cache: HIT
curl -s -D - -o /dev/null $B/proxy/Platform/Destiny2/Manifest/ | Select-String -Pattern "X-Proxy-Cache|HTTP/"
```

## Test in locale

L'app su `http://127.0.0.1:8765` viene bloccata dalla CORS (è voluto). Per provarla
in locale aggiungi l'origin tra le variabili del Worker:

```toml
[vars]
EXTRA_ORIGINS = "http://127.0.0.1:8765,http://localhost:8765"
```

## Limiti noti

- Il rate limit in-memory è **per isolate**: con più isolate il limite effettivo è più alto. Per una protezione precisa abilita il binding `RATE_LIMITER` (piano paid, sezione commentata in `wrangler.toml`).
- `caches.default` non è disponibile con `wrangler dev --local` in modo identico alla produzione.
- Il Worker non autentica l'utente: chi conosce un codice di sync può leggere/scrivere quel backup (design attuale del client).
