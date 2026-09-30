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

const inlineAbilitiesSheet = `## Dario Senn — FP 2

**CA** 15
**PV** 42
**Vitesse** 9 m

**FOR** 11 (+0) — **DEX** 16 (+3) — **CON** 14 (+2) — **ESPRIT** 15 (+2) — **CHA** 15 (+2)`;

const appendixSheetFormat = `## Annexe B — Fiches rapides

Ces valeurs sont prévues pour un plan en cases de 1,5 m.

### Agent Vescari ou agent Polk — FP 1/2 · 100 PX

*Humanoïde moyen · CA 14 (costume blindé) · PV 22 (4d8 + 4) · vitesse 9 m*

**FOR** 12 (+1) · **DEX** 14 (+2) · **CON** 12 (+1) · **INT** 10 (+0) · **SAG** 12 (+1) · **CHA** 10 (+0)
**Compétences :** Perception +3, Intimidation +2 ; **sens :** Perception passive 13.

**Tactique :** garde une sortie et agit avec un collègue.

**Action — Matraque à impulsion.** Attaque au corps à corps : +4.

### Shadow — aucune rencontre de combat · FP 0

*Petite bête implantée · CA 14 · PV 6 · vitesse 12 m, escalade 9 m*

**FOR** 3 (−4) · **DEX** 18 (+4) · **CON** 10 (+0) · **INT** 3 (−4) · **SAG** 14 (+2) · **CHA** 10 (+0) ; **Discrétion +6**, Perception passive 14.

**Camouflage optique.** Shadow devient difficile à distinguer.

Il n’attaque pas les PJ.

### Jonah Vale et Celeste Wren

Jonah n’est normalement pas un adversaire.`;

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

test("les caractéristiques regroupées sur une ligne sont séparées", () => {
  assert.equal(isEncounterMarkdown(inlineAbilitiesSheet), true);
  const sheet = parseEncounterMarkdown(inlineAbilitiesSheet);
  assert.equal(sheet.title, "Dario Senn");
  assert.equal(sheet.challengeRating, "FP 2");
  assert.deepEqual(sheet.abilities, [
    { label: "FOR", value: "11 (+0)" },
    { label: "DEX", value: "16 (+3)" },
    { label: "CON", value: "14 (+2)" },
    { label: "ESPRIT", value: "15 (+2)" },
    { label: "CHA", value: "15 (+2)" },
  ]);
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

test("les fiches rapides de niveau ### séparées par des points médians sont détectées", () => {
  const segments = splitScenarioMarkdown(appendixSheetFormat);
  assert.deepEqual(
    segments.map((segment) => segment.kind),
    ["markdown", "encounter", "encounter", "markdown"],
  );

  const agent = segments[1];
  assert.equal(agent.kind, "encounter");
  if (agent.kind !== "encounter") return;
  assert.equal(agent.sheet.headingLevel, 3);
  assert.equal(agent.sheet.title, "Agent Vescari ou agent Polk");
  assert.equal(agent.sheet.challengeRating, "FP 1/2");
  assert.equal(agent.sheet.subtitle, "Humanoïde moyen");
  assert.deepEqual(agent.sheet.vitals, [
    { label: "CA", value: "14 (costume blindé)" },
    { label: "PV", value: "22 (4d8 + 4)" },
    { label: "Vitesse", value: "9 m" },
  ]);
  assert.equal(agent.sheet.abilities.length, 6);
  assert.deepEqual(agent.sheet.details, [
    { label: "Compétences :", value: "Perception +3, Intimidation +2" },
    { label: "sens :", value: "Perception passive 13." },
  ]);
  assert.match(agent.sheet.bodyMarkdown, /^\*\*Tactique :\*\*/u);

  const shadow = segments[2];
  assert.equal(shadow.kind, "encounter");
  if (shadow.kind !== "encounter") return;
  assert.equal(shadow.sheet.title, "Shadow — aucune rencontre de combat");
  assert.equal(shadow.sheet.abilities.length, 6);
  assert.deepEqual(shadow.sheet.details, [
    { label: "Discrétion", value: "+6, Perception passive 14." },
  ]);
  assert.match(shadow.sheet.bodyMarkdown, /^\*\*Camouflage optique\./u);
});
