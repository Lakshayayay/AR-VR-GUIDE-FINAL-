import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'missing_key');
const MODEL = 'gemini-2.5-flash-lite';
const model = genAI.getGenerativeModel({ model: MODEL }, { apiVersion: 'v1' });
const textModel = genAI.getGenerativeModel({ model: MODEL }, { apiVersion: 'v1' });

// Shared rate-limit cooldown — pauses all analysis if quota is hit
let rateLimitedUntil = 0;
const isRateLimited = () => Date.now() < rateLimitedUntil;
const setRateLimit = (retryAfterMs = 60000) => {
  rateLimitedUntil = Date.now() + retryAfterMs;
  console.warn(`[VisionAnalyzer] Rate limited — pausing analysis for ${retryAfterMs/1000}s`);
};

// --- PRIMARY ANALYSIS: Visual Anomaly Detection ---
export async function analyzeFrameForAnomalies(base64ImageData, sessionContext) {
  const prompt = `You are an industrial safety AI assistant analyzing a live camera feed from a technician performing a repair.

Location: ${sessionContext.location || 'Industrial facility'}
Current repair step context: ${sessionContext.currentStep || 'Unknown step'}
Equipment type: ${sessionContext.equipmentType || 'Unknown equipment'}

Analyze this image for:
1. VISUAL ANOMALIES: cracks, corrosion, discoloration, misalignments, improper fits, unusual wear
2. SAFETY CONCERNS: exposed wires, improper tool usage, PPE violations, hazardous positions
3. QUALITY ISSUES: incomplete connections, overtightened/undertightened fasteners, improper routing

Respond ONLY in this exact JSON format, no other text:
{
  "anomalies": [
    {
      "type": "crack|corrosion|misalignment|leak|damage|safety|quality",
      "severity": "low|medium|high|critical",
      "description": "concise description of what you see",
      "location_in_frame": "top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right",
      "confidence": 0.0
    }
  ],
  "overall_status": "clear|warning|alert|critical",
  "frame_quality": "good|poor|too_blurry",
  "summary": "one sentence summary for the expert"
}

If no anomalies are detected, return anomalies as an empty array and overall_status as "clear".
If the image is too blurry or unclear to analyze, set frame_quality to "poor" and return empty anomalies.`;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    console.error('[VisionAnalyzer] GEMINI_API_KEY is missing. Analysis skipped.');
    return { anomalies: [], overall_status: 'clear', frame_quality: 'poor', summary: 'API Key Missing' };
  }

  if (isRateLimited()) {
    console.log('[VisionAnalyzer] Still rate-limited, skipping frame.');
    return { anomalies: [], overall_status: 'clear', frame_quality: 'poor', summary: 'Rate limited — cooling down' };
  }

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64ImageData,
          mimeType: 'image/jpeg'
        }
      }
    ]);

    const text = result.response.text().trim();
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    if (err.message && err.message.includes('429')) setRateLimit(90000);
    console.error('[VisionAnalyzer] Analysis failed:', err.message);
    return { anomalies: [], overall_status: 'clear', frame_quality: 'poor', summary: 'Analysis unavailable' };
  }
}

// --- SOP VALIDATION: Cross-check visible state against expected step ---
export async function validateSOPStep(base64ImageData, sopStep, sessionContext) {
  const prompt = `You are an industrial SOP compliance AI. A technician is performing a procedure.

Step ${sopStep.number}: "${sopStep.name}"
Critical step: ${sopStep.critical ? 'YES' : 'No'}
Repair type: ${sessionContext.repairType || 'Unknown'}

Look at this image and determine if the visual state is consistent with someone performing or having completed this step.

Respond ONLY in this exact JSON format:
{
  "step_visible": true,
  "step_appears_completed": true,
  "compliance_confidence": 0.0,
  "concerns": ["list of specific concerns if any"],
  "recommendation": "short recommendation for the expert"
}

Confidence: 0.0 to 1.0.`;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    console.error('[VisionAnalyzer] GEMINI_API_KEY is missing. SOP Validation skipped.');
    return { step_visible: false, step_appears_completed: false, compliance_confidence: 0, concerns: ['API Key missing'], recommendation: '' };
  }

  try {
    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64ImageData,
          mimeType: 'image/jpeg'
        }
      }
    ]);

    const text = result.response.text().trim();
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[VisionAnalyzer] SOP validation failed:', err.message);
    return { step_visible: false, step_appears_completed: false, compliance_confidence: 0.5, concerns: [], recommendation: '' };
  }
}

// --- SESSION SIGN-OFF VALIDATION ---
export async function validateSessionSignOff(sessionSummary, sopStepsCompleted, sessionDuration) {
  const prompt = `You are an industrial safety compliance AI. Final review before sign-off.

Session Summary:
- Repair Type: ${sessionSummary.repairType}
- Duration: ${sessionDuration} min (Expected: ${sessionSummary.expectedDurationMin}-${sessionSummary.expectedDurationMax})
- Steps: ${sopStepsCompleted.completed}/${sopStepsCompleted.total}
- Critical Steps: ${sopStepsCompleted.criticalCompleted}/${sopStepsCompleted.criticalTotal}
- Alerts: ${sessionSummary.alertsCount} (Ack: ${sessionSummary.alertsAcknowledged})

Respond ONLY in this exact JSON format:
{
  "sign_off_recommended": true,
  "confidence": 0.0,
  "risk_level": "low|medium|high|critical",
  "blockers": [],
  "warnings": [],
  "summary": "one sentence summary"
}`;

  if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'YOUR_GEMINI_API_KEY_HERE') {
    return { sign_off_recommended: false, confidence: 0, risk_level: 'high', blockers: ['API Key missing'], warnings: [], summary: 'API Key Missing' };
  }

  try {
    const result = await textModel.generateContent(prompt);
    const text = result.response.text().trim();
    const cleaned = text.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    console.error('[VisionAnalyzer] Sign-off validation failed:', err.message);
    return { sign_off_recommended: false, confidence: 0, risk_level: 'high', blockers: ['Unable to validate'], warnings: [], summary: 'Validation service unavailable' };
  }
}
