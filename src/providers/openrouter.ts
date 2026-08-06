import { OPENROUTER } from "../brand.ts";
import type { SealedPayload } from "../sovereignty/seal.ts";
import { SeatClient, type CallOptions, type Citation, type ProviderResponse } from "./base.ts";
import type { Seat } from "./budget.ts";

interface ORResponse {
  model?: string;
  choices?: { message?: { content?: string; annotations?: unknown[] } }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    cost_details?: { upstream_inference_cost?: number };
  };
  citations?: (string | { url?: string; title?: string })[];
  search_results?: { url?: string; title?: string }[];
  error?: { message?: string };
}

export interface ORModel {
  id: string;
  name?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
}

/**
 * One client, one key, one pinned host — three seats.
 *
 * §2 keeps the seats separate on purpose: research retrieves the law, security
 * attacks the code, and the architect adjudicates, and they are configured to
 * different model families so nothing marks its own homework. Routing them
 * through OpenRouter changes who bills the user, not who does the reasoning.
 *
 * The sovereignty trade-off is stated plainly rather than glossed: OpenRouter is
 * an additional party in the data path. What reaches it is still only what the
 * redactor produced — pseudonymised structure, never identifiers, never rows.
 */
export class OpenRouterClient extends SeatClient {
  readonly host = "openrouter.ai";

  constructor(
    ctx: ConstructorParameters<typeof SeatClient>[0],
    modelId: string,
    readonly seat: Seat,
  ) {
    super(ctx, modelId);
  }

  protected buildRequest(payload: SealedPayload, opts: CallOptions, apiKey: string) {
    const body: Record<string, unknown> = {
      model: this.modelId,
      messages: payload.messages,
      temperature: opts.temperature ?? 0,
      max_tokens: opts.maxTokens ?? 4000,
      // Ask OpenRouter for its own token and cost accounting, so the ROI report
      // states what was actually charged instead of what we guessed.
      usage: { include: true },
    };
    return {
      url: OPENROUTER.chat,
      init: {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
          "HTTP-Referer": OPENROUTER.referer,
          "X-Title": OPENROUTER.title,
        },
        body: JSON.stringify(body),
      } satisfies RequestInit,
    };
  }

  protected parseResponse(json: unknown) {
    const r = json as ORResponse;
    if (r.error?.message && !r.choices?.length) {
      throw new Error(`OpenRouter error: ${r.error.message}`);
    }

    const citations: Citation[] = [];
    for (const c of r.citations ?? []) {
      if (typeof c === "string") citations.push({ url: c });
      else if (c?.url) citations.push({ url: c.url, title: c.title });
    }
    for (const s of r.search_results ?? []) {
      if (s.url && !citations.some((c) => c.url === s.url)) {
        citations.push({ url: s.url, title: s.title });
      }
    }
    // Some models return sources as message annotations rather than a top-level
    // citations array; both shapes carry the URLs the corpus phase needs.
    for (const a of r.choices?.[0]?.message?.annotations ?? []) {
      const cit = (a as { url_citation?: { url?: string; title?: string } })?.url_citation;
      if (cit?.url && !citations.some((c) => c.url === cit.url)) {
        citations.push({ url: cit.url, title: cit.title });
      }
    }

    const out: Omit<ProviderResponse, "cached" | "cost_usd"> & { reported_cost?: number } = {
      text: r.choices?.[0]?.message?.content ?? "",
      usage: {
        input_tokens: r.usage?.prompt_tokens ?? 0,
        output_tokens: r.usage?.completion_tokens ?? 0,
      },
      model: r.model ?? this.modelId,
      citations,
      cost_reported: typeof r.usage?.cost === "number",
    };
    if (typeof r.usage?.cost === "number") out.reported_cost = r.usage.cost;
    return out;
  }

  async listModels(): Promise<string[]> {
    const models = await this.listModelsDetailed();
    return models.map((m) => m.id).sort();
  }

  /** Powers `doctor`: id validation and a live price refresh in one call. */
  async listModelsDetailed(): Promise<ORModel[]> {
    const json = (await this.getJson(OPENROUTER.models, {
      authorization: `Bearer ${this.apiKey()}`,
      "HTTP-Referer": OPENROUTER.referer,
      "X-Title": OPENROUTER.title,
    })) as { data?: ORModel[] };
    return (json.data ?? []).filter((m) => !!m.id);
  }

  /** Remaining credit and rate-limit posture, for `doctor`. */
  async keyInfo(): Promise<{ label?: string; usage?: number; limit?: number | null } | null> {
    try {
      const json = (await this.getJson(OPENROUTER.keyInfo, {
        authorization: `Bearer ${this.apiKey()}`,
      })) as { data?: { label?: string; usage?: number; limit?: number | null } };
      return json.data ?? null;
    } catch {
      return null;
    }
  }

  privacyPosture() {
    return {
      control: "Account-level data policy at openrouter.ai/settings/privacy",
      applied: false,
      note:
        "OpenRouter routes each request to an upstream provider, so two parties see the payload: " +
        "OpenRouter and whichever provider serves the model. Retention and training use are governed " +
        "by your OpenRouter privacy settings and by that provider's terms — there is no per-request " +
        "header this tool can set to override them. Turn off prompt logging in your OpenRouter " +
        "account settings if you need it off. What leaves this machine is still only what the " +
        "redactor produced: pseudonymised structure, no identifiers, no rows.",
    };
  }
}
