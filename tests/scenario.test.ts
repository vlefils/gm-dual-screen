import assert from "node:assert/strict";
import test from "node:test";
import {
  isEncounterMarkdown,
  parseEncounterMarkdown,
  splitScenarioMarkdown,
} from "../app/lib/scenario.ts";

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
