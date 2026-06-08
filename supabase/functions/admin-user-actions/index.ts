import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// admin-user-actions v6 — 2026-06-08
//
// v6 (bulk migration): added `bulk_user_migration` action — accepts a
// payload of {updates:[{coordinator_id,new_email,patches?}], terminations:[id]}
// and processes each row atomically per-row with structured success/failure
// reporting. Used by the User Management page Export / Import workflow to
// migrate users in bulk from XLSX without an admin having to write SQL.
// Per-row processing: a single broken row never blocks the rest. Email
// + auth.users updates use admin.auth.admin.updateUserById which preserves
// email_confirmed_at and existing passwords (proven live 2026-06-08).
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

  // ─────────────────────────────────────────────────────────────────────
  // bulk_user_migration — for User Management Export/Import workflow
  // ─────────────────────────────────────────────────────────────────────
  // Body: {
  //   updates: [{ coordinator_id, new_email?, patches?: { job_title?, team?,
  //                regions?, role?, secondary_roles?, weekly_visit_target? } }],
  //   terminations: [coordinator_id, ...]
  // }
  //
  // Per-row processing: each entry is processed independently. A failure
  // on one row does NOT roll back others. Returns a full report so the UI
  // can render success/failure per row.
  // ─────────────────────────────────────────────────────────────────────
  if (action === "bulk_user_migration") {
    const updates = Array.isArray(body.updates) ? body.updates : [];
    const terminations = Array.isArray(body.terminations) ? body.terminations : [];
    const callerIsSuper = callerCoord.role === "super_admin";

    const results: {
      started_at: string;
      caller: string;
      email_updates: Array<{ coordinator_id: string; full_name?: string | null; new_email?: string; status: "success" | "error" | "warning"; message: string }>;
      patch_updates: Array<{ coordinator_id: string; full_name?: string | null; fields: string[]; status: "success" | "error"; message: string }>;
      terminations: Array<{ coordinator_id: string; full_name?: string | null; status: "success" | "error" | "warning"; message: string }>;
      completed_at?: string;
    } = {
      started_at: new Date().toISOString(),
      caller: callerCoord.full_name || callerCoord.email || callerId,
      email_updates: [],
      patch_updates: [],
      terminations: [],
    };

    // ── 1) Email + field patches ──
    for (const u of updates) {
      const cid = u?.coordinator_id;
      const newEmail = (u?.new_email || "").trim().toLowerCase() || null;
      const patches = (u?.patches && typeof u.patches === "object") ? u.patches : {};

      if (!cid) {
        results.email_updates.push({ coordinator_id: "(missing)", status: "error", message: "row missing coordinator_id" });
        continue;
      }

      const { data: coord, error: ce } = await admin
        .from("coordinators")
        .select("id, user_id, email, full_name, role, job_title, team, regions, secondary_roles, weekly_visit_target")
        .eq("id", cid).maybeSingle();

      if (ce || !coord) {
        results.email_updates.push({ coordinator_id: cid, status: "error", message: `coordinator not found: ${errStr(ce)}` });
        continue;
      }

      // Block modifying another super_admin unless caller is super_admin
      if (coord.role === "super_admin" && !callerIsSuper) {
        results.email_updates.push({ coordinator_id: cid, full_name: coord.full_name, status: "error", message: "only super_admin can modify super_admin accounts" });
        continue;
      }

      // ── 1a) Email update ──
      if (newEmail && newEmail !== (coord.email || "").toLowerCase()) {
        // Collision check on coordinators
        const { data: dupCoord } = await admin.from("coordinators").select("id").ilike("email", newEmail).neq("id", cid).maybeSingle();
        if (dupCoord) {
          results.email_updates.push({ coordinator_id: cid, full_name: coord.full_name, new_email: newEmail, status: "error", message: `another coordinator already uses ${newEmail}` });
          continue;
        }
        // Collision check on auth.users
        if (coord.user_id) {
          const { data: dupAuthRes } = await admin.rpc("admin_lookup_user_by_email", { p_email: newEmail }).maybeSingle?.() ?? { data: null };
          // Note: if admin_lookup_user_by_email RPC doesn't exist this is null — that's fine, supabase auth update will surface duplicate
          if (dupAuthRes && dupAuthRes.id && dupAuthRes.id !== coord.user_id) {
            results.email_updates.push({ coordinator_id: cid, full_name: coord.full_name, new_email: newEmail, status: "error", message: `another auth.users row already uses ${newEmail}` });
            continue;
          }
        }

        // 1a-i) Update auth.users.email if linked
        if (coord.user_id) {
          const { error: aue } = await admin.auth.admin.updateUserById(coord.user_id, { email: newEmail });
          if (aue) {
            results.email_updates.push({ coordinator_id: cid, full_name: coord.full_name, new_email: newEmail, status: "error", message: `auth update failed: ${errStr(aue)}` });
            continue;
          }
        }

        // 1a-ii) Update coordinators.email
        const { error: cue } = await admin
          .from("coordinators")
          .update({ email: newEmail, updated_at: new Date().toISOString() })
          .eq("id", cid);
        if (cue) {
          results.email_updates.push({ coordinator_id: cid, full_name: coord.full_name, new_email: newEmail, status: "error", message: `coord update failed: ${errStr(cue)}` });
          continue;
        }

        results.email_updates.push({
          coordinator_id: cid,
          full_name: coord.full_name,
          new_email: newEmail,
          status: "success",
          message: coord.user_id ? "email + auth updated" : "email updated (no auth account)",
        });
      }

      // ── 1b) Optional field patches (job_title, team, regions, role, etc.) ──
      const allowedFields = ["job_title", "team", "regions", "role", "secondary_roles", "weekly_visit_target", "is_active"];
      const patchPayload: Record<string, unknown> = {};
      const changedFields: string[] = [];
      for (const f of allowedFields) {
        if (Object.prototype.hasOwnProperty.call(patches, f)) {
          const newVal = patches[f];
          // role change to super_admin requires super_admin caller
          if (f === "role" && newVal === "super_admin" && !callerIsSuper) continue;
          // detect actual change (loose compare for arrays)
          const curVal = (coord as any)[f];
          const isArr = Array.isArray(newVal) || Array.isArray(curVal);
          const changed = isArr
            ? JSON.stringify(newVal ?? []) !== JSON.stringify(curVal ?? [])
            : String(newVal ?? "") !== String(curVal ?? "");
          if (changed) {
            patchPayload[f] = newVal;
            changedFields.push(f);
          }
        }
      }
      if (changedFields.length > 0) {
        patchPayload["updated_at"] = new Date().toISOString();
        const { error: pe } = await admin.from("coordinators").update(patchPayload).eq("id", cid);
        if (pe) {
          results.patch_updates.push({ coordinator_id: cid, full_name: coord.full_name, fields: changedFields, status: "error", message: `patch failed: ${errStr(pe)}` });
        } else {
          results.patch_updates.push({ coordinator_id: cid, full_name: coord.full_name, fields: changedFields, status: "success", message: `updated: ${changedFields.join(", ")}` });
        }
      }
    }

    // ── 2) Terminations ──
    for (const tid of terminations) {
      if (!tid || typeof tid !== "string") {
        results.terminations.push({ coordinator_id: String(tid), status: "error", message: "invalid coordinator_id" });
        continue;
      }
      const { data: coord, error: ce } = await admin
        .from("coordinators")
        .select("id, user_id, role, full_name, is_active")
        .eq("id", tid).maybeSingle();
      if (ce || !coord) {
        results.terminations.push({ coordinator_id: tid, status: "error", message: `coordinator not found: ${errStr(ce)}` });
        continue;
      }
      if (coord.role === "super_admin" && !callerIsSuper) {
        results.terminations.push({ coordinator_id: tid, full_name: coord.full_name, status: "error", message: "only super_admin can terminate super_admin" });
        continue;
      }
      if (coord.is_active === false) {
        results.terminations.push({ coordinator_id: tid, full_name: coord.full_name, status: "warning", message: "already inactive — no change" });
        continue;
      }

      // Soft-delete coordinator
      const { error: due } = await admin
        .from("coordinators")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", tid);
      if (due) {
        results.terminations.push({ coordinator_id: tid, full_name: coord.full_name, status: "error", message: `deactivate failed: ${errStr(due)}` });
        continue;
      }

      // Ban auth account if exists (banUserById via updateUserById with ban_duration)
      if (coord.user_id) {
        const { error: bue } = await admin.auth.admin.updateUserById(coord.user_id, { ban_duration: "876000h" });
        if (bue) {
          results.terminations.push({ coordinator_id: tid, full_name: coord.full_name, status: "warning", message: `soft-deleted but auth ban failed: ${errStr(bue)}` });
          continue;
        }
      }

      results.terminations.push({
        coordinator_id: tid,
        full_name: coord.full_name,
        status: "success",
        message: coord.user_id ? "soft-deleted + auth banned" : "soft-deleted (no auth account)",
      });
    }

    results.completed_at = new Date().toISOString();

    // Log to activity log (best-effort, non-blocking)
    try {
      await admin.from("coordinator_activity_log").insert({
        coordinator_id: callerCoord.id,
        coordinator_name: callerCoord.full_name,
        coordinator_role: callerCoord.role,
        action_type: "bulk_user_migration",
        action_detail: `Email updates: ${results.email_updates.length}, Patch updates: ${results.patch_updates.length}, Terminations: ${results.terminations.length}`,
        table_name: "coordinators",
        metadata: {
          email_success: results.email_updates.filter(r => r.status === "success").length,
          email_error:   results.email_updates.filter(r => r.status === "error").length,
          patch_success: results.patch_updates.filter(r => r.status === "success").length,
          patch_error:   results.patch_updates.filter(r => r.status === "error").length,
          term_success:  results.terminations.filter(r => r.status === "success").length,
          term_error:    results.terminations.filter(r => r.status === "error").length,
        },
      });
    } catch (e) {
      console.warn("activity log insert failed", errStr(e));
    }

    return json({ success: true, results });
  }

  return json({ error: `Unknown action: ${action}` }, 400);
});
