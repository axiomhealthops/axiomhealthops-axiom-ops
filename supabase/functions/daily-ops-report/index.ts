import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const DIRECTOR_EMAIL = "admin@expertvacationplanners.com";
// Sender mailbox unchanged — Resend sender domain remains axiomhealthmanagement.com.
// Display name updated to EdemaCare per the 2026-06-01 DBA rebrand.
const FROM_EMAIL = "EdemaCare Ops <reports@axiomhealthmanagement.com>";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function escHtml(s: string): string {
  return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMorningOverview(data: any): string {
  const authCoords = data.auth_coordinators || [];
  const intakeCoords = data.intake_coordinators || [];
  const careCoords = data.care_coordinators || [];
  const pipeline = data.intake_pipeline || {};
  const overloaded = data.overload_coordinators || [];

  let authRows = authCoords.map((c: any) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-weight:600">${escHtml(c.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${c.tasks_open}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:${c.tasks_urgent > 0 ? '#DC2626' : '#6B7280'}">${c.tasks_urgent}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:${c.tasks_overdue > 0 ? '#DC2626' : '#6B7280'}">${c.tasks_overdue}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${c.tasks_due_today}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${c.renewal_tasks_open}</td>
    </tr>`).join("");

  let intakeRows = intakeCoords.map((c: any) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-weight:600">${escHtml(c.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${pipeline.total_pending || 0}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:#059669">${pipeline.new_today || 0}</td>
    </tr>`).join("");

  let careRows = careCoords.map((c: any) => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-weight:600">${escHtml(c.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${c.tasks_open}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:${c.tasks_overdue > 0 ? '#DC2626' : '#6B7280'}">${c.tasks_overdue}</td>
    </tr>`).join("");

  let overloadBanner = "";
  if (overloaded.length > 0) {
    const names = overloaded.map((o: any) => `<strong>${escHtml(o.name)}</strong> (${o.incomplete} tasks)`).join(", ");
    overloadBanner = `<div style=\"background:#FEF2F2;border:2px solid #DC2626;border-radius:8px;padding:14px 18px;margin-bottom:20px;color:#991B1B;font-size:14px\">\n      ⚠️ <strong>OVERLOAD ALERT:</strong> ${names} — over 30 incomplete tasks\n    </div>`;
  }

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#1E3A5F 0%,#2563EB 100%);padding:24px 28px;border-radius:12px 12px 0 0">
      <h1 style="color:#fff;margin:0;font-size:22px">☀️ Morning Overview — ${data.report_date}</h1>
      <p style="color:#93C5FD;margin:6px 0 0;font-size:13px">Tasks awaiting your coordination teams today</p>
    </div>
    <div style="padding:24px 28px;background:#F9FAFB;border-radius:0 0 12px 12px">
      ${overloadBanner}

      <h2 style="font-size:15px;color:#1E3A5F;margin:0 0 12px;border-bottom:2px solid #2563EB;padding-bottom:6px">🔐 Auth Coordinators</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#EFF6FF">
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Name</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Open Tasks</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Urgent</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Overdue</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Due Today</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Renewals</th>
        </tr></thead>
        <tbody>${authRows || '<tr><td colspan="6" style="padding:12px;color:#9CA3AF;text-align:center">No auth coordinators found</td></tr>'}</tbody>
      </table>

      <h2 style="font-size:15px;color:#065F46;margin:0 0 12px;border-bottom:2px solid #059669;padding-bottom:6px">📥 Intake Coordinators</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#ECFDF5">
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Name</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Pending Referrals</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">New Today</th>
        </tr></thead>
        <tbody>${intakeRows || '<tr><td colspan="3" style="padding:12px;color:#9CA3AF;text-align:center">No intake coordinators found</td></tr>'}</tbody>
      </table>

      <h2 style="font-size:15px;color:#92400E;margin:0 0 12px;border-bottom:2px solid #D97706;padding-bottom:6px">💛 Care Coordinators</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#FEF3C7">
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Name</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Open Tasks</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Overdue</th>
        </tr></thead>
        <tbody>${careRows || '<tr><td colspan="3" style="padding:12px;color:#9CA3AF;text-align:center">No care coordinators found</td></tr>'}</tbody>
      </table>

      <div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:16px">EdemaCare Operations Platform — Auto-generated report<br/><span style="opacity:0.7">EdemaCare is a service of AxiomHealth Management LLC</span></div>
    </div>
  </div>`;
}

function renderMiddaySnapshot(data: any): string {
  const authCoords = data.auth_coordinators || [];
  const intakeCoords = data.intake_coordinators || [];
  const careCoords = data.care_coordinators || [];
  const activityLog = data.activity_log_today || [];
  const overloaded = data.overload_coordinators || [];

  let overloadBanner = "";
  if (overloaded.length > 0) {
    const names = overloaded.map((o: any) => `<strong>${escHtml(o.name)}</strong> (${o.incomplete})`).join(", ");
    overloadBanner = `<div style=\"background:#FEF2F2;border:2px solid #DC2626;border-radius:8px;padding:14px 18px;margin-bottom:20px;color:#991B1B;font-size:14px\">⚠️ <strong>OVERLOAD:</strong> ${names}</div>`;
  }

  const allCoords = [
    ...authCoords.map((c: any) => ({ name: c.name, role: 'Auth', completed: c.completed_today + c.auth_records_updated, open: c.tasks_open, overdue: c.tasks_overdue, detail: `${c.completed_today} tasks done, ${c.auth_records_updated} auths updated` })),
    ...intakeCoords.map((c: any) => ({ name: c.name, role: 'Intake', completed: c.referrals_updated_today, open: c.still_pending, overdue: 0, detail: `${c.accepted_today} accepted, ${c.denied_today} denied, ${c.still_pending} pending` })),
    ...careCoords.map((c: any) => ({ name: c.name, role: 'Care', completed: c.coord_notes_today + c.chart_notes_today + c.discharges_today + c.onhold_updates_today, open: c.tasks_open, overdue: c.tasks_overdue, detail: `${c.coord_notes_today + c.chart_notes_today} notes, ${c.discharges_today} discharges, ${c.onhold_updates_today} on-hold updates` }))
  ];

  const totalCompleted = allCoords.reduce((s, c) => s + c.completed, 0);
  const totalOpen = allCoords.reduce((s, c) => s + c.open, 0);

  let coordRows = allCoords.map(c => {
    return `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-weight:600">${escHtml(c.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center"><span style="background:#EFF6FF;color:#1E40AF;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:600">${c.role}</span></td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:#059669;font-weight:700">${c.completed}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:${c.open > 0 ? '#D97706' : '#6B7280'}">${c.open}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#6B7280">${escHtml(c.detail)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${c.completed > 0 ? '✅' : '⚠️'}</td>
    </tr>`;
  }).join("");

  const recentActivity = activityLog.slice(0, 15).map((a: any) => {
    const time = new Date(a.time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' });
    return `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #F3F4F6;font-size:12px;color:#6B7280">${time}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #F3F4F6;font-size:12px;font-weight:600">${escHtml(a.coordinator)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #F3F4F6;font-size:12px">${escHtml(a.detail || a.action)}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #F3F4F6;font-size:12px;color:#6B7280">${escHtml(a.patient || '')}</td>
    </tr>`;
  }).join("");

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#065F46 0%,#059669 100%);padding:24px 28px;border-radius:12px 12px 0 0">
      <h1 style="color:#fff;margin:0;font-size:22px">🕛 Midday Snapshot — ${data.report_date}</h1>
      <p style="color:#A7F3D0;margin:6px 0 0;font-size:13px">${totalCompleted} actions completed · ${totalOpen} tasks still open</p>
    </div>
    <div style="padding:24px 28px;background:#F9FAFB;border-radius:0 0 12px 12px">
      ${overloadBanner}

      <div style="display:flex;gap:12px;margin-bottom:20px">
        <div style="flex:1;background:#ECFDF5;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:900;color:#059669">${totalCompleted}</div>
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase">Actions Done</div>
        </div>
        <div style="flex:1;background:#FEF3C7;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:900;color:#D97706">${totalOpen}</div>
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase">Still Open</div>
        </div>
      </div>

      <h2 style="font-size:15px;color:#1F2937;margin:0 0 12px;border-bottom:2px solid #6B7280;padding-bottom:6px">Team Progress</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#F3F4F6">
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Name</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Team</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Done</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Open</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Details</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Status</th>
        </tr></thead>
        <tbody>${coordRows}</tbody>
      </table>

      ${recentActivity ? `<h2 style=\"font-size:15px;color:#1F2937;margin:0 0 12px;border-bottom:2px solid #6B7280;padding-bottom:6px\">Recent Activity</h2>
      <table style=\"width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden\">
        <thead><tr style=\"background:#F9FAFB\">
          <th style=\"padding:8px 12px;text-align:left;font-size:11px;color:#9CA3AF\">Time</th>
          <th style=\"padding:8px 12px;text-align:left;font-size:11px;color:#9CA3AF\">Who</th>
          <th style=\"padding:8px 12px;text-align:left;font-size:11px;color:#9CA3AF\">Action</th>
          <th style=\"padding:8px 12px;text-align:left;font-size:11px;color:#9CA3AF\">Patient</th>
        </tr></thead>
        <tbody>${recentActivity}</tbody>
      </table>` : ''}

      <div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:16px">EdemaCare Operations Platform — Auto-generated report<br/><span style="opacity:0.7">EdemaCare is a service of AxiomHealth Management LLC</span></div>
    </div>
  </div>`;
}

function renderEODReview(data: any): string {
  const authCoords = data.auth_coordinators || [];
  const intakeCoords = data.intake_coordinators || [];
  const careCoords = data.care_coordinators || [];
  const overloaded = data.overload_coordinators || [];

  const allCoords = [
    ...authCoords.map((c: any) => ({ name: c.name, role: 'Auth Coordinator', completed: c.completed_today + c.auth_records_updated, open: c.tasks_open, overdue: c.tasks_overdue, urgent: c.tasks_urgent, renewals: c.renewal_tasks_open })),
    ...intakeCoords.map((c: any) => ({ name: c.name, role: 'Intake Coordinator', completed: c.referrals_updated_today, open: c.still_pending, overdue: 0, urgent: 0, renewals: 0 })),
    ...careCoords.map((c: any) => ({ name: c.name, role: 'Care Coordinator', completed: c.coord_notes_today + c.chart_notes_today + c.discharges_today + c.onhold_updates_today, open: c.tasks_open, overdue: c.tasks_overdue, urgent: 0, renewals: 0 }))
  ];

  const totalCompleted = allCoords.reduce((s, c) => s + c.completed, 0);
  const totalOpen = allCoords.reduce((s, c) => s + c.open, 0);
  const totalOverdue = allCoords.reduce((s, c) => s + c.overdue, 0);

  let scorecardRows = allCoords.map(c => {
    const pct = c.completed + c.open > 0 ? Math.round(c.completed / (c.completed + c.open) * 100) : 0;
    const barColor = pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626';
    return `<tr>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;font-weight:600">${escHtml(c.name)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#6B7280">${escHtml(c.role)}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:#059669;font-weight:700">${c.completed}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:${c.open > 0 ? '#D97706' : '#6B7280'}">${c.open}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB;text-align:center;color:${c.overdue > 0 ? '#DC2626' : '#6B7280'};font-weight:${c.overdue > 0 ? '700' : '400'}">${c.overdue}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #E5E7EB">
        <div style="background:#E5E7EB;border-radius:99px;height:8px;overflow:hidden">
          <div style="background:${barColor};height:100%;width:${pct}%;border-radius:99px"></div>
        </div>
        <div style="font-size:10px;color:${barColor};text-align:center;margin-top:2px">${pct}%</div>
      </td>
    </tr>`;
  }).join("");

  let tomorrowItems = allCoords.filter(c => c.open > 0).map(c =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-weight:600">${escHtml(c.name)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;font-size:12px;color:#6B7280">${escHtml(c.role)}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;font-weight:700;color:#D97706">${c.open}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center;font-weight:700;color:#DC2626">${c.overdue}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #E5E7EB;text-align:center">${c.renewals > 0 ? c.renewals + ' renewals' : '—'}</td>
    </tr>`
  ).join("");

  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff">
    <div style="background:linear-gradient(135deg,#7C3AED 0%,#9333EA 100%);padding:24px 28px;border-radius:12px 12px 0 0">
      <h1 style="color:#fff;margin:0;font-size:22px">🌙 End-of-Day Review — ${data.report_date}</h1>
      <p style="color:#DDD6FE;margin:6px 0 0;font-size:13px">${totalCompleted} completed · ${totalOpen} carrying over · ${totalOverdue} overdue</p>
    </div>
    <div style="padding:24px 28px;background:#F9FAFB;border-radius:0 0 12px 12px">

      <div style="display:flex;gap:12px;margin-bottom:20px">
        <div style="flex:1;background:#ECFDF5;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:900;color:#059669">${totalCompleted}</div>
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase">Completed Today</div>
        </div>
        <div style="flex:1;background:#FEF3C7;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:900;color:#D97706">${totalOpen}</div>
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase">Carry-Over</div>
        </div>
        <div style="flex:1;background:#FEF2F2;border-radius:8px;padding:14px;text-align:center">
          <div style="font-size:28px;font-weight:900;color:#DC2626">${totalOverdue}</div>
          <div style="font-size:11px;color:#6B7280;text-transform:uppercase">Overdue</div>
        </div>
      </div>

      <h2 style="font-size:15px;color:#1F2937;margin:0 0 12px;border-bottom:2px solid #7C3AED;padding-bottom:6px">📊 Final Scorecard</h2>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden">
        <thead><tr style="background:#F5F3FF">
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Name</th>
          <th style="padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280">Role</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Done</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Open</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280">Overdue</th>
          <th style="padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280;min-width:80px">Progress</th>
        </tr></thead>
        <tbody>${scorecardRows}</tbody>
      </table>

      ${tomorrowItems ? `<h2 style=\"font-size:15px;color:#DC2626;margin:0 0 12px;border-bottom:2px solid #DC2626;padding-bottom:6px\">📋 Tomorrow's Carry-Over Tasks</h2>
      <table style=\"width:100%;border-collapse:collapse;margin-bottom:24px;font-size:13px;background:#fff;border-radius:8px;overflow:hidden\">
        <thead><tr style=\"background:#FEF2F2\">
          <th style=\"padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280\">Name</th>
          <th style=\"padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;color:#6B7280\">Role</th>
          <th style=\"padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280\">Open Tasks</th>
          <th style=\"padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280\">Overdue</th>
          <th style=\"padding:10px 12px;text-align:center;font-size:11px;text-transform:uppercase;color:#6B7280\">Priority</th>
        </tr></thead>
        <tbody>${tomorrowItems}</tbody>
      </table>` : '<p style="color:#059669;font-size:14px;font-weight:600">🎉 All tasks completed — clean slate tomorrow!</p>'}

      <div style="font-size:11px;color:#9CA3AF;text-align:center;margin-top:16px">EdemaCare Operations Platform — Auto-generated report<br/><span style="opacity:0.7">EdemaCare is a service of AxiomHealth Management LLC</span></div>
    </div>
  </div>`;
}

Deno.serve(async (req: Request) => {
  try {
    const body = await req.json().catch(() => ({}));
    const reportType = body.report_type || 'morning_overview';

    if (reportType === 'overload_check_only') {
      const { data: overloaded } = await supabase.rpc('check_coordinator_overload');
      if (overloaded && overloaded.length > 0) {
        for (const coord of overloaded) {
          await supabase.from('coordinator_overload_alerts').insert({
            coordinator_id: coord.coordinator_id,
            coordinator_name: coord.name,
            incomplete_count: coord.incomplete_count,
          });
          if (RESEND_API_KEY) {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                from: FROM_EMAIL,
                to: [DIRECTOR_EMAIL],
                subject: `⚠️ OVERLOAD ALERT: ${coord.name} — ${coord.incomplete_count} incomplete tasks`,
                html: `<div style=\"font-family:'Segoe UI',Arial,sans-serif;max-width:500px;margin:0 auto\"><div style=\"background:#DC2626;padding:20px 24px;border-radius:12px 12px 0 0\"><h1 style=\"color:#fff;margin:0;font-size:20px\">⚠️ Coordinator Overload Alert</h1></div><div style=\"padding:20px 24px;background:#FEF2F2;border-radius:0 0 12px 12px\"><p style=\"font-size:16px;color:#991B1B\"><strong>${escHtml(coord.name)}</strong> (${escHtml(coord.role)}) has <strong>${coord.incomplete_count}</strong> incomplete tasks.</p><p style=\"font-size:13px;color:#6B7280\">This exceeds the 30-task threshold. Review their workload and consider redistributing tasks.</p></div></div>`,
              }),
            });
          }
        }
      }
      return new Response(JSON.stringify({ success: true, report_type: 'overload_check_only', overload_alerts: overloaded?.length || 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Generate report data from DB
    const { data: reportData, error: rpcErr } = await supabase.rpc('generate_daily_ops_report', { p_report_type: reportType });
    if (rpcErr) throw new Error(`RPC error: ${rpcErr.message}`);

    // 2. Render HTML
    let html = '';
    let subject = '';
    const isLive = reportType === 'live_snapshot';
    if (reportType === 'morning_overview') {
      html = renderMorningOverview(reportData);
      subject = `☀️ Morning Overview — ${reportData.report_date}`;
    } else if (reportType === 'midday_snapshot' || isLive) {
      html = renderMiddaySnapshot(reportData);
      subject = isLive
        ? `⚡ Live Snapshot — ${reportData.report_date} ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/New_York' })}`
        : `🕛 Midday Snapshot — ${reportData.report_date}`;
    } else {
      html = renderEODReview(reportData);
      subject = `🌙 End-of-Day Review — ${reportData.report_date}`;
    }

    // 3. Store report in DB for in-app viewing — CAPTURE id for the alerts step
    const { data: insertedReport, error: insErr } = await supabase
      .from('daily_ops_reports')
      .insert({
        report_type: reportType,
        report_html: html,
        summary: reportData,
      })
      .select('id')
      .single();
    if (insErr) console.error('daily_ops_reports insert failed:', insErr.message);
    const insertedReportId: string | null = insertedReport?.id ?? null;

    // 3b. 2026-05-28: surface the standup as an in-app alert so it shows in
    // AlertsBell for admin / super_admin coordinators. Dedup on report_id —
    // re-runs (cron retry, manual trigger) won't create duplicates.
    //
    // Skip for live_snapshot — those are on-demand, not scheduled standups.
    if (!isLive && insertedReportId) {
      const labelMap: Record<string, { title: string; tag: string }> = {
        morning_overview: { title: 'Morning Brief', tag: 'morning' },
        midday_snapshot:  { title: 'Midday Pulse', tag: 'midday' },
        eod_review:       { title: 'End-of-Day Review', tag: 'eod' },
      };
      const lab = labelMap[reportType] ?? { title: 'Ops Brief', tag: reportType };

      // Dedup: only insert if no open ops_brief alert exists for this report_id
      const { data: existing } = await supabase
        .from('alerts')
        .select('id')
        .eq('alert_type', 'ops_brief')
        .eq('is_dismissed', false)
        .filter('metadata->>report_id', 'eq', insertedReportId)
        .limit(1);

      if (!existing || existing.length === 0) {
        const { error: alertErr } = await supabase.from('alerts').insert({
          alert_type: 'ops_brief',
          priority: 'medium',
          title: `${lab.title} — ${reportData.report_date}`,
          message: `Team status report ready (${reportType}). Open the Operations Dashboard to view today's standups.`,
          related_date: reportData.report_date,
          metadata: {
            report_id: insertedReportId,
            report_type: reportType,
            tag: lab.tag,
            source: 'daily-ops-report',
          },
        });
        if (alertErr) console.error('ops_brief alert insert failed:', alertErr.message);
      }
    }

    // 4. Send email via Resend
    if (RESEND_API_KEY && !isLive) {
      const emailRes = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: [DIRECTOR_EMAIL],
          subject,
          html,
        }),
      });
      const emailResult = await emailRes.json();
      if (!emailRes.ok) console.error('Email send failed:', emailResult);
    }

    // 5. Check for overloaded coordinators
    const { data: overloaded } = await supabase.rpc('check_coordinator_overload');
    if (overloaded && overloaded.length > 0) {
      for (const coord of overloaded) {
        await supabase.from('coordinator_overload_alerts').insert({
          coordinator_id: coord.coordinator_id,
          coordinator_name: coord.name,
          incomplete_count: coord.incomplete_count,
        });
        if (RESEND_API_KEY && !isLive) {
          await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM_EMAIL,
              to: [DIRECTOR_EMAIL],
              subject: `⚠️ OVERLOAD ALERT: ${coord.name} — ${coord.incomplete_count} incomplete tasks`,
              html: `<div style=\"font-family:'Segoe UI',Arial,sans-serif;max-width:500px;margin:0 auto\"><div style=\"background:#DC2626;padding:20px 24px;border-radius:12px 12px 0 0\"><h1 style=\"color:#fff;margin:0;font-size:20px\">⚠️ Coordinator Overload Alert</h1></div><div style=\"padding:20px 24px;background:#FEF2F2;border-radius:0 0 12px 12px\"><p style=\"font-size:16px;color:#991B1B\"><strong>${escHtml(coord.name)}</strong> (${escHtml(coord.role)}) has <strong>${coord.incomplete_count}</strong> incomplete tasks.</p><p style=\"font-size:13px;color:#6B7280\">This exceeds the 30-task threshold. Review their workload and consider redistributing tasks.</p></div></div>`,
            }),
          });
        }
      }
    }

    return new Response(JSON.stringify({ success: true, report_type: reportType, ops_brief_alert: !isLive, overload_alerts: overloaded?.length || 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('daily-ops-report error:', err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
