import OpenAI from "openai";
import { AppError } from "./errors.js";

export const READING_DISCLAIMER =
  "AI-generated for entertainment and self-reflection only. It is not a factual assessment or medical, legal, financial, or mental-health advice. Do not use it to make important decisions.";

const PALM_READING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "overview", "lifeLine", "heartLine", "headLine", "guidance", "affirmation"],
  properties: {
    title: { type: "string" },
    overview: { type: "string" },
    lifeLine: { type: "string" },
    heartLine: { type: "string" },
    headLine: { type: "string" },
    guidance: { type: "string" },
    affirmation: { type: "string" }
  }
};

const FALLBACK = Object.freeze({
  title: "A quiet moment of reflection",
  overview:
    "This image offers a gentle pause to notice your own hopes, habits, and strengths. Keep only the ideas that feel useful to you.",
  lifeLine:
    "In traditional palmistry, the life line can be used as a playful prompt to reflect on your pace, rest, and resilience—not as a statement about health or lifespan.",
  heartLine:
    "The heart line can be a friendly cue to consider how you share care, boundaries, and connection in the relationships that matter to you.",
  headLine:
    "The head line can invite reflection on the balance between curiosity, practical choices, and making time to hear your own perspective.",
  guidance:
    "Choose one small, kind action that feels grounded today, and let your real experiences—not a palm reading—guide what comes next.",
  affirmation: "I can meet today with curiosity, steadiness, and self-trust."
});

const UNSAFE_LANGUAGE = /\b(?:medical|diagnos(?:e|is|tic)|disease|illness|symptom|treatment|medication|mental[ -]?health|legal|law(?:suit|yer)|financial|invest(?:ment|ing)|debt|pregnan(?:t|cy)|death|die|lifespan|life span|suicide|self[- ]harm|guarantee(?:d)?|certain(?:ly)?|fate(?:d)?|inevitable)\b|\b(?:you|your)\s+(?:will|are going to)\b/i;

const INSTRUCTIONS = `
You create short, kind palmistry reflections from a palm photograph.

Treat palmistry as imaginative entertainment and self-reflection only, never as fact. Do not diagnose, assess, predict, guarantee, or make deterministic claims. Never provide medical, health, mental-health, legal, financial, safety, pregnancy, death, lifespan, or relationship-outcome advice or claims. Do not infer identity, age, gender, ethnicity, or personality as fact.

Use tentative, inviting language such as "may invite reflection on" or "can be read as a prompt to." If the image is unclear, keep the response general and gentle. Keep each field concise, warm, and practical. Return only content matching the requested JSON schema.
`.trim();

function outputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts = response?.output
    ?.flatMap((item) => item?.content ?? [])
    ?.filter((content) => content?.type === "output_text" && typeof content.text === "string")
    ?.map((content) => content.text);

  return parts?.join("\n") ?? "";
}

function compactText(value, fallback, maxLength) {
  if (typeof value !== "string") return fallback;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (text.length < 8 || UNSAFE_LANGUAGE.test(text)) return fallback;
  return Array.from(text).slice(0, maxLength).join("");
}

function normalizeStructuredReading(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AppError(502, "ANALYSIS_FAILED", "The reading service returned an unusable response. Please try again.");
  }

  const title = compactText(value.title, FALLBACK.title, 90);
  const overview = compactText(value.overview, FALLBACK.overview, 420);
  const lifeLine = compactText(value.lifeLine, FALLBACK.lifeLine, 300);
  const heartLine = compactText(value.heartLine, FALLBACK.heartLine, 300);
  const headLine = compactText(value.headLine, FALLBACK.headLine, 300);
  const guidance = compactText(value.guidance, FALLBACK.guidance, 300);
  const affirmation = compactText(value.affirmation, FALLBACK.affirmation, 180);

  return {
    title,
    overview,
    sections: [
      { id: "life", label: "Life line", insight: lifeLine },
      { id: "heart", label: "Heart line", insight: heartLine },
      { id: "head", label: "Head line", insight: headLine },
      { id: "guidance", label: "A grounded note", insight: guidance }
    ],
    affirmation
  };
}

function userPrompt(name) {
  return `Create a concise, gentle reflection for ${name}. The attached image is only a visual reference. Keep it imaginative and non-deterministic.`;
}

export function createReadingService(config) {
  const client = new OpenAI({
    apiKey: config.openaiApiKey,
    timeout: 45_000,
    maxRetries: 1
  });

  async function analyzePalm({ name, imageUrl }) {
    try {
      const response = await client.responses.create({
        model: config.openaiModel,
        store: false,
        max_output_tokens: 450,
        instructions: INSTRUCTIONS,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: userPrompt(name) },
              { type: "input_image", image_url: imageUrl, detail: "high" }
            ]
          }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "palm_reading",
            strict: true,
            schema: PALM_READING_SCHEMA
          }
        }
      });

      const text = outputText(response);
      if (!text) {
        throw new AppError(502, "ANALYSIS_FAILED", "The reading service did not return a result. Please try again.");
      }

      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new AppError(502, "ANALYSIS_FAILED", "The reading service returned an invalid result. Please try again.");
      }
      return normalizeStructuredReading(parsed);
    } catch (error) {
      if (error instanceof AppError) throw error;

      const upstreamStatus = Number(error?.status);
      if (upstreamStatus === 404) {
        console.error("OpenAI model is unavailable for this project", {
          model: config.openaiModel,
          status: upstreamStatus,
          name: error?.name
        });
        throw new AppError(
          503,
          "MODEL_UNAVAILABLE",
          "This OpenAI key does not have access to the palm-reading vision model. Use an API project with a vision language model, then update OPENAI_MODEL in server/.env.",
          { expose: true }
        );
      }

      if (upstreamStatus === 400 || upstreamStatus === 401 || upstreamStatus === 403) {
        console.error("OpenAI request configuration failed", { status: upstreamStatus, name: error?.name });
      } else {
        console.error("OpenAI palm analysis failed", { status: upstreamStatus || undefined, name: error?.name });
      }
      throw new AppError(503, "SERVICE_UNAVAILABLE", "The reading service is temporarily unavailable. Please try again shortly.");
    }
  }

  return Object.freeze({ analyzePalm });
}
