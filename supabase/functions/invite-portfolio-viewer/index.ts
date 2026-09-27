// Publicar con verificación JWT activada. La clave de servicio solo vive en Supabase.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
});
function envJsonKey(name: string) {
  try { return JSON.parse(Deno.env.get(name) ?? "null")?.default ?? null; } catch { return null; }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "METHOD_NOT_ALLOWED" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = envJsonKey("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY");
    const service = envJsonKey("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const appUrl = Deno.env.get("MI_CARTERA_APP_URL");
    if (!url || !anon || !service || !appUrl) return reply({ error: "SERVER_CONFIG_MISSING" }, 500);
    const destination = new URL(appUrl);
    if (destination.protocol !== "https:") return reply({ error: "APP_URL_MUST_BE_HTTPS" }, 500);
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return reply({ error: "AUTH_REQUIRED" }, 401);
    const identity = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${token}` },
    });
    if (!identity.ok) return reply({ error: "AUTH_REQUIRED" }, 401);
    const caller = await identity.json();
    const { email, portfolio_id } = await request.json();
    if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        typeof portfolio_id !== "string" || !/^[0-9a-f-]{36}$/i.test(portfolio_id)) {
      return reply({ error: "INVALID_INPUT" }, 400);
    }
    const target = email.trim().toLowerCase();
    if (target === String(caller.email).toLowerCase()) return reply({ error: "CANNOT_INVITE_SELF" }, 400);
    // Autorizar ANTES de crear un usuario o enviar un correo.
    const owner = await fetch(`${url}/rest/v1/portfolios?id=eq.${encodeURIComponent(portfolio_id)}&user_id=eq.${encodeURIComponent(caller.id)}&select=id`, {
      headers: { apikey: service, Authorization: `Bearer ${service}` },
    });
    if (!owner.ok || !(await owner.json())?.length) return reply({ error: "PORTFOLIO_OWNER_REQUIRED" }, 403);

    const assign = () => fetch(`${url}/rest/v1/rpc/set_portfolio_viewer_v1`, {
      method: "POST",
      headers: { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_portfolio_id: portfolio_id, p_email: target, p_enabled: true }),
    });
    let result = await assign();
    if (!result.ok) {
      const error = await result.text();
      if (!error.includes("VIEWER_NOT_FOUND")) return reply({ error: "ASSIGNMENT_FAILED" }, 400);
      const invitation = await fetch(`${url}/auth/v1/invite?redirect_to=${encodeURIComponent(destination.href)}`, {
        method: "POST",
        headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: target }),
      });
      if (!invitation.ok) return reply({ error: "INVITATION_FAILED" }, 400);
      result = await assign();
      if (!result.ok) return reply({ error: "ASSIGNMENT_FAILED_AFTER_INVITATION" }, 500);
      return reply({ ok: true, invited: true });
    }
    return reply({ ok: true, invited: false });
  } catch (error) {
    console.error(error);
    return reply({ error: "UNEXPECTED_ERROR" }, 500);
  }
});
