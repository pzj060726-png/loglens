import { COMBINED_RE, COMMON_RE, parseJsonLine } from "./parser.js";

/**
 * 从样本行里猜格式。
 * @returns {{ format: "combined"|"common"|"json"|"unknown", confidence: number, samples: number }}
 */
export function detectFormat(sampleLines) {
  const lines = (sampleLines || [])
    .map((line) => String(line).replace(/\r$/, "").trim())
    .filter(Boolean)
    .slice(0, 20);

  if (!lines.length) return { format: "unknown", confidence: 0, samples: 0 };

  let json = 0;
  let combined = 0;
  let common = 0;
  for (const line of lines) {
    if (line.startsWith("{")) {
      if (parseJsonLine(line)) json += 1;
    } else if (COMBINED_RE.test(line)) {
      combined += 1;
    } else if (COMMON_RE.test(line)) {
      common += 1;
    }
  }

  const total = lines.length;
  const pick = (format, hits) => ({ format, confidence: hits / total, samples: total });
  if (json * 2 >= total) return pick("json", json);
  if (combined * 2 >= total) return pick("combined", combined);
  if (common * 2 >= total) return pick("common", common);
  const best = Math.max(json, combined, common);
  return { format: "unknown", confidence: best / total, samples: total };
}
