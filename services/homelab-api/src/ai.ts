import type { HomelabConfig } from "./config.js";

export type ClassifyInput = {
  subject?: string;
  snippet?: string;
};

export type ClassifyResult = {
  priority: "urgent" | "normal";
  source: "rules" | "remote_ai";
  model?: string;
  summary?: string;
};

/** Local rules always run; remote LLM only when allowAi + endpoint reachable. */
export async function classifyMessage(
  config: HomelabConfig,
  input: ClassifyInput,
  allowAi: boolean,
): Promise<ClassifyResult> {
  const urgent = /security|urgent|2fa|verification/i.test(input.subject ?? "");
  if (!allowAi || !config.openaiApiKey) {
    return {
      priority: urgent ? "urgent" : "normal",
      source: "rules",
    };
  }

  try {
    const response = await fetch(`${config.openaiApiBase}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.openaiApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.openaiModel,
        temperature: 0,
        messages: [
          {
            role: "system",
            content:
              'Classify email priority. Reply JSON only: {"priority":"urgent"|"normal","summary":"..."}',
          },
          {
            role: "user",
            content: JSON.stringify({
              subject: input.subject ?? "",
              snippet: input.snippet ?? "",
            }),
          },
        ],
      }),
    });
    if (!response.ok) {
      return {
        priority: urgent ? "urgent" : "normal",
        source: "rules",
      };
    }
    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) {
      return {
        priority: urgent ? "urgent" : "normal",
        source: "rules",
      };
    }
    const parsed = JSON.parse(match[0]) as {
      priority?: string;
      summary?: string;
    };
    const priority =
      parsed.priority === "urgent" || urgent ? "urgent" : "normal";
    return {
      priority,
      source: "remote_ai",
      model: config.openaiModel,
      summary:
        typeof parsed.summary === "string"
          ? parsed.summary.slice(0, 240)
          : undefined,
    };
  } catch {
    return {
      priority: urgent ? "urgent" : "normal",
      source: "rules",
    };
  }
}
