// Pagine di solo testo. L'HTML è scritto a mano qui perché sono poche e cambiano di rado.

export const DOCS = {
  "come-funziona": {
    title: "Come funziona Cielo: da dove vengono le previsioni",
    description: "Da dove arrivano i dati di Cielo, come calcoliamo l'affidabilità delle previsioni e cosa fa l'intelligenza artificiale.",
    html: `<p class="crumbs"><a href="/">Meteo Italia</a> › Come funziona</p>
<h1>Come funziona Cielo</h1>
<p class="lede">Un sito meteo dovrebbe dirti cosa aspettarti e quanto fidarti. Qui spieghiamo come lo facciamo, limiti compresi.</p>

<h2>Da dove vengono le previsioni</h2>
<p>I dati arrivano da <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, che raccoglie e distribuisce i risultati dei modelli dei principali centri meteorologici: ECMWF (europeo), ICON (tedesco), GFS (americano) e altri. Non abbiamo un nostro modello: usiamo gli stessi calcoli su cui si basano i servizi meteo nazionali, e ci concentriamo su come spiegarteli.</p>

<h2>Quanto fidarsi: le tacche di affidabilità</h2>
<p>Per ogni giorno chiediamo la stessa previsione a tre modelli diversi (ECMWF, ICON e GFS) e li confrontiamo. Se concordano su temperatura e pioggia, la previsione è solida e vedi tre tacche. Se uno dice pioggia e l'altro sereno, te lo diciamo con una tacca sola. Di norma l'affidabilità cala con i giorni: oltre il quarto o quinto giorno è normale vederne meno.</p>

<h2>La pioggia delle prossime ore</h2>
<p>La striscia in alto mostra la pioggia prevista nelle prossime due ore, a passi di 15 minuti. Sulla mappa, fino ad «adesso» vedi la pioggia osservata dai radar (dati <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>); da lì in poi è la previsione dei modelli, calcolata su una griglia di punti: mostra bene dove passa una perturbazione, non il singolo rovescio.</p>

<h2>Cosa fa l'intelligenza artificiale</h2>
<p>Il titolo in alto e le risposte alle domande libere sono scritti da un modello linguistico (Claude, di Anthropic), che riceve solo i dati di previsione della città e la tua domanda. Non inventa numeri: riassume quelli che gli diamo. Può comunque sbagliare, per questo i dati completi sono sempre visibili sotto. Tutto il resto della pagina (momenti migliori, avvisi, affidabilità) è calcolato con regole fisse, senza AI.</p>

<h2>«Da tenere d'occhio» non è un'allerta ufficiale</h2>
<p>Le segnalazioni su vento, piogge intense, gelo o caldo sono calcolate da noi sui dati di previsione. Non sostituiscono le allerte della Protezione Civile, che restano il riferimento in caso di maltempo: le trovi su <a href="https://www.protezionecivile.gov.it/" target="_blank" rel="noopener">protezionecivile.gov.it</a>.</p>

<h2>Niente pubblicità, niente tracciamento</h2>
<p>Cielo non mostra pubblicità e non usa cookie di profilazione. Le tue preferenze (città di casa, attività, fasce orarie) restano nel tuo browser. I dettagli sono nella <a href="/privacy">pagina sulla privacy</a>.</p>`,
  },

  privacy: {
    title: "Privacy",
    description: "Quali dati tratta Cielo, dove restano e a quali servizi esterni vengono inviati.",
    html: `<p class="crumbs"><a href="/">Meteo Italia</a> › Privacy</p>
<h1>Privacy</h1>
<p class="lede">In breve: non creiamo account, non mostriamo pubblicità e non usiamo cookie di profilazione. Qui sotto trovi cosa succede ai dati quando usi il sito.</p>

<h2>Titolare del trattamento</h2>
<p><strong>[DA COMPLETARE: nome o ragione sociale del titolare, indirizzo e un contatto email]</strong></p>

<h2>Cosa resta sul tuo dispositivo</h2>
<p>Le preferenze che imposti (città di casa, città preferite, fasce orarie, attività, allergie ai pollini, unità di misura) sono salvate nella memoria del tuo browser (<em>localStorage</em>). Non vengono inviate ai nostri server e puoi cancellarle in ogni momento da «Il mio meteo → Cancella tutto» o dalle impostazioni del browser. Non usiamo cookie.</p>

<h2>Dati inviati a servizi esterni</h2>
<p>Per funzionare, il sito contatta dal tuo browser alcuni servizi, che ricevono il tuo indirizzo IP e i dati indicati:</p>
<ul>
  <li><strong>Open-Meteo</strong> (previsioni, qualità dell'aria, mare, ricerca delle città): le coordinate della località che stai guardando e il testo che scrivi nella ricerca.</li>
  <li><strong>BigDataCloud</strong> (solo se premi «Usa la mia posizione»): le coordinate del dispositivo, arrotondate a circa un chilometro, per ricavare il nome della località.</li>
  <li><strong>RainViewer</strong> (solo se apri la mappa della pioggia): le porzioni di mappa richieste.</li>
  <li><strong>Anthropic</strong> (titolo e risposte dell'assistente): le coordinate e il nome della località e, se fai una domanda, il testo della domanda. La richiesta passa dal nostro server; non inviamo il tuo profilo personale.</li>
</ul>

<h2>Posizione</h2>
<p>La posizione del dispositivo viene letta solo se premi il pulsante apposito e dopo il consenso del browser. Non viene conservata sui nostri server.</p>

<h2>Dati tecnici</h2>
<p>Il servizio di hosting (Vercel) registra dati tecnici delle richieste, come indirizzo IP e pagina visitata, per sicurezza e funzionamento del servizio. <strong>[DA COMPLETARE se si attivano strumenti di statistica]</strong></p>

<h2>I tuoi diritti</h2>
<p>Puoi chiedere accesso, rettifica o cancellazione dei dati che ti riguardano scrivendo al titolare, e proporre reclamo al Garante per la protezione dei dati personali.</p>`,
  },
};
