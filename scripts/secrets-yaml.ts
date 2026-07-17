/**
 * Flat string-map YAML helpers for GalMail sops secrets.
 * Keeps values quoted so empty strings and URLs stay unambiguous.
 */
export function stringifyFlatSecretsYaml(
  data: Record<string, string>,
): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (key === "sops") continue;
    lines.push(`${key}: ${JSON.stringify(value ?? "")}`);
  }
  return `${lines.join("\n")}\n`;
}

export function parseSecretsDocument(
  text: string,
  path: string,
): Record<string, unknown> {
  const trimmed = text.trim();
  if (!trimmed) return {};
  if (path.endsWith(".json")) {
    return JSON.parse(trimmed) as Record<string, unknown>;
  }
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    const parsed = Bun.YAML.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path} did not decrypt to a YAML mapping`);
    }
    return parsed as Record<string, unknown>;
  }
  // Fall back: try JSON then YAML.
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const parsed = Bun.YAML.parse(trimmed);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${path} did not decrypt to a mapping`);
    }
    return parsed as Record<string, unknown>;
  }
}

export function isYamlSecretsPath(path: string): boolean {
  return path.endsWith(".yaml") || path.endsWith(".yml");
}
