// =====================================================================
// notify-garment-handoff
//
// Fans out notifications for two-stage garment-order approvals:
//   submitted        → notify the named PT/OT (clinical_approver_email)
//   clinical_approved → notify every coordinator with role IN ('admin','super_admin')
//   clinical_denied   → notify the submitting field clinician
//   final_approved    → notify the submitting field clinician + the named PT/OT
//   final_denied      → notify the submitting field clinician + the named PT/OT
//   cancelled         → notify the submitting field clinician + the named PT/OT
//
// For each recipient it:
//   (a) inserts a row into garment_order_notifications so the in-app bell can
//       pick it up via the existing realtime channel, and
//   (b) sends a Resend email (skipped silently if RESEND_API_KEY is unset, to
//       match the notify-mention pattern).
//
// Trust model mirrors notify-mention: the function runs with the service role
// key so it can read coordinators + insert notifications regardless of RLS.
// =====================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const FROM_EMAIL = 'EdemaCare Ops <notifications@axiomhealthmanagement.com>';
const APP_URL = 'https://axiomhealthops-axiom-ops.vercel.app';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

type Event =
  | 'submitted'
  | 'clinical_approved'
  | 'clinical_denied'
  | 'final_approved'
  | 'final_denied'
  | 'cancelled';

type Recipient = { id: string | null; name: string | null; email: string | null };

function subjectFor(event: Event, patient: string): string {
  switch (event) {
    case 'submitted':         return `New garment order needs your review — ${patient}`;
    case 'clinical_approved': return `Garment order needs final approval — ${patient}`;
    case 'clinical_denied':   return `Garment order denied at clinical review — ${patient}`;
    case 'final_approved':    return `Garment order approved — ${patient}`;
    case 'final_denied':      return `Garment order denied at final review — ${patient}`;
    case 'cancelled':         return `Garment order cancelled — ${patient}`;
  }
}

function emailHtml(message: string, patient: string, orderType: string | null, limb: string | null) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
      <div style="background: #1E293B; padding: 20px 24px; border-radius: 12px 12px 0 0;">
        <div style="color: #fff; font-size: 18px; font-weight: 700;">EdemaCare Ops</div>
        <div style="color: #94A3B8; font-size: 13px; margin-top: 2px;">Garment Order Notification</div>
      </div>
      <div style="background: #fff; padding: 24px; border: 1px solid #E2E8F0; border-top: none;">
        <div style="font-size: 14px; color: #334155; margin-bottom: 16px;">
          <strong>${patient}</strong> · ${limb || ''} ${orderType || ''}
        </div>
        <div style="background: #F8FAFC; border-left: 3px solid #1565C0; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
          <div style="font-size: 13px; color: #475569; line-height: 1.5;">${message}</div>
        </div>
        <a href="${APP_URL}/dashboard/garment-tracker" style="display: inline-block; background: #1565C0; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">Open Garment Tracker</a>
      </div>
      <div style="padding: 16px 24px; font-size: 11px; color: #94A3B8; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px; background: #F8FAFC;">
        You received this because you're part of the garment-order approval chain. Do not reply to this email.<br/>
        <span style="opacity:0.8">EdemaCare is a service of AxiomHealth Management LLC.</span>
      </div>
    </div>
  `;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!RESEND_API_KEY) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.warn('email send failed for', to, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn('email error for', to, (e as Error).message);
    return false;
  }
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json();
    const orderId: string | undefined = body.order_id;
    const event: Event | undefined = body.event;
    const customMessage: string | null = body.message || null;

    if (!orderId || !event) {
      return new Response(JSON.stringify({ error: 'order_id and event required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: order, error: orderErr } = await admin
      .from('garment_orders')
      .select('id, patient_name, limb_type, order_type, clinician_name, clinician_email, clinician_id, clinical_approver_name, clinical_approver_email, clinical_approver_id, approver_name, approver_email')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: orderErr?.message || 'order not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    }

    // Resolve recipients per event.
    const recipients: Recipient[] = [];

    const pushUnique = (r: Recipient) => {
      if (!r.email && !r.id) return;
      if (recipients.some(x => (r.email && x.email === r.email) || (r.id && x.id === r.id))) return;
      recipients.push(r);
    };

    const clinical: Recipient = {
      id: order.clinical_approver_id || null,
      name: order.clinical_approver_name || order.approver_name || null,
      email: order.clinical_approver_email || order.approver_email || null,
    };
    const clinician: Recipient = {
      id: order.clinician_id || null,
      name: order.clinician_name || null,
      email: order.clinician_email || null,
    };

    if (event === 'submitted') {
      pushUnique(clinical);
    } else if (event === 'clinical_approved') {
      // Every admin / super-admin can act, first one wins.
      const { data: admins } = await admin
        .from('coordinators')
        .select('id, full_name, email, role, secondary_roles')
        .or('role.in.(admin,super_admin),secondary_roles.cs.{admin},secondary_roles.cs.{super_admin}');
      for (const a of admins || []) {
        pushUnique({ id: a.id, name: a.full_name, email: a.email });
      }
    } else if (event === 'clinical_denied') {
      pushUnique(clinician);
    } else if (event === 'final_approved' || event === 'final_denied' || event === 'cancelled') {
      pushUnique(clinician);
      pushUnique(clinical);
    }

    const message = customMessage || `Garment order event: ${event}`;
    const subject = subjectFor(event, order.patient_name);
    const html = emailHtml(message, order.patient_name, order.order_type, order.limb_type);

    // In-app rows: insert all recipients in one shot.
    const inboxRows = recipients.map(r => ({
      order_id: orderId,
      recipient_id: r.id,
      recipient_email: r.email,
      event,
      message,
    }));
    if (inboxRows.length) {
      const { error: insErr } = await admin.from('garment_order_notifications').insert(inboxRows);
      if (insErr) console.warn('garment_order_notifications insert failed:', insErr.message);
    }

    let emailsSent = 0;
    for (const r of recipients) {
      if (!r.email) continue;
      if (await sendEmail(r.email, subject, html)) emailsSent++;
    }

    return new Response(JSON.stringify({ ok: true, recipients: recipients.length, emails_sent: emailsSent }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('notify-garment-handoff error:', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
