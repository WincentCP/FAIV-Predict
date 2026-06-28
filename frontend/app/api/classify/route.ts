import { NextResponse } from "next/server";

const LLM_API_KEY = process.env.LLM_API_KEY;

// Whitelisted niches in our system
const NICHES = [
  "Fashion & Boutique",
  "Bakery & Café",
  "F&B Group",
  "Beauty & Cosmetics",
  "Tech & SaaS",
  "Gym & Fitness",
  "Travel & Hospitality",
  "Interior Design"
];

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
      console.warn("[BFF Classify] Google LLM API Key is missing. Falling back to rule-based classification.");
      return runFallbackClassifier(name, bio);
    }

    const prompt = `Anda adalah asisten AI klasifikasi brand. Tugas Anda adalah mengklasifikasikan brand berdasarkan Nama: "${name}" dan Deskripsi/Bio: "${bio}".
    
    Pilih 3 kategori paling cocok dari daftar kategori whitelisted berikut:
    ${NICHES.join("\n")}
    
    Format output harus berupa JSON array valid berisi tepat 3 objek dengan keys: "niche", "match" (angka float antara 0.0 s.d. 1.0 mewakili tingkat kecocokan), dan "reason" (kalimat penjelasan singkat dalam Bahasa Indonesia). Jangan sertakan markdown formatting backticks atau teks lain selain JSON array.
    
    Contoh format output:
    [
      { "niche": "Bakery & Café", "match": 0.95, "reason": "Brand menjual produk roti dan kue secara langsung." },
      { "niche": "F&B Group", "match": 0.70, "reason": "Brand beroperasi di industri kuliner." },
      { "niche": "Fashion & Boutique", "match": 0.10, "reason": "Kecocokan rendah karena tidak menjual pakaian." }
    ]`;

    console.log("[BFF Classify] Calling Google Gemini API...");
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${LLM_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
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
          return NextResponse.json(parsed);
        }
      } catch (jsonErr) {
        console.error("[BFF Classify] Failed to parse Gemini response as JSON:", rawText);
      }
    } else {
      console.warn("[BFF Classify] Gemini API returned error status:", geminiRes.status);
    }

    // Fallback if Gemini fails
    return runFallbackClassifier(name, bio);

  } catch (error: any) {
    console.error("[BFF Classify] Fatal error:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to classify niche" },
      { status: 500 }
    );
  }
}

function runFallbackClassifier(name: string, bio: string) {
  const seed = (name + " " + bio).toLowerCase();
  
  const scoreMap = NICHES.map((niche) => {
    let match = 0.35 + Math.random() * 0.25;
    
    // Keyword rules
    const firstWord = niche.split(" ")[0].toLowerCase();
    if (seed.includes(firstWord)) match += 0.35;
    if (niche === "Bakery & Café" && (seed.includes("roti") || seed.includes("kue") || seed.includes("caf") || seed.includes("kopi") || seed.includes("coffee"))) match += 0.4;
    if (niche === "Fashion & Boutique" && (seed.includes("baju") || seed.includes("pakaian") || seed.includes("hijab") || seed.includes("outfit") || seed.includes("wear"))) match += 0.4;
    if (niche === "Beauty & Cosmetics" && (seed.includes("skin") || seed.includes("make") || seed.includes("kosmetik") || seed.includes("cantik") || seed.includes("clinic"))) match += 0.4;
    if (niche === "Tech & SaaS" && (seed.includes("app") || seed.includes("web") || seed.includes("sistem") || seed.includes("soft") || seed.includes("gadget"))) match += 0.4;
    
    return {
      niche,
      match: Math.min(0.98, match),
      reason: `Analisis konteks kemiripan kata kunci mendeteksi kaitan dengan ${niche}.`
    };
  });

  const sorted = scoreMap.sort((a, b) => b.match - a.match).slice(0, 3);
  return NextResponse.json(sorted);
}
