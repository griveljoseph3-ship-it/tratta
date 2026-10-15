# TRATTA — stato rispetto alla specifica di Joseph (spec 1.0, 15 ott 2026)

Legenda: **Fatto** · **In corso** · **Da fare**. Aggiornato a ogni milestone.

## Fase 1 — Fondazione v7 (milestone attuale)
| Voce spec | Stato | Note |
|---|---|---|
| 4.1.1 Collegare models.js + assets, via le geometrie procedurali | Fatto | models.js (GLTFLoader + meshopt), world.js; cars.js / environments.js / models/ eliminati. Auto, scenografia, set della trattoria e cutscene ora usano tutti modelli Kenney |
| 4.4.1 road.js collegato (curve, salite, dossi, salti) | Fatto | strada su spline, quota + beccheggio, fisica in volo e atterraggio |
| 4.4.5 Montagna con tornanti a 180° | Fatto | tornanti esatti, guardrail, parete in salita / dirupo; Cap. 4 ora si gioca al Passo del Lupo |
| 4.4.3 Giungla rifatta | Fatto | palme, alberi grandi, felci, rocce (Nature Kit, ricolorati con palette naturale) |
| 4.7 Polizia/traffico sulla nuova strada | Fatto | rallentano prima di curve e tornanti (curveLimit), seguono la spline |
| 4.4.2 Chunk + nebbia | In corso | riciclo a finestra mobile (640 m) + FogExp2; chunk espliciti da 80-150 m da fare |
| 4.3 HUD stile Forza (prima versione) | In corso | tachimetro con arco giri/marcia/nitro/HP, minimappa, stelle animate, cluster touch GAS/FRENO/DRIFT/NITRO con glow e vibrazione, slider di sterzo |
| 4.11 60 fps su iPad Pro 3 | Da confermare | test perf headless a ogni milestone; serve una prova sul dispositivo |

## Fase 2 — Salto grafico: Da fare
PBR + normal map, bloom selettivo (solo Alta), asfalto bagnato, luci neon (Point), color grading/vignetta, particelle.

## Fase 3 — HUD professionale (rifinitura): Da fare
Animazioni, menu/pausa/garage coerenti, tilt e volante virtuale.

## Fase 4 — Juice: Da fare
Segni delle gomme, scintille, fumo, scarico, camera con look-ahead.

## Fase 5 — Meta e storia: Da fare
Economia/officina/garage 3D/abilità/identità/musica dai file in tratta-modules, medaglie, bivi, scelte, lore.

## Fase 6 — Feature freeze: Da fare
