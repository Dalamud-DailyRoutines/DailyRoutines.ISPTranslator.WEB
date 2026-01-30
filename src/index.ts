
export interface Env {
  ISP_DB: D1Database;
  ISP_AI: Ai;
  API_TOKEN: string;
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
      // @cf/meta/m2m100-1.2b
      const aiResponse = await env.ISP_AI.run('@cf/meta/m2m100-1.2b', {
        text: text,
        target_lang: locale
      });

      // Handle AI response format
      if (aiResponse && typeof aiResponse === 'object' && 'translated_text' in aiResponse) {
        translatedText = (aiResponse as any).translated_text;
      } else {
        console.warn("Unexpected AI response format", aiResponse);
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
