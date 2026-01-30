
export interface Env {
  ISP_DB: D1Database;
  ISP_AI: Ai;
  API_TOKEN: string;
  AI_API_URL: string;
  AI_API_TOKEN: string;
}

// Ensure Ai type is recognized if not globally available
export interface Ai {
  run(model: string, inputs: any): Promise<any>;
}

interface RequestBody {
  text: string;
  locale: string;
}

interface TranslationRecord {
  translated_text: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // 0. CORS 处理
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. 前置校验
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
    }

    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    // 2. 输入处理
    let body: RequestBody;
    try {
      body = await request.json() as RequestBody;
    } catch (e) {
      return new Response('Invalid JSON', { status: 400, headers: corsHeaders });
    }

    const { text, locale } = body;

    if (!text || !locale) {
      return new Response('Missing text or locale', { status: 400, headers: corsHeaders });
    }

    // 长度熔断
    if (text.length > 64) {
      return new Response('Text too long', { status: 400, headers: corsHeaders });
    }

    // 3. 缓存层 (Read)
    // 计算 MD5 hash
    const cacheKeyInput = text + locale;
    const encoder = new TextEncoder();
    const data = encoder.encode(cacheKeyInput);
    
    // Cloudflare Workers supports MD5 in crypto.subtle
    const hashBuffer = await crypto.subtle.digest('MD5', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const target_cache_key = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    // 查询 D1
    const cached = await env.ISP_DB.prepare('SELECT translated_text FROM translations WHERE cache_key = ?')
      .bind(target_cache_key)
      .first<TranslationRecord>();

    if (cached) {
      return Response.json({
        original: text,
        translated: cached.translated_text,
        source: 'cache'
      }, { headers: corsHeaders });
    }

    // 4. AI 翻译层 (Write)
    let translatedText = "";
    try {
      // 使用外部 OpenAI 兼容 API 调用 grok-4.1-fast 模型
      const response = await fetch(`${env.AI_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.AI_API_TOKEN}`
        },
        body: JSON.stringify({
          model: "grok-4.1-fast",
          messages: [
            {
              role: 'system',
              content: `You are a professional telecommunications industry translator. 
              Translate the following ISP (Internet Service Provider) name to the target language (locale: ${locale}). 
              Rules:
              1. Return ONLY the translated name in the language specified by locale: ${locale}.
              2. EVERYTHING must be translated to target locale language. Do NOT keep any abbreviations, acronyms, or brand names as they are (e.g., 'NTT' -> '日本电报电话公司', 'AT&T' -> '美国电话电报公司', 'America' -> '美国', 'Inc.' -> '公司').
              3. If text is already in target locale language, just return original text and do not modify anything.
              3. If a brand has a well-known localized name, use it. If not, translate it phonetically or descriptively into the target language.
              4. Do not include any explanations, notes, or quotes.`
            },
            {
              role: 'user',
              content: text
            }
          ],
          stream: false // 虽然用户示例中有 stream: true，但在 Worker 后端 API 场景通常使用 false 以便直接获取结果
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API Error: ${response.status} ${errorText}`);
      }

      const aiData = await response.json() as any;
      if (aiData.choices && aiData.choices.length > 0) {
        translatedText = aiData.choices[0].message.content.trim();
      } else {
        console.warn("Unexpected AI response format", aiData);
        translatedText = "Translation Error"; 
      }
    } catch (e) {
      console.error("AI Translation Error", e);
      return new Response('AI Service Error', { status: 500, headers: corsHeaders });
    }

    // 输出截断
    const truncated_result = translatedText.substring(0, 64);

    // 入库 (异步)
    ctx.waitUntil(
      env.ISP_DB.prepare('INSERT INTO translations (cache_key, translated_text) VALUES (?, ?)')
        .bind(target_cache_key, truncated_result)
        .run()
        .catch(err => console.error("D1 Cache Insert Error", err))
    );

    return Response.json({
      original: text,
      translated: truncated_result,
      source: 'ai'
    }, { headers: corsHeaders });
  }
};
