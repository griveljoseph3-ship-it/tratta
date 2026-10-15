# Tratta

Gioco di guida nel browser (Three.js 0.160 via import map, nessuna installazione).

- **Grafica**: materiali PBR, cielo al tramonto (Sky shader), ombre morbide, nebbia, tone mapping ACES, bloom + SMAA, auto costruite con fari/stop luminosi, alberi, colline, case, lampioni, guardrail; FOV e vibrazione in base alla velocità. Qualità Alta/Media/Bassa dal pulsante ⚙.
- **Storia** (`story.js`): Luca "Tratta" Ferri, 7 capitoli con missioni (distanza, fuga, consegna, cronometro, sopravvivenza). Progressi in localStorage.
- **Polizia** (`police.js`): intercettazione predittiva, tattiche coordinate, ricercato 1–5, posti di blocco, chiodi, elicottero.
- **Traffico e difficoltà** (`difficulty.js`): traffico denso che cambia corsia, danni, near-miss, curva di difficoltà per missione.

Comandi: frecce o WASD, Spazio = nitro, Esc = capitoli. Su touch: pulsanti a schermo.

## v4 (ottobre 2026)
- Polizia: ogni volante è indipendente (reazione/abilità proprie, ruoli coordinati: sbarramento davanti, speronamento, affiancamento, sorpasso per chiudere), si schianta nel traffico o contro altre volanti. Non copia più lo sterzo.
- Traffico civile visibile da subito, ondate ed eventi casuali (carovana di camion, coda, auto veloce).
- Ogni corsa diversa: seme per partita (rng.js) per curve, traffico, polizia, eventi.
- Ora del giorno come nelle cutscene (cap. 1 di notte, fari, aloni dei lampioni, cielo notturno).
- Testacoda oltre il limite di aderenza (recuperabile controsterzando), polvere in derapata.
- Audio sintetizzato (audio.js): motore a strati sui giri, vento, rotolamento, stridio, sirene spaziali.
- Rallentatore + whoosh sui sorpassi al limite, hit-stop sugli urti forti, radio di Lola e Tano.
- Storia: prologo (debito di Dario, trattoria), colpi di scena solo nei cap. 3, 5 e finale.
- Prestazioni: pixel ratio max 1.5 su Alta, risoluzione adattiva, ombre più leggere.
