import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
// Sender mailbox unchanged — Resend sender domain remains axiomhealthmanagement.com.
// Display name updated to EdemaCare per the 2026-06-01 DBA rebrand.
const FROM_EMAIL = 'EdemaCare Ops <notifications@axiomhealthmanagement.com>';
const APP_URL = 'https://axiomhealthops-axiom-ops.vercel.app';

Deno.serve(async (req: Request) => {
  try {
    const { note_id, patient_name, author_name, note_text, tagged_users } = await req.json();

    if (!tagged_users || tagged_users.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), { headers: { 'Content-Type': 'application/json' } });
    }

    // If no Resend key configured, log and return gracefully
    if (!RESEND_API_KEY) {
      console.log('RESEND_API_KEY not set — skipping email notifications for', tagged_users.length, 'users');
      return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'no_email_key' }), { headers: { 'Content-Type': 'application/json' } });
    }

    let sent = 0;
    for (const user of tagged_users) {
      if (!user.email) continue;

      const html = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
          <div style="background: #1E293B; padding: 20px 24px; border-radius: 12px 12px 0 0;">
            <div style="color: #fff; font-size: 18px; font-weight: 700;">EdemaCare Ops</div>
            <div style="color: #94A3B8; font-size: 13px; margin-top: 2px;">Patient Chart Notification</div>
          </div>
          <div style="background: #fff; padding: 24px; border: 1px solid #E2E8F0; border-top: none;">
            <div style="font-size: 14px; color: #334155; margin-bottom: 16px;">
              <strong>${author_name}</strong> mentioned you in a note for <strong>${patient_name}</strong>
            </div>
            <div style="background: #F8FAFC; border-left: 3px solid #1565C0; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
              <div style="font-size: 13px; color: #475569; line-height: 1.5;">${note_text}</div>
            </div>
            <a href="${APP_URL}" style="display: inline-block; background: #1565C0; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">Open EdemaCare Ops</a>
          </div>
          <div style="padding: 16px 24px; font-size: 11px; color: #94A3B8; border: 1px solid #E2E8F0; border-top: none; border-radius: 0 0 12px 12px; background: #F8FAFC;">
            You received this because you were tagged in a patient chart note. Do not reply to this email.<br/>
            <span style="opacity:0.8">EdemaCare is a service of AxiomHealth Management LLC.</span>
          </div>
        </div>
      `;

      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: [user.email],
            subject: `${author_name} mentioned you — ${patient_name}`,
            html,
          }),
        });
        if (res.ok) sent++;
        else console.warn('Email send failed for', user.email, await res.text());
      } catch (e) {
        console.warn('Email error for', user.email, e.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('notify-mention error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
