import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";

export interface TransactionContext {
  txnId: string;
  senderId: string;
  receiverPhone: string;
  receiverName: string;
  amount: number;
  xgboostScore: number;
  strikeCount: number;
  userProfile: {
    age: number;
    incometier: string;
    guardianMode: string;
  };
  recentHistory: string;
}

export interface BedrockDecision {
  decision: "APPROVE" | "BLOCK" | "HOLD";
  confidence: number;
  evidence_used: string[];
  reason: string;
  reasonBM: string;
}

export async function invokeGuardianLLM(
  context: TransactionContext
): Promise<BedrockDecision> {
  // AWS SDK in browser requires explicit credentials from VITE_ env vars.
  // The SDK cannot read AWS_* vars directly — those only work in Node/Lambda.
  const accessKeyId = import.meta.env.VITE_AWS_ACCESS_KEY_ID;
  const secretAccessKey = import.meta.env.VITE_AWS_SECRET_ACCESS_KEY;
  const sessionToken = import.meta.env.VITE_AWS_SESSION_TOKEN;
  const region = import.meta.env.VITE_AWS_REGION ?? "ap-southeast-1";

  if (!accessKeyId || !secretAccessKey) {
    console.error(
      "AWS credentials missing. Ensure VITE_AWS_ACCESS_KEY_ID and VITE_AWS_SECRET_ACCESS_KEY are set."
    );
    return holdFallback("Missing AWS credentials");
  }

  const client = new BedrockRuntimeClient({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    },
  });

  const prompt = `You are GOGuardian, a financial fraud protection AI for TNG eWallet Malaysia.

A transaction needs your decision. Analyze carefully.

Transaction Details:
- Transaction ID: ${context.txnId}
- Amount: RM${context.amount}
- Receiver Phone: ${context.receiverPhone}
- Receiver Name: ${context.receiverName}
- XGBoost Risk Score: ${context.xgboostScore} (0=safe, 1=risky)
- Receiver Strike Count (community reports): ${context.strikeCount}
- Sender Age: ${context.userProfile.age}
- Sender Income Tier: ${context.userProfile.incometier}
- Recent Transaction History: ${context.recentHistory}

Rules:
- If strike count >= 3, lean toward BLOCK
- If amount is unusually large for this user, lean toward HOLD
- If receiver name is a known shop/business, lean toward APPROVE
- Always explain in simple Bahasa Malaysia for elderly users

Respond ONLY in this exact JSON format with no markdown or code fences:
{
  "decision": "APPROVE" | "BLOCK" | "HOLD",
  "confidence": 0.0-1.0,
  "evidence_used": ["fact1 from context", "fact2 from context"],
  "reason": "English explanation citing only facts above",
  "reasonBM": "Simple Bahasa Malaysia for elderly user (max 2 sentences)"
}`;

  const command = new InvokeModelCommand({
    modelId: "apac.amazon.nova-micro-v1:0",
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: [{ text: prompt }],
        },
      ],
      inferenceConfig: {
        maxTokens: 300,
        temperature: 0.3,
      },
    }),
  });

  try {
    const response = await client.send(command);
    const raw = JSON.parse(new TextDecoder().decode(response.body));
    const text: string = raw.output.message.content[0].text;

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in Bedrock response");

    const parsed: BedrockDecision = JSON.parse(jsonMatch[0]);

    // Validate required fields before returning
    if (!["APPROVE", "BLOCK", "HOLD"].includes(parsed.decision)) {
      throw new Error(`Invalid decision value: ${parsed.decision}`);
    }

    return parsed;
  } catch (error) {
    console.error("Bedrock LLM error:", error);
    return holdFallback(`LLM response parsing failed: ${error}`);
  }
}

function holdFallback(reason: string): BedrockDecision {
  return {
    decision: "HOLD",
    confidence: 0.5,
    evidence_used: [],
    reason,
    reasonBM:
      "Sistem tidak dapat mengesahkan transaksi ini. Sila tunggu kelulusan penjaga anda.",
  };
}