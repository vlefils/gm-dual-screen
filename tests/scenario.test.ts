import assert from "node:assert/strict";
import test from "node:test";
import {
  getScenarioOutline,
  isEncounterMarkdown,
  parseEncounterMarkdown,
  splitScenarioMarkdown,
} from "../app/lib/scenario.ts";

test("le plan du scénario crée des ancres stables et uniques", () => {
  const outline = getScenarioOutline(`# Le Hub

## [Entrée](https://example.com) dans les ruines

### Actions

\`\`\`
## Titre dans du code
\`\`\`

### Actions`);

  assert.deepEqual(outline, [
    { id: "le-hub", level: 1, label: "Le Hub" },
    {
      id: "entree-dans-les-ruines",
      level: 2,
      label: "Entrée dans les ruines",
    },
    { id: "actions", level: 3, label: "Actions" },
    { id: "actions-2", level: 3, label: "Actions" },
  ]);
});

const rexSheet = `# Rex Calder

*Légende du Hub, vétéran de la vieille école — FP 3*

Rex sait reconnaître la seconde exacte où une situation commence à tourner.

**CA** 15
**PV** 52
**Vitesse** 9 m

**FOR** 14 (+2)
**DEX** 17 (+3)
**CON** 16 (+3)
**ESPRIT** 16 (+3)
**CHA** 15 (+2)

**Jets de sauvegarde** DEX +5, CON +5, ESPRIT +5
**Sens** Perception passive 15

---

## Actions

### Fusil d’assaut balistique

**Dégâts : 1d10 + 3 perforants.**`;

const compactRexSheet = `## Rex Calder — FP 4

*Humain, mercenaire vétéran*

**CA** 16 (plaques tactiques)
**PV** 62
**Vitesse** 9 m
**Bonus de maîtrise** +2

**FOR** 14 (+2)
**DEX** 18 (+4)
**CON** 16 (+3)
**ESPRIT** 16 (+3)
**CHA** 15 (+2)

**Jets de sauvegarde** DEX +6, CON +5, ESPRIT +5
**Langues** commun, argot du Hub

### Vieux de la vieille

Rex ne peut pas être surpris tant qu’il est conscient.

### Actions

**Attaques multiples.** Rex effectue deux attaques.`;

test("une fiche d’encounter structurée est détectée", () => {
  assert.equal(isEncounterMarkdown(rexSheet), true);
  assert.equal(isEncounterMarkdown("# Jouer Rex en combat\n\nRex protège le groupe."), false);
});

test("les statistiques d’une fiche sont séparées du corps", () => {
  const sheet = parseEncounterMarkdown(rexSheet);
  assert.equal(sheet.title, "Rex Calder");
  assert.equal(sheet.challengeRating, "FP 3");
  assert.deepEqual(sheet.vitals, [
    { label: "CA", value: "15" },
    { label: "PV", value: "52" },
    { label: "Vitesse", value: "9 m" },
  ]);
  assert.equal(sheet.abilities.length, 5);
  assert.equal(sheet.details[0].label, "Jets de sauvegarde");
  assert.match(sheet.bodyMarkdown, /^## Actions/u);
});

test("la narration qui suit une fiche conserve un rendu normal", () => {
  const segments = splitScenarioMarkdown(
    `${rexSheet}\n\n# Jouer Rex en combat\n\nRex stabilise le groupe.`,
  );
  assert.equal(segments.length, 2);
  assert.equal(segments[0].kind, "encounter");
  assert.equal(segments[1].kind, "markdown");
});

test("une fiche compacte ouverte par ## adapte sa hiérarchie", () => {
  assert.equal(isEncounterMarkdown(compactRexSheet), true);
  const sheet = parseEncounterMarkdown(compactRexSheet);
  assert.equal(sheet.headingLevel, 2);
  assert.equal(sheet.title, "Rex Calder");
  assert.equal(sheet.challengeRating, "FP 4");
  assert.equal(sheet.details[0].label, "Bonus de maîtrise");
  assert.match(sheet.bodyMarkdown, /^### Vieux de la vieille/u);
});

test("une fiche ## peut vivre au milieu d’un chapitre normal", () => {
  const segments = splitScenarioMarkdown(
    `# Le Hub\n\nNotes de campagne.\n\n${compactRexSheet}\n\n## Après le combat\n\nRetour au calme.`,
  );
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["markdown", "encounter", "markdown"],
  );
});
