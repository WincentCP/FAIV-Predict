import { NextResponse } from "next/server";
import { NICHES } from "@/lib/niches";

export const dynamic = "force-dynamic";

const LLM_API_KEY = process.env.LLM_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, bio } = body;

    if (!name || !bio) {
      return NextResponse.json(
        { status: "error", message: "Parameters 'name' and 'bio' are required." },
        { status: 400 }
      );
    }

    if (!LLM_API_KEY) {
      // No fabricated fallback scores: report the feature as unavailable and
      // let the UI fall back to a plain manual niche selection.
      return NextResponse.json(
        { status: "error", message: "AI brand classification is not configured on this server." },
        { status: 501 }
      );
    }

    const prompt = `Anda adalah asisten AI klasifikasi brand. Tugas Anda adalah mengklasifikasikan brand berdasarkan Nama: "${name}" dan Deskripsi/Bio: "${bio}".

    Pilih 3 kategori paling cocok dari daftar kategori whitelisted berikut:
    ${NICHES.join("\n")}

    Format output harus berupa JSON array valid berisi tepat 3 objek dengan keys: "niche", "match" (angka float antara 0.0 s.d. 1.0 mewakili tingkat kecocokan), dan "reason" (kalimat penjelasan singkat dalam Bahasa Indonesia). Nilai "niche" harus persis sama dengan salah satu kategori whitelisted. Jangan sertakan markdown formatting backticks atau teks lain selain JSON array.

    Contoh format output:
    [
      { "niche": "Bakery", "match": 0.95, "reason": "Brand menjual produk roti dan kue secara langsung." },
      { "niche": "Food & Beverage", "match": 0.70, "reason": "Brand beroperasi di industri kuliner." },
      { "niche": "Fashion", "match": 0.10, "reason": "Kecocokan rendah karena tidak menjual pakaian." }
    ]`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${LLM_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
        }),
      }
    );

    if (geminiRes.ok) {
      const geminiData = await geminiRes.json();
      const rawText = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

      // Clean potential JSON markdown wraps
      const cleanJsonStr = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      try {
        const parsed = JSON.parse(cleanJsonStr);
        if (Array.isArray(parsed)) {
          // Keep only entries whose niche is actually in the whitelist.
          const valid = parsed.filter(
            (p: any) =>
              p &&
              (NICHES as readonly string[]).includes(p.niche) &&
              typeof p.match === "number"
          );
          if (valid.length > 0) {
            return NextResponse.json(valid.slice(0, 3));
          }
        }
      } catch {
        console.error("[BFF Classify] Failed to parse Gemini response as JSON:", rawText);
      }
    } else {
      console.warn("[BFF Classify] Gemini API returned error status:", geminiRes.status);
    }

    return NextResponse.json(
      { status: "error", message: "AI classification failed. Select a niche manually." },
      { status: 502 }
    );
  } catch (error: any) {
    console.error("[BFF Classify] Fatal error:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to classify niche" },
      { status: 500 }
    );
  }
}
