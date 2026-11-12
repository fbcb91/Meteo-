# Cielo

Un sito meteo moderno e semplice: una sola pagina, previsioni chiare e un assistente AI che ti dice in due righe cosa aspettarti.

- Meteo attuale, ora per ora e a 7 giorni, con sfondo che cambia in base al tempo (sole, notte, pioggia, neve…)
- Ricerca città con suggerimenti, posizione attuale, città preferite, link condivisibile
- Dettagli: vento, umidità, UV, pioggia, pressione, visibilità, qualità dell'aria, alba e tramonto
- **Il punto**: sintesi del meteo e risposte a domande libere ("Posso fare una grigliata sabato?") generate da Claude

I dati arrivano da [Open-Meteo](https://open-meteo.com/) (gratuito, senza chiave API).

## Struttura

| File | Cosa fa |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | Il sito. HTML/CSS/JS puri, nessuna build |
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
