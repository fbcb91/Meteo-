# Cielo

Il meteo che ti risponde: prima una frase chiara su cosa aspettarti, poi i numeri.

- **Il titolo**: la cosa che conta, in poche parole ("Ombrello dalle 17."), scritta da Claude o, senza AI, calcolata nel browser
- **Pioggia nelle prossime 2 ore**, a passi di 15 minuti
- **Il momento giusto**: le ore migliori per corsa, bici, bucato, tavolino all'aperto, stelle e spiaggia
- **Affidabilità** di ogni giorno, dal confronto tra i modelli ECMWF, ICON e GFS
- **Da tenere d'occhio**: vento forte, piogge abbondanti, gelo, caldo, UV (segnalazioni calcolate, non allerte ufficiali)
- **Aria e salute**: qualità dell'aria, UV con orari di protezione, pollini
- Ora per ora, 7 giorni, confronto con ieri, mare (vicino alla costa), luna, ore di luce
- Ricerca città, posizione, preferiti, condivisione, installabile come app
- **Chiedi a Cielo**: domande libere ("Posso grigliare sabato sera?")

Niente pubblicità né tracciamento. I dati arrivano da [Open-Meteo](https://open-meteo.com/) (gratuito per uso non commerciale, senza chiave API).

## Struttura

| File | Cosa fa |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Il sito. HTML/CSS/JS puri, nessuna build |
| `fonts/`, `icons/`, `icon.svg`, `manifest.webmanifest` | Carattere Bricolage Grotesque (licenza OFL) e icone dell'app |
| `api/ai.js` | Funzione serverless che chiama Claude per sintesi e risposte |

## Provarlo in locale

```bash
npx serve .
```

Così il sito funziona senza la parte AI: la sintesi e le quattro domande rapide vengono calcolate nel browser dai dati di previsione, e il campo per le domande libere resta nascosto.

## Pubblicarlo con l'AI attiva

Il progetto è pronto per [Vercel](https://vercel.com/):

1. Importa il repository su Vercel (nessuna configurazione di build).
2. In *Settings → Environment Variables* aggiungi `ANTHROPIC_API_KEY` con una chiave creata su [platform.claude.com](https://platform.claude.com/).
3. Fai il deploy.

La chiave resta sul server. L'endpoint `/api/ai` accetta solo coordinate e una domanda breve, scarica da solo i dati meteo e mette in cache le sintesi per 15 minuti. È comunque un endpoint pubblico che consuma crediti: imposta un limite di spesa sulla chiave e, se il traffico cresce, aggiungi un rate limit.

Il modello usato è definito in cima a `api/ai.js`.

Su un hosting solo statico (es. GitHub Pages) il sito funziona lo stesso, senza la parte AI.
