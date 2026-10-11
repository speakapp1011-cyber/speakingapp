// Vercel serverless function: Supabase へのデータ読み書き（キーはサーバー側のみ）
// 必要な環境変数: SUPABASE_URL, SUPABASE_SERVICE_KEY, APP_PASSCODE
import { createHash, timingSafeEqual } from "node:crypto";

const sha = (s) => createHash("sha256").update(String(s)).digest();
const str = (v, n = 2000) => String(v ?? "").slice(0, n);
const keyOf = (s) => String(s || "").trim().toLowerCase();

async function sb(path, { method = "GET", body, prefer } = {}) {
  const base = new URL(process.env.SUPABASE_URL.trim()).origin + "/rest/v1"; // /rest/v1 などが付いていても無視する
  const key = process.env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) headers.Authorization = `Bearer ${key}`; // 旧形式(JWT)キーのみ
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

function phraseRow(p) {
  const now = new Date().toISOString();
  const phrase = str(p.phrase, 500).trim();
  if (!phrase) return null;
  return {
    id: str(p.id, 64),
    phrase,
    phrase_key: keyOf(phrase),
    meaning: str(p.meaning),
    meaning_ai: !!p.meaning_ai,
    example: str(p.example),
    nuance: str(p.nuance),
    first_studied_at: p.first_studied_at || now,
    created_at: p.created_at || now,
    updated_at: p.updated_at || now,
  };
}
function studyRow(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s.study_date || "")) return null;
  return {
    study_id: str(s.study_id, 64),
    study_date: s.study_date,
    source_image: str(s.source_image, 200),
    new_phrase_ids: Array.isArray(s.new_phrase_ids) ? s.new_phrase_ids.map((x) => str(x, 64)) : [],
    speak_prompt: str(s.speak_prompt, 20000),
    created_at: s.created_at || new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY || !process.env.APP_PASSCODE) {
      return res.status(500).json({ error: "環境変数（SUPABASE_URL / SUPABASE_SERVICE_KEY / APP_PASSCODE）が未設定です" });
    }
    const given = req.headers["x-passcode"] || "";
    if (!timingSafeEqual(sha(given), sha(process.env.APP_PASSCODE))) {
      return res.status(401).json({ error: "パスコードが違います" });
    }

    const { action, ...b } = req.body || {};

    if (action === "load") {
      const [phrases, daily_studies] = await Promise.all([
        sb("/phrases?select=*&order=created_at.desc&limit=10000"),
        sb("/daily_studies?select=*&order=study_date.desc&limit=1000"),
      ]);
      return res.status(200).json({ phrases, daily_studies });
    }

    if (action === "addPhrases") {
      const rows = (b.phrases || []).map(phraseRow).filter(Boolean);
      if (!rows.length) return res.status(200).json({ inserted: [] });
      const out = await sb("/phrases?on_conflict=phrase_key", {
        method: "POST", body: rows, prefer: "resolution=ignore-duplicates,return=representation",
      });
      return res.status(200).json({ inserted: (out || []).map((r) => r.id) });
    }

    if (action === "deletePhrase") {
      await sb(`/phrases?id=eq.${encodeURIComponent(str(b.id, 64))}`, { method: "DELETE" });
      return res.status(200).json({ ok: true });
    }

    if (action === "markReviewed") {
      const ids = (b.ids || []).map((x) => str(x, 64)).filter((x) => /^[A-Za-z0-9_-]+$/.test(x));
      if (!ids.length) return res.status(200).json({ ok: true });
      await sb(`/phrases?id=in.(${ids.join(",")})`, {
        method: "PATCH", body: { last_reviewed_at: new Date().toISOString() },
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "saveStudy") {
      const row = studyRow(b.study);
      if (!row) return res.status(400).json({ error: "invalid study" });
      await sb("/daily_studies?on_conflict=study_date", {
        method: "POST", body: [row], prefer: "resolution=merge-duplicates",
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "importAll") {
      const prow = (b.phrases || []).map(phraseRow).filter(Boolean);
      const srow = (b.studies || []).map(studyRow).filter(Boolean);
      let added = 0;
      if (prow.length) {
        const out = await sb("/phrases?on_conflict=phrase_key", {
          method: "POST", body: prow, prefer: "resolution=ignore-duplicates,return=representation",
        });
        added = (out || []).length;
      }
      if (srow.length) {
        await sb("/daily_studies?on_conflict=study_date", {
          method: "POST", body: srow, prefer: "resolution=ignore-duplicates",
        });
      }
      return res.status(200).json({ added });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (err) {
    return res.status(500).json({ error: "Server error", detail: String(err) });
  }
}
