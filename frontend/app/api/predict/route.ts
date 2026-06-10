import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { is_carousel, is_reels, post_hour, caption_length, hashtag_count, has_cta } = body;

    // Log input to simulate real FastAPI server logging
    console.log("[FAIV Predict API Mock] Received prediction request:", {
      is_carousel,
      is_reels,
      post_hour,
      caption_length,
      hashtag_count,
      has_cta
    });

    // Calculate a dynamic score to simulate Random Forest decision thresholds
    let score = 30; // Baseline score

    // Feature 1: Post Hour Peak Window (19:00 - 21:00)
    if (post_hour >= 19 && post_hour <= 21) {
      score += 20;
    } else if (post_hour >= 17 && post_hour < 19) {
      score += 10;
    }

    // Feature 2: Caption Length (180 - 320 characters)
    if (caption_length >= 180 && caption_length <= 320) {
      score += 15;
    } else if (caption_length > 0 && caption_length < 180) {
      score += 5;
    }

    // Feature 3: Hashtag Count (3 - 8 hashtags)
    if (hashtag_count >= 3 && hashtag_count <= 8) {
      score += 10;
    } else if (hashtag_count > 0 && hashtag_count < 3) {
      score += 3;
    }

    // Feature 4: Call-to-Action presence
    if (has_cta === 1) {
      score += 15;
    }

    // Feature 5: Format weighting
    if (is_reels === 1) {
      score += 15;
    } else if (is_carousel === 1) {
      score += 10;
    }

    // Determine prediction class based on simulated threshold splits
    let predicted_class: "High" | "Average" | "Low";
    let confidence: number;
    let probabilities: { High: number; Average: number; Low: number };

    if (score >= 70) {
      predicted_class = "High";
      confidence = Math.min(score, 98); // cap at 98%
      const remaining = 100 - confidence;
      probabilities = {
        High: confidence,
        Average: Math.round(remaining * 0.8),
        Low: Math.round(remaining * 0.2)
      };
    } else if (score >= 45) {
      predicted_class = "Average";
      confidence = Math.min(score + 10, 92);
      const remaining = 100 - confidence;
      probabilities = {
        High: Math.round(remaining * 0.35),
        Average: confidence,
        Low: Math.round(remaining * 0.65)
      };
    } else {
      predicted_class = "Low";
      confidence = Math.min(100 - score, 95);
      const remaining = 100 - confidence;
      probabilities = {
        High: Math.round(remaining * 0.1),
        Average: Math.round(remaining * 0.9),
        Low: confidence
      };
    }

    // Ensure sum of probabilities is exactly 100
    const sum = probabilities.High + probabilities.Average + probabilities.Low;
    if (sum !== 100) {
      probabilities.Average += (100 - sum);
    }

    return NextResponse.json({
      status: "success",
      predicted_class,
      confidence,
      probabilities
    });
  } catch (error: any) {
    console.error("[FAIV Predict API Mock] Error processing request:", error);
    return NextResponse.json(
      { status: "error", message: error.message || "Failed to process prediction" },
      { status: 500 }
    );
  }
}
