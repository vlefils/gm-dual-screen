export type EncounterField = {
  label: string;
  value: string;
};

export type EncounterSheetData = {
  headingLevel: 1 | 2;
  title: string;
  subtitle: string | null;
  challengeRating: string | null;
  descriptionMarkdown: string;
  vitals: EncounterField[];
  abilities: EncounterField[];
  details: EncounterField[];
  bodyMarkdown: string;
};

export type ScenarioSegment =
  | { kind: "markdown"; markdown: string }
  | { kind: "encounter"; markdown: string; sheet: EncounterSheetData };

const VITAL_LABELS = new Map([
  ["CA", "CA"],
  ["PV", "PV"],
  ["VITESSE", "Vitesse"],
]);

const ABILITY_LABELS = new Set([
  "FOR",
  "DEX",
  "CON",
  "INT",
  "SAG",
  "ESPRIT",
  "CHA",
]);

function normalizedLabel(label: string): string {
  return label
    .trim()
    .replace(/\s*[:.]\s*$/u, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toUpperCase();
}

function parseField(line: string): EncounterField | null {
  const match = /^\s*(?:[-+*]\s+)?\*\*([^*]+)\*\*\s+(.+?)\s*$/u.exec(line);
  if (!match) return null;
  return { label: match[1].trim(), value: match[2].trim() };
}

function introMarkdown(markdown: string): string {
  const lines = markdown.split(/\r\n|\r|\n/u);
  for (let index = 1; index < lines.length; index += 1) {
    if (/^\s*---\s*$/u.test(lines[index]) || /^#{1,6}\s+/u.test(lines[index])) {
      return lines.slice(0, index).join("\n");
    }
  }
  return lines.join("\n");
}

export function isEncounterMarkdown(markdown: string): boolean {
  const intro = introMarkdown(markdown);
  const fields = intro
    .split(/\r\n|\r|\n/u)
    .map(parseField)
    .filter((field): field is EncounterField => Boolean(field));
  const labels = fields.map((field) => normalizedLabel(field.label));
  const vitalCount = labels.filter((label) => VITAL_LABELS.has(label)).length;
  const abilityCount = labels.filter((label) => ABILITY_LABELS.has(label)).length;
  const hasChallengeRating = /\bFP\s*[0-9]+(?:[.,/]\d+)?/iu.test(intro);
  return vitalCount >= 2 && (abilityCount >= 3 || hasChallengeRating);
}

function findBodyStart(lines: string[]): { introEnd: number; bodyStart: number } {
  let foundEncounterField = false;
  for (let index = 1; index < lines.length; index += 1) {
    const field = parseField(lines[index]);
    if (field) {
      const label = normalizedLabel(field.label);
      if (VITAL_LABELS.has(label) || ABILITY_LABELS.has(label)) {
        foundEncounterField = true;
      }
    }
    if (foundEncounterField && /^\s*---\s*$/u.test(lines[index])) {
      return { introEnd: index, bodyStart: index + 1 };
    }
    if (foundEncounterField && /^#{1,6}\s+/u.test(lines[index])) {
      return { introEnd: index, bodyStart: index };
    }
  }
  return { introEnd: lines.length, bodyStart: lines.length };
}

export function parseEncounterMarkdown(markdown: string): EncounterSheetData {
  const lines = markdown.split(/\r\n|\r|\n/u);
  const headingMatch = /^(#{1,2})\s+(.+)$/u.exec(lines[0] ?? "");
  const headingLevel = (headingMatch?.[1].length === 2 ? 2 : 1) as 1 | 2;
  const rawTitle = headingMatch?.[2].trim() || "Encounter";
  const title =
    rawTitle
      .replace(/\s*[—–-]\s*FP\s*[0-9]+(?:[.,/]\d+)?\s*$/iu, "")
      .trim() || rawTitle;
  const { introEnd, bodyStart } = findBodyStart(lines);
  let cursor = 1;
  while (cursor < introEnd && !lines[cursor].trim()) cursor += 1;

  let subtitle: string | null = null;
  const subtitleMatch = /^\s*(?:\*([^*]+)\*|_([^_]+)_)\s*$/u.exec(
    lines[cursor] ?? "",
  );
  if (subtitleMatch) {
    subtitle = (subtitleMatch[1] ?? subtitleMatch[2]).trim();
    cursor += 1;
  }

  const vitals: EncounterField[] = [];
  const abilities: EncounterField[] = [];
  const details: EncounterField[] = [];
  const descriptionLines: string[] = [];

  for (let index = cursor; index < introEnd; index += 1) {
    const line = lines[index];
    const field = parseField(line);
    if (!field) {
      descriptionLines.push(line);
      continue;
    }
    const label = normalizedLabel(field.label);
    const vitalLabel = VITAL_LABELS.get(label);
    if (vitalLabel) {
      vitals.push({ ...field, label: vitalLabel });
    } else if (ABILITY_LABELS.has(label)) {
      abilities.push({ ...field, label });
    } else {
      details.push(field);
    }
  }

  const challengeMatch = /\bFP\s*([0-9]+(?:[.,/]\d+)?)/iu.exec(
    `${rawTitle}\n${subtitle ?? ""}\n${lines.slice(cursor, introEnd).join("\n")}`,
  );

  return {
    headingLevel,
    title,
    subtitle,
    challengeRating: challengeMatch ? `FP ${challengeMatch[1]}` : null,
    descriptionMarkdown: descriptionLines
      .join("\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim(),
    vitals,
    abilities,
    details,
    bodyMarkdown: lines.slice(bodyStart).join("\n").trim(),
  };
}

export function splitScenarioMarkdown(markdown: string): ScenarioSegment[] {
  if (!markdown.trim()) return [];
  const headings = [...markdown.matchAll(/^(#{1,2})\s+.+$/gmu)].map(
    (match) => ({
      index: match.index ?? 0,
      level: match[1].length,
    }),
  );
  const segments: ScenarioSegment[] = [];
  let cursor = 0;
  let headingIndex = 0;

  while (headingIndex < headings.length) {
    const heading = headings[headingIndex];
    if (heading.index < cursor) {
      headingIndex += 1;
      continue;
    }
    const boundary = headings
      .slice(headingIndex + 1)
      .find((candidate) => candidate.level <= heading.level);
    const end = boundary?.index ?? markdown.length;
    const section = markdown.slice(heading.index, end).trim();
    if (isEncounterMarkdown(section)) {
      const before = markdown.slice(cursor, heading.index);
      if (before.trim()) segments.push({ kind: "markdown", markdown: before });
      segments.push({
        kind: "encounter",
        markdown: section,
        sheet: parseEncounterMarkdown(section),
      });
      cursor = end;
    }
    headingIndex += 1;
  }

  const remainder = markdown.slice(cursor);
  if (remainder.trim()) segments.push({ kind: "markdown", markdown: remainder });

  return segments.length ? segments : [{ kind: "markdown", markdown }];
}
