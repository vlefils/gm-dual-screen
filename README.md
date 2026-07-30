# Écran du MJ

Application locale en double écran pour préparer des scènes, révéler
progressivement une carte et afficher des illustrations aux joueurs.

## Utilisation

1. Lancez l’application puis préparez une scène avec une carte, des zones et
   une galerie.
2. Passez en mode **Direct**.
3. Cliquez sur **Ouvrir l’écran joueurs**, déplacez cette fenêtre sur le second
   écran puis activez son plein écran.
4. Pilotez le brouillard, le cadrage et l’illustration depuis la console MJ.

Les deux fenêtres doivent rester dans le même navigateur. Les données sont
enregistrées uniquement sur cet ordinateur avec IndexedDB. Utilisez
**Exporter tout** pour conserver une sauvegarde indépendante du navigateur.

## Développement

Prérequis : Node.js 22 ou supérieur.

```bash
npm install
npm run dev
npm test
npm run build
npm run build:pages
```

`npm run build:pages` produit le site statique dans `out/`. Le workflow
`.github/workflows/deploy-pages.yml` publie automatiquement ce dossier sur
GitHub Pages après un push sur `main` ou `master`.

## Données prises en charge

- cartes et illustrations PNG, JPEG ou WebP, jusqu’à 30 Mo par fichier ;
- scènes, zones rectangulaires ou polygonales et révélations à la gomme ;
- édition des sommets et fusion automatique des frontières polygonales adjacentes ;
- révélation directe d’une zone en cliquant son contour dans la console MJ ;
- sauvegarde complète `.mjscreen` avec fusion non destructive à l’import.
