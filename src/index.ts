
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
    const url = new URL(request.url);
    const path = url.pathname.endsWith('/') && url.pathname.length > 1 
      ? url.pathname.slice(0, -1) 
      : url.pathname;
    
    // 识别开发环境：
    // 1. 协议是 http
    // 2. 域名包含 localhost 或 127.0.0.1
    // 3. 端口号不为空 (生产环境通常不带端口号)
    const isDev = url.protocol === 'http:' || 
                  url.hostname.includes('localhost') || 
                  url.hostname.includes('127.0.0.1') ||
                  url.port !== '';

    // 0. CORS 处理
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': isDev ? 'GET, POST, DELETE, OPTIONS' : 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. 前置校验
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || authHeader !== env.API_TOKEN) {
      return new Response('Unauthorized', { status: 401, headers: corsHeaders });
    }

    // --- 路由处理 ---
    
    // 识别管理路径
    const isCachePath = path.includes('/cache');

    // 仅在本地开发环境下允许的缓存管理接口
    if (isDev && isCachePath) {
      // 获取所有缓存内容
      if (path.endsWith('/cache') && request.method === 'GET') {
        try {
          const { results } = await env.ISP_DB.prepare('SELECT * FROM translations ORDER BY created_at DESC LIMIT 100').all();
          return Response.json(results, { headers: corsHeaders });
        } catch (e: any) {
          return new Response(e.message, { status: 500, headers: corsHeaders });
        }
      }

      // 清空所有缓存
      if (path.endsWith('/cache/clear') && request.method === 'POST') {
        try {
          await env.ISP_DB.prepare('DELETE FROM translations').run();
          return Response.json({ success: true }, { headers: corsHeaders });
        } catch (e: any) {
          return new Response(e.message, { status: 500, headers: corsHeaders });
        }
      }

      // 删除指定缓存
      if (path.endsWith('/cache/delete') && request.method === 'POST') {
        try {
          const { key } = await request.json() as { key: string };
          if (!key) return new Response('Missing key', { status: 400, headers: corsHeaders });
          await env.ISP_DB.prepare('DELETE FROM translations WHERE cache_key = ?').bind(key).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        } catch (e: any) {
          return new Response(e.message, { status: 500, headers: corsHeaders });
        }
      }

      // 更新指定缓存
      if (path.endsWith('/cache/update') && request.method === 'POST') {
        try {
          const { key, text } = await request.json() as { key: string, text: string };
          if (!key || !text) return new Response('Missing key or text', { status: 400, headers: corsHeaders });
          await env.ISP_DB.prepare('UPDATE translations SET translated_text = ? WHERE cache_key = ?').bind(text, key).run();
          return Response.json({ success: true }, { headers: corsHeaders });
        } catch (e: any) {
          return new Response(e.message, { status: 500, headers: corsHeaders });
        }
      }
      
      return new Response(`Cache Management Route Not Found: ${path}`, { status: 404, headers: corsHeaders });
    }

    // 翻译逻辑 (生产环境仅允许此路径和 POST 方法)
    if ((path === '/' || path === '/translate') && request.method === 'POST') {
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

      // --- 3.1 边缘缓存层 (Cloudflare Cache API - L1) ---
      const cacheUrl = new URL(request.url);
      cacheUrl.pathname = `/cache-bin/${target_cache_key}`;
      const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
      const cache = caches.default;
      
      const edgeCachedResponse = await cache.match(cacheKey);
      if (edgeCachedResponse) {
        const data = await edgeCachedResponse.json() as any;
        return Response.json({
          ...data,
          source: 'edge'
        }, { 
          headers: {
            ...corsHeaders,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Cache-Status': 'HIT-EDGE'
          } 
        });
      }

      // --- 3.2 数据库缓存层 (D1 - L2) ---
      const cached = await env.ISP_DB.prepare('SELECT translated_text FROM translations WHERE cache_key = ?')
        .bind(target_cache_key)
        .first<TranslationRecord>();

      if (cached) {
        const result = {
          original: text,
          translated: cached.translated_text,
          source: 'cache'
        };
        
        // 异步写入边缘缓存
        const responseToCache = Response.json(result, {
          headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
        });
        ctx.waitUntil(cache.put(cacheKey, responseToCache));

        return Response.json(result, { 
          headers: {
            ...corsHeaders,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Cache-Status': 'HIT-D1'
          } 
        });
      }

      // 4. AI 翻译层 (Write)
      let translatedText = "";
      try {
        const response = await fetch(`${env.AI_API_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${env.AI_API_TOKEN}`
          },
          body: JSON.stringify({
            model: "deepseek-ai/DeepSeek-V3.2-Exp",
            messages: [
              {
                role: 'system',
                content: `You are a strict, professional translation engine for the telecommunications industry, specialized in concise branding.
                 
                 TASK: Translate the ISP (Internet Service Provider) name into a CONCISE, localized version for: ${locale}.
                 
                 STRICT OUTPUT RULES:
                 1. SAME LANGUAGE CHECK: If the input text is already in the target language/script (${locale}), return the original text EXACTLY as-is without any changes.
                 2. Output ONLY the translated text in ${locale}. 
                 3. BREVITY IS CRITICAL: Prioritize the core brand name. Omit redundant legal suffixes (e.g., "Company Limited", "Systems", "Group", "Corp") if the brand remains recognizable.
                 3. SCRIPT INTEGRITY: Use the correct writing system for ${locale}. 
                 4. NO explanations, NO quotes, NO conversational filler.
                 
                 TRANSLATION GUIDELINES:
                 - Aim for the shortest recognizable name used in the target region.
                 - For long company names, keep only the primary identity (e.g., "China Telecom" instead of "China Telecommunications Corporation").
                 - If a standard short-form localized brand exists, use it.
                 - Ensure the output is a single, clean string.`
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
      const final_result = {
        original: text,
        translated: truncated_result,
        source: 'ai'
      };

      ctx.waitUntil(
        Promise.all([
          // D1 写入
          env.ISP_DB.prepare('INSERT INTO translations (cache_key, translated_text) VALUES (?, ?)')
            .bind(target_cache_key, truncated_result)
            .run()
            .catch(err => console.error("D1 Cache Insert Error", err)),
          
          // Cache API 写入
          cache.put(cacheKey, Response.json(final_result, {
            headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }
          }))
        ])
      );

      return Response.json(final_result, { 
        headers: {
          ...corsHeaders,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Cache-Status': 'MISS'
        } 
      });
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
