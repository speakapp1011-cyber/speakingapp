// Vercel serverless function
// Keeps the Gemini API key on the server side — never exposed to the browser.
// Required environment variable: GEMINI_API_KEY
//
// Extracts conversational English phrases (not a word list) from a photo of
// study material, along with a Japanese meaning, an example sentence, and a
// short usage/nuance note. This is the ONLY AI call in the whole app —
// everything else (review/edit, saving, dedup, prompt generation, review
// selection) happens entirely client-side to keep Gemini usage minimal.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }

  try {
    const { imageBase64, mimeType, images } = req.body || {};
    // 複数枚は1回のGemini呼び出しにまとめる（単一画像の旧形式も後方互換で対応）
    const list = Array.isArray(images) && images.length
      ? images.slice(0, 6)
      : imageBase64 ? [{ imageBase64, mimeType }] : [];
    if (list.length === 0) {
      res.status(400).json({ error: "images is required" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const prompt = `あなたは英語学習教材のページ写真から、ページ上に示されている英語表現を読み取るアシスタントです。
写真に載っている英語の表現（フレーズ・文・慣用表現など）を、ページに書かれているとおりにすべて抽出してください。件数の上限はありません。写真に載っているものは漏れなく拾ってください。
各表現について、次の2つをページの記載から取得してください。
1. phrase：表現そのもの（英語）。ページの表記のまま書き写す。
2. meaning：その表現の意味（日本語）。ページに意味が書かれていればそれを使う。書かれていない場合のみ、簡潔な日本語訳を補う。
3. meaning_ai：meaningをページの記載から取った場合は false、ページに意味がなくあなたが補った場合は true。
ページに例文やニュアンスの説明が書かれている場合は、example（英語の例文）とnuance（補足説明）にも入れてください。書かれていなければ空文字 "" にし、自分で創作しないでください。
出力は必ず次のJSON配列のみにしてください。前置き・説明文・コードフェンス(\`\`\`)は一切付けないでください。

[
  {
    "phrase": "英語の表現",
    "meaning": "日本語での意味",
    "meaning_ai": false,
    "example": "",
    "nuance": ""
  }
]

画像から英語の表現が見つからない場合は、空のJSON配列 [] を出力してください。`;

    const body = {
      contents: [
        {
          parts: [
            ...list.map((im) => ({
              inline_data: {
                mime_type: im.mimeType || "image/jpeg",
                data: im.imageBase64,
              },
            })),
            { text: prompt },
          ],
        },
      ],
    };

    // 503（Google側の一時的な混雑）のときだけ、少し待って再試行し、
    // それでもだめなら軽量モデルに切り替える。429（無料枠超過）は再試行しない。
    const callGemini = (model) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

    let geminiRes = await callGemini("gemini-3.6-flash");
    if (geminiRes.status === 503) {
      await new Promise((r) => setTimeout(r, 1500));
      geminiRes = await callGemini("gemini-3.6-flash");
    }
    if (geminiRes.status === 503) {
      geminiRes = await callGemini("gemini-3.5-flash-lite");
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      res.status(502).json({ error: "Gemini API error", detail: errText });
      return;
    }

    const data = await geminiRes.json();
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p) => p.text || "")
        .join("") || "";

    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start === -1 || end === -1) {
      res.status(200).json({ phrases: [] });
      return;
    }

    const phrases = JSON.parse(text.slice(start, end + 1));
    res.status(200).json({ phrases });
  } catch (err) {
    res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
