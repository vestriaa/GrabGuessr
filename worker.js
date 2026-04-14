export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // ===== CONFIG =====
    const HMAC_SECRET = "grabguessr_super_secret_anti_cheat_key_123!";

    async function createToken(payloadObj) {
      const payloadStr = JSON.stringify(payloadObj);
      const payload64 = btoa(payloadStr);
      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload64));
      const sig = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
      return payload64 + "." + sig;
    }

    async function verifyToken(tokenStr) {
      try {
        if (!tokenStr) return null;
        const [payload64, sig] = tokenStr.split(".");
        if (!payload64 || !sig) return null;
        const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(HMAC_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
        const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload64));
        const expectedSig = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");
        if (sig !== expectedSig) return null;
        return JSON.parse(atob(payload64));
      } catch (e) {
        return null;
      }
    }
    const SECRET = "Pi9kUmnPl8cF-LcrMXVbFq2yXGlx2veESD81j1-Rm_mzQJn46lE04X9Epqduj-fj"; // HMAC Secret for slin.dev
    const BYPASS_KEY = "yoiamvestriaverygoodsecretyes"; // Key required if not on allowed domain
    
    // Add your production domain here
    const ALLOWED_DOMAINS = [
      "localhost:3000",
      "grabguessr.vestri.workers.dev",
      "grab-guessr.pages.dev" // Example pages domain
    ];

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Grab-Key"
    };

    if (method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

    try {
      // 1. DOMAIN / KEY CHECK
      const origin = request.headers.get("Origin");
      const referer = request.headers.get("Referer");
      let isAllowed = false;

      // Check if request comes from our official domains
      if (origin) {
        if (ALLOWED_DOMAINS.some(d => origin.includes(d))) isAllowed = true;
      } else if (referer) {
        if (ALLOWED_DOMAINS.some(d => referer.includes(d))) isAllowed = true;
      }

      // If not on allowed domain, check for the Secret Key
      if (!isAllowed) {
        const providedKey = request.headers.get("X-Grab-Key");
        if (providedKey !== BYPASS_KEY) {
          return new Response("Missing request signature", { status: 403, headers: corsHeaders });
        }
      }

      // 2. PATH & ROUTING
      let stripped = url.pathname;
      if (stripped.startsWith("/api")) stripped = stripped.slice(4);
      if (!stripped.startsWith("/")) stripped = "/" + stripped;

      const allowedPrefixes = ["/get_random_level", "/details/", "/download/", "/list", "/leaderboard", "/log_round"];
      const isSafePath = allowedPrefixes.some(prefix => stripped.startsWith(prefix));
      if (!isSafePath) return new Response("Missing request signature", { status: 403, headers: corsHeaders });

      // 2.5 ANTI-CHEAT ROUND LOGGING
      if (stripped === "/log_round" && method === "POST") {
        const body = await request.json();
        const { round, totalScore, previousToken } = body;
        
        if (typeof round !== "number" || typeof totalScore !== "number") {
          return new Response("Invalid data", { status: 400, headers: corsHeaders });
        }
        
        let newPayload = { r: round, s: totalScore, t: Date.now() };

        if (round === 1) {
          if (totalScore > 5000 || totalScore < 0) return new Response("nooo stop cheating noob", { status: 403, headers: corsHeaders });
          const token = await createToken(newPayload);
          return new Response(JSON.stringify({ token }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } else {
          const prevData = await verifyToken(previousToken);
          if (!prevData) return new Response("Invalid Token", { status: 403, headers: corsHeaders });
          if (prevData.r !== round - 1) return new Response("nop", { status: 403, headers: corsHeaders });
          if (totalScore < prevData.s) return new Response("nop", { status: 403, headers: corsHeaders });
          if (totalScore - prevData.s > 5000) return new Response("nop", { status: 403, headers: corsHeaders });
          if (Date.now() - prevData.t < 100) return new Response("nop", { status: 403, headers: corsHeaders });

          const token = await createToken(newPayload);
          return new Response(JSON.stringify({ token }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // 3. LEADERBOARD LOGIC
      if (stripped === "/leaderboard") {
        if (!env.LEADERBOARD) return new Response("Leaderboard KV not bound", { status: 500, headers: corsHeaders });

        const difficulty = url.searchParams.get("difficulty") || "500";
        const challengeId = url.searchParams.get("challenge");
        const kvKey = challengeId ? `challenge_${challengeId}` : `leaderboard_${difficulty}`;

        if (method === "GET") {
          const raw = await env.LEADERBOARD.get(kvKey);
          return new Response(raw || "[]", { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (method === "POST") {
          const body = await request.json();
          const { name, score, challenge, token } = body;
          const postKvKey = challenge ? `challenge_${challenge}` : kvKey;
          
          if (!name || typeof name !== "string" || score === undefined || typeof score !== "number") {
            return new Response("Invalid data", { status: 400, headers: corsHeaders });
          }

          const cleanScore = parseInt(score);
          
          // ANTI-CHEAT: The absolute maximum score is 50,000 (10 rounds * 5000). 
          if (cleanScore < 0 || cleanScore > 50000) {
            return new Response("nop", { status: 403, headers: corsHeaders });
          }

          // ANTI-CHEAT TOKEN VERIFICATION
          if (!token) return new Response("Missing Session Token", { status: 403, headers: corsHeaders });
          const tokenData = await verifyToken(token);
          if (!tokenData) return new Response("Session token invalid", { status: 403, headers: corsHeaders });
          if (tokenData.r < 10) return new Response("Not enough rounds played", { status: 403, headers: corsHeaders });
          if (tokenData.s !== cleanScore) return new Response("Score token mismatch", { status: 403, headers: corsHeaders });

          // XSS Protection: Clean the username
          const cleanName = name.replace(/[^a-zA-Z0-9_ \-]/g, "").trim().slice(0, 20) || "Anonymous";

          let current = JSON.parse(await env.LEADERBOARD.get(postKvKey) || "[]");
          current.push({ name: cleanName, score: cleanScore, date: Date.now() });
          
          // Sort and keep top 100
          current.sort((a, b) => b.score - a.score);
          current = current.slice(0, 100);

          await env.LEADERBOARD.put(postKvKey, JSON.stringify(current));
          return new Response(JSON.stringify(current), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // 4. HMAC SIGNING FOR UPSTREAM
      const upstreamUrl = "https://api.slin.dev/grab/v1" + stripped + url.search;
      const u = new URL(upstreamUrl);
      const path = u.pathname + u.search;
      const timestamp = Date.now().toString();
      const payload = `${method}\n${path}\n${timestamp}`;

      const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
      const signature = [...new Uint8Array(sigBuffer)].map(b => b.toString(16).padStart(2, "0")).join("");

      const headers = new Headers();
      headers.set("X-Grab-Timestamp", timestamp);
      headers.set("X-Grab-Signature", signature);
      const contentType = request.headers.get("content-type");
      if (contentType) headers.set("content-type", contentType);

      const upstreamRequest = new Request(upstreamUrl, {
        method,
        headers,
        body: ["GET", "HEAD"].includes(method) ? null : request.body
      });

      const res = await fetch(upstreamRequest);
      
      // 4. RESPONSE FILTERING & OBFUSCATION
      const updatedHeaders = new Headers(res.headers);
      for (const [k, v] of Object.entries(corsHeaders)) {
        updatedHeaders.set(k, v);
      }

      if (res.headers.get("content-type")?.includes("application/json") && 
          (stripped.startsWith("/get_random_level") || stripped.startsWith("/details/") || stripped.startsWith("/list"))) {
        
        let data = await res.json();

        const filterLevel = (level) => {
          if (!level) return null;
          const f = {
            identifier: level.identifier,
            data_key: level.data_key,
            title: level.title
          };
          if (level.creators) f.creators = level.creators;
          if (level.images?.thumb?.key) f.thumb = level.images.thumb.key;
          return f;
        };

        if (Array.isArray(data)) {
          data = data.map(filterLevel);
        } else {
          data = filterLevel(data);
        }

        return new Response(JSON.stringify(data), { 
          status: res.status, 
          headers: updatedHeaders 
        });
      }

      return new Response(res.body, { status: res.status, headers: updatedHeaders });

    } catch (e) {
      return new Response("Internal error: " + e.message, { status: 500, headers: corsHeaders });
    }
  }
};
