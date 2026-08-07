import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getPatient } from "../../../lib/supabase";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  const { patientId, message } = await req.json();
  const patient = await getPatient(patientId);

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      { role: "system", content: "You are a triage assistant. Patient record: " + JSON.stringify(patient) },
      { role: "user", content: message },
    ],
  });

  const reply = completion.choices[0].message.content;
  return NextResponse.json({ reply, html: `<div>${reply}</div>` });
}
