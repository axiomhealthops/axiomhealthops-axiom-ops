import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// admin-user-actions v5 — 2026-05-29
//
// v5 (DBA rebrand): user-visible "AxiomHealth Ops" → "EdemaCare Ops" in
// email header, body, footer, and subject. Sender mailbox unchanged —
// Resend sender domain remains axiomhealthmanagement.com. APP_URL also
// unchanged — keeping the existing Vercel canonical URL during the
// transition window (Phase 3 will move to a custom EdemaCare domain).
//
// v4 history: PRIMARY path is /auth/v1/recover (Supabase built-in SMTP).
// FALLBACK: admin.auth.admin.generateLink + Resend.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const FROM_EMAIL = "EdemaCare Ops <notifications@axiomhealthmanagement.com>";
const APP_URL = "https://axiomhealthops-axiom-ops.vercel.app";
const REDIRECT_TO = `${APP_URL}/reset-password`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

function errStr(e: any): string {
  if (!e) return "unknown";
  if (typeof e === "string") return e;
  const m = e.message || e.error_description || e.msg || e.error || "";
  const s = e.status || e.code || e.statusCode;
  return s ? `${s}: ${m || JSON.stringify(e)}` : (m || JSON.stringify(e));
}

// PRIMARY: trigger Supabase's built-in recovery email pipeline.
// Same call the Login page makes via supabase.auth.resetPasswordForEmail().
// Returns 200 + empty body on success. Supabase sends the email itself.
async function sendViaSupabaseAuth(email: string, redirectTo?: string) {
  const url = new URL(`${SUPABASE_URL}/auth/v1/recover`);
  if (redirectTo) url.searchParams.set("redirect_to", redirectTo);
  try {
    const r = await fetch(url.toString(), {
      method: "POST",
      headers: {
        "apikey": ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, body: txt };
  } catch (e) {
    return { ok: false, status: 0, body: String((e as any)?.message || e) };
  }
}

async function sendResetEmailViaResend(to: string, link: string, fullName: string | null) {
  if (!RESEND_API_KEY) return { sent: false, reason: "no_resend_key" };
  const greeting = fullName ? `Hi ${fullName.split(" ")[0]},` : "Hello,";
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;">
      <div style="background:#1E293B;padding:20px 24px;border-radius:12px 12px 0 0;">
        <div style="color:#fff;font-size:18px;font-weight:700;">EdemaCare Ops</div>
        <div style="color:#94A3B8;font-size:13px;margin-top:2px;">Password Reset</div>
      </div>
      <div style="background:#fff;padding:24px;border:1px solid #E2E8F0;border-top:none;">
        <div style="font-size:14px;color:#334155;margin-bottom:16px;">${greeting}</div>
        <div style="font-size:14px;color:#334155;margin-bottom:20px;line-height:1.5;">An administrator has initiated a password reset for your EdemaCare Ops account. Click below to set a new password. This link expires in 1 hour.</div>
        <a href="${link}" style="display:inline-block;background:#1565C0;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">Set new password</a>
        <div style="font-size:11px;color:#94A3B8;margin-top:20px;line-height:1.5;">If you didn't expect this, you can ignore the email — your password will remain unchanged.</div>
      </div>
      <div style="padding:16px 24px;font-size:11px;color:#94A3B8;border:1px solid #E2E8F0;border-top:none;border-radius:0 0 12px 12px;background:#F8FAFC;">Sent by EdemaCare Ops. Do not reply to this email.<br/><span style="opacity:0.8">EdemaCare is a service of AxiomHealth Management LLC.</span></div>
    </div>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject: "EdemaCare Ops — Password reset", html }),
    });
    if (!r.ok) {
      const txt = await r.text();
      console.warn("Resend failed", r.status, txt);
      return { sent: false, reason: `resend_${r.status}`, detail: txt };
    }
    return { sent: true };
  } catch (e) {
    console.warn("Resend exception", (e as any)?.message);
    return { sent: false, reason: "resend_exception", detail: String((e as any)?.message || e) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Missing bearer token" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: meRes, error: meErr } = await userClient.auth.getUser();
  if (meErr || !meRes?.user) return json({ error: `Invalid session: ${errStr(meErr)}` }, 401);
  const callerId = meRes.user.id;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: callerCoord, error: ccErr } = await admin
    .from("coordinators").select("id, role, full_name, email").eq("user_id", callerId).maybeSingle();
  if (ccErr) return json({ error: `Caller lookup failed: ${errStr(ccErr)}` }, 500);
  if (!callerCoord || !["admin", "super_admin"].includes(callerCoord.role)) {
    return json({ error: "Unauthorized — admin role required" }, 403);
  }

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const { action, target_user_id, new_password } = body;
  if (!action) return json({ error: "Missing 'action'" }, 400);

  let target: { user_id: string | null; email: string | null; full_name: string | null; role: string | null } | null = null;
  if (target_user_id) {
    const { data: t } = await admin.from("coordinators").select("user_id, email, full_name, role").eq("user_id", target_user_id).maybeSingle();
    target = t;
  }
  if (target?.role === "super_admin" && callerCoord.role !== "super_admin") {
    return json({ error: "Only super_admin can modify another super_admin" }, 403);
  }

  if (action === "set_password") {
    if (!target_user_id) return json({ error: "Missing target_user_id" }, 400);
    if (!new_password || typeof new_password !== "string" || new_password.length < 8) return json({ error: "Password must be at least 8 characters" }, 400);
    const { data, error } = await admin.auth.admin.updateUserById(target_user_id, { password: new_password });
    if (error) { console.error("updateUserById err", JSON.stringify(error)); return json({ error: `updateUserById failed — ${errStr(error)}` }, 500); }
    return json({ success: true, message: `Password updated for ${target?.full_name || target?.email || target_user_id}`, user_id: data?.user?.id });
  }

  if (action === "send_reset") {
    if (!target?.email) return json({ error: "Target user has no email on file" }, 400);
    const targetEmail = target.email.toLowerCase();

    // PRIMARY: Supabase built-in email pipeline. Most reliable path.
    const builtIn = await sendViaSupabaseAuth(targetEmail, REDIRECT_TO);
    if (builtIn.ok) {
      return json({
        success: true,
        email_sent: true,
        method: "supabase",
        target_email: targetEmail,
        target_name: target.full_name,
        message: `Reset email sent to ${targetEmail} via Supabase Auth. Ask them to check inbox + spam within 5 minutes.`,
      });
    }

    // FALLBACK 1: built-in failed. Try generateLink + Resend.
    console.warn("sendViaSupabaseAuth failed, falling back to Resend", builtIn.status, builtIn.body);
    let linkData: any = null;
    let firstErr: any = null;
    {
      const r = await admin.auth.admin.generateLink({ type: "recovery", email: targetEmail, options: { redirectTo: REDIRECT_TO } });
      if (r.error) { firstErr = r.error; console.warn("generateLink with redirectTo failed:", JSON.stringify(r.error)); }
      else linkData = r.data;
    }
    if (!linkData) {
      const r2 = await admin.auth.admin.generateLink({ type: "recovery", email: targetEmail });
      if (r2.error) {
        return json({
          error: `All email paths failed.`,
          builtin: { status: builtIn.status, body: builtIn.body },
          generatelink_with_redirect: errStr(firstErr),
          generatelink_no_redirect: errStr(r2.error),
          hint: "Verify (1) Supabase Auth → Settings → SMTP is configured OR (2) RESEND_API_KEY is set and notifications@axiomhealthmanagement.com is a verified Resend sender domain (DKIM/SPF). Also allow-list https://axiomhealthops-axiom-ops.vercel.app/** under Supabase → Auth → URL Configuration → Redirect URLs.",
        }, 500);
      }
      linkData = r2.data;
    }
    const link = linkData?.properties?.action_link;
    if (!link) return json({ error: "generateLink returned no link" }, 500);

    const emailResult = await sendResetEmailViaResend(targetEmail, link, target.full_name);
    return json({
      success: true,
      email_sent: emailResult.sent,
      method: emailResult.sent ? "resend" : "manual",
      email_reason: emailResult.sent ? null : (emailResult as any).reason,
      recovery_link: link,
      target_email: targetEmail,
      target_name: target.full_name,
      message: emailResult.sent
        ? `Supabase auth pipeline rejected the recover call (${builtIn.status}); sent via Resend instead.`
        : `Both Supabase Auth (${builtIn.status}) and Resend (${(emailResult as any).reason}) failed to deliver. Copy the recovery link below and share it directly with the user.`,
    });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
