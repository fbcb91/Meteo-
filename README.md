# Cielo

Il meteo che ti risponde: prima una frase chiara su cosa aspettarti, poi i numeri.

- **Il titolo**: la cosa che conta, in poche parole ("Ombrello dalle 17."), scritta da Claude o, senza AI, calcolata nel browser
- **Pioggia nelle prossime 2 ore**, a passi di 15 minuti
- **Il mio meteo**: dici una volta dove vivi, in quali fasce orarie sei fuori casa, come ti sposti, cosa ti piace fare e a cosa sei allergico; la pagina risponde su quello. Il profilo resta nel browser
- **Quando conviene?**: i tre momenti migliori dei prossimi 7 giorni per grigliata, gita, lavori all'aperto, vela e altro, pesati per affidabilità
- **Mare e vento** nello stesso posto: vento in nodi o km/h con nome (Scirocco, Maestrale…) e forza Beaufort, onde, mare lungo, temperatura dell'acqua, ora per ora
- **Pioggia sulla mappa** a richiesta: il radar delle ultime 2 ore e la previsione delle prossime 24 in un'unica animazione, su contorni ospitati nel sito. La previsione è disegnata nel browser da una griglia di punti Open-Meteo. Si scarica solo se la apri
- **Il momento giusto**: le ore migliori per corsa, bici, bucato, tavolino all'aperto, stelle e spiaggia
- **Affidabilità** di ogni giorno, dal confronto tra i modelli ECMWF, ICON e GFS
- **Da tenere d'occhio**: vento forte, piogge abbondanti, gelo, caldo, UV (segnalazioni calcolate, non allerte ufficiali)
- **Aria e salute**: qualità dell'aria, UV con orari di protezione, pollini
- Ora per ora, 7 giorni, confronto con ieri, mare (vicino alla costa), luna, ore di luce
- **Italia adesso**: le principali città a colpo d'occhio
- Su desktop è un sito (navigazione fissa, cielo a tutta larghezza, fasce orizzontali); su telefono resta compatto come un'app
- Ricerca città, posizione, preferiti, condivisione, installabile come app
- **Chiedi a Cielo**: domande libere ("Posso grigliare sabato sera?")

Niente pubblicità né tracciamento. I dati arrivano da [Open-Meteo](https://open-meteo.com/) (gratuito per uso non commerciale, senza chiave API); il radar da [RainViewer](https://www.rainviewer.com/api.html).

## Struttura

| Percorso | Cosa fa |
| --- | --- |
| `page.html`, `styles.css`, `app.js` | L'app: HTML/CSS/JS puri, nessuna build. `page.html` è il modello che il server completa |
| `api/page.js` | Genera le pagine: home, `/meteo/<città>`, `/regioni/<regione>`, `/meteo`, `/come-funziona`, `/privacy`, 404 |
| `api/sitemap.js` | `/sitemap.xml` (tutte le città) e `/robots.txt` |
| `api/place.js` | Dalle coordinate alla pagina della città più vicina |
| `api/ai.js` | Chiama Claude per titolo e risposte |
| `lib/` | Codice condiviso dalle funzioni e testi delle pagine statiche |
| `data/places.json` | 8.377 comuni italiani con coordinate (GeoNames, CC BY 4.0), generato con `npm run build:places` |
| `vendor/` | Leaflet (BSD-2) e i contorni di coste e confini per la mappa (Natural Earth), generati con `npm run build:map` |
| `fonts/`, `icons/`, `icon.svg`, `og.png`, `manifest.webmanifest` | Carattere Bricolage Grotesque (OFL), icone, immagine per i social |
| `vercel.json` | Indirizzi, cache e intestazioni di sicurezza |

## Come ci trovano i motori di ricerca

Ogni comune ha una pagina propria, `/meteo/bologna`, che il server restituisce già completa: titolo e descrizione con i dati del giorno, un testo con le previsioni di oggi, domani e della settimana, dati strutturati (percorso di navigazione e pagina) e collegamenti alle città vicine. La CDN tiene ogni pagina in cache per mezz'ora, quindi il servizio meteo viene interrogato al massimo due volte l'ora per città.

Le pagine di regione e l'elenco `/meteo` collegano tutte le città tra loro; `/sitemap.xml` le elenca tutte. I link con coordinate (`/?lat=…`), usati per le località fuori elenco, non vengono indicizzati.

## Provarlo in locale

```bash
npm install
```

```bash
npm run dev
```

Il server locale (`tools/dev.mjs`) imita Vercel: stessi indirizzi, stesse intestazioni, stesse funzioni. Senza `ANTHROPIC_API_KEY` il sito funziona senza la parte AI: titolo e risposte rapide vengono calcolati nel browser.

## Mettere online

Il progetto è pronto per [Vercel](https://vercel.com/), senza configurazione di build. Variabili d'ambiente (*Settings → Environment Variables*):

| Variabile | A cosa serve |
| --- | --- |
| `ANTHROPIC_API_KEY` | Attiva titolo e risposte dell'AI. Creala su [platform.claude.com](https://platform.claude.com/) e imposta un limite di spesa |
| `SITE_URL` | Indirizzo definitivo del sito (es. `https://www.esempio.it`): finisce in canonical, sitemap e anteprime social. Senza, viene usato l'indirizzo della richiesta |
| `GOOGLE_SITE_VERIFICATION` | Codice di verifica di Google Search Console (facoltativo) |

Prima del lancio:

1. Collega un dominio tuo e imposta `SITE_URL`.
2. Completa i punti segnati **[DA COMPLETARE]** in `lib/docs.js` (email di contatto del titolare nella pagina privacy).
3. Verifica il sito su Google Search Console e invia `/sitemap.xml`.
4. Open-Meteo è gratuito solo per uso non commerciale e con limiti di richieste: per un sito pubblico con traffico serve il loro piano a pagamento.

L'endpoint `/api/ai` è pubblico e consuma crediti: ha un freno di base per indirizzo, ma il limite vero è quello di spesa sulla chiave. Il modello usato è definito in cima a `api/ai.js`.
