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
    const { imageBase64, mimeType } = req.body || {};
    if (!imageBase64) {
      res.status(400).json({ error: "imageBase64 is required" });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
      return;
    }

    const prompt = `あなたは英語学習教材の画像から、実際の会話でそのまま使える重要な英語フレーズを抽出するアシスタントです。
単語を大量に抜き出すのではなく、会話で自然に使えるフレーズ単位で、重要度の高いものを最大8個程度抽出してください。
出力は必ず次のJSON配列のみにしてください。前置き・説明文・コードフェンス(\`\`\`)は一切付けないでください。

[
  {
    "phrase": "英語フレーズ",
    "meaning": "日本語での意味",
    "example": "そのフレーズを使った英語の例文",
    "nuance": "ニュアンスや使い方についての日本語の補足説明"
  }
]

画像から英語フレーズが見つからない場合は、空のJSON配列 [] を出力してください。`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;
    const body = {
      contents: [
        {
          parts: [
            {
              inline_data: {
                mime_type: mimeType || "image/jpeg",
                data: imageBase64,
              },
            },
            { text: prompt },
          ],
        },
      ],
    };

    const geminiRes = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

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
