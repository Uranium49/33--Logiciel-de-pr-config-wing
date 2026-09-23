# Wing Configurator (Electron)

Version Electron du préconfigurateur Behringer Wing — remplace la version WPF (`../src`),
conservée dans le dépôt mais plus activement développée.

## Lancer en dev

```
npm install
npm start
```

## Construire un .exe portable

```
npm run dist
```

Le `.exe` portable est généré dans `dist/`.

## Structure

- `main.js` — process principal Electron (fenêtre, dialogues fichier).
- `src/core/` — logique métier pure (aucune dépendance Electron/DOM) :
  - `model.js` — modèle de données + gabarits.
  - `allocator.js` — moteur d'allocation entrées/bus (port du C# `ResourceAllocator`).
  - `oscAddresses.js` — adresses OSC Wing (port du C# `WingOscAddresses`).
  - `scenePlanner.js` — génère les messages OSC à partir du plan (mesh talkback inclus).
  - `exporter.js` — export script OSC + fiche de patch CSV.
  - `oscClient.js` — envoi UDP réel vers la console (package `osc`).
- `src/renderer/` — interface (vanilla JS, pas de framework) : 2 écrans, Configuration et
  Patch physique, navigables depuis la barre latérale.

## Points à vérifier sur le matériel réel

- Les codes de groupe de connexion d'entrée (`LCL`, `A50A`, `A50B`, `CRD`, `USB` dans
  `model.js` → `WING_INPUT_GROUPS`) sont une estimation, non confirmée dans la documentation
  publique. À corriger si la console renvoie une erreur ou n'assigne pas la bonne source.
