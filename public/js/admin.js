// ============================================================
// Admin console — hash router + views
// ============================================================

const NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { key: 'applicants', label: 'Applicants', icon: 'users' },
  { key: 'interviews', label: 'Interviews', icon: 'calendar' },
  { key: 'job-settings', label: 'Job Settings', icon: 'briefcase' },
  { key: 'templates', label: 'Notification Templates', icon: 'mail' },
];

const ICONS = {
  grid: '<path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  users: '<path d="M16 19v-1.5a3.5 3.5 0 00-3.5-3.5h-5A3.5 3.5 0 004 17.5V19M17.5 8a3 3 0 100-6 3 3 0 000 6zM9.5 11a4 4 0 100-8 4 4 0 000 8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  briefcase: '<rect x="3" y="7.5" width="18" height="12" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 7.5V6a2 2 0 012-2h3a2 2 0 012 2v1.5" stroke="currentColor" stroke-width="1.8"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M4 6.5l8 6 8-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
};

const STAGE_META = {
  application_received: { label: 'Application Received', pill: 'pill-received' },
  under_review: { label: 'Under Review', pill: 'pill-review' },
  interview: { label: 'Interview', pill: 'pill-interview' },
  recruited: { label: 'Recruited', pill: 'pill-recruited' },
  rejected: { label: 'Rejected', pill: 'pill-rejected' },
  withdrawn: { label: 'Withdrawn', pill: 'pill-withdrawn' },
};
const INTERVIEW_META = {
  not_scheduled: 'Not Scheduled', scheduled: 'Scheduled', attended: 'Attended', did_not_attend: 'Did Not Attend'
};

let ME = null;

// ---------------- Bootstrapping ----------------
async function boot() {
  const res = await fetch('/api/admin/me');
  if (!res.ok) { location.href = '/admin/login.html'; return; }
  ME = await res.json();
  document.getElementById('userName').textContent = ME.name;
  document.getElementById('userRole').textContent = ME.role;
  renderNav();
  window.addEventListener('hashchange', route);
  route();
}

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  location.href = '/admin/login.html';
});

function renderNav() {
  const html = NAV.map(n => `
    <button class="nav-item" data-key="${n.key}">
      <svg viewBox="0 0 24 24" fill="none">${ICONS[n.icon]}</svg>${n.label}
    </button>`).join('');
  document.getElementById('sideNav').innerHTML = html;
  document.getElementById('mobileTabs').innerHTML = NAV.map(n => `<button data-key="${n.key}">${n.label}</button>`).join('');

  document.querySelectorAll('.nav-item, .mobile-tabs button').forEach(btn => {
    btn.addEventListener('click', () => { location.hash = '#' + btn.dataset.key; });
  });
}

function setActiveNav(key) {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.key === key));
  document.querySelectorAll('.mobile-tabs button').forEach(b => b.classList.toggle('active', b.dataset.key === key));
}

// ---------------- Router ----------------
function route() {
  const hash = location.hash.replace('#', '') || 'dashboard';
  const [root, sub] = hash.split('/');
  setActiveNav(root);
  const titles = { dashboard: 'Dashboard', applicants: sub ? 'Applicant' : 'Applicants', interviews: 'Interviews', 'job-settings': 'Job Settings', templates: 'Notification Templates' };
  document.getElementById('pageTitle').textContent = titles[root] || 'Dashboard';

  if (root === 'dashboard') renderDashboard();
  else if (root === 'applicants' && sub) renderApplicantProfile(sub);
  else if (root === 'applicants') renderApplicants();
  else if (root === 'interviews') renderInterviews();
  else if (root === 'job-settings') renderJobSettings();
  else if (root === 'templates') renderTemplates();
  else renderDashboard();
}

// ---------------- Helpers ----------------
function el(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
function fmtDate(s) { if (!s) return '—'; const d = new Date(s.includes('T') || s.includes(' ') ? s : s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtDateTime(s) { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + 'Z'); return isNaN(d) ? s : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
function initials(f, l) { return `${(f||'?')[0]||''}${(l||'')[0]||''}`.toUpperCase(); }
function pill(stage) { const m = STAGE_META[stage] || STAGE_META.application_received; return `<span class="pill ${m.pill}"><span class="dot"></span>${m.label}</span>`; }
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2400); }
function openModal(html) { document.getElementById('modalRoot').innerHTML = html; document.getElementById('modalBackdrop').classList.add('open'); }
function closeModal() { document.getElementById('modalBackdrop').classList.remove('open'); }
document.getElementById('modalBackdrop').addEventListener('click', (e) => { if (e.target.id === 'modalBackdrop') closeModal(); });

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (res.status === 401) { location.href = '/admin/login.html'; throw new Error('unauthorized'); }
  if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || 'Request failed'); }
  return res.json();
}

// ============================================================
// DASHBOARD
// ============================================================
async function renderDashboard() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="empty-state">Loading dashboard…</div>`;
  const s = await api('/api/admin/stats');

  const maxState = Math.max(1, ...s.by_state.map(x => x.count));
  const maxCountry = Math.max(1, ...s.by_country.map(x => x.count));
  const maxFunnel = Math.max(1, ...s.funnel.map(x => x.value));

  content.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card accent"><div class="lbl">Completed Applications</div><div class="val">${s.completed}</div><div class="sub">${s.completion_rate}% completion rate</div></div>
      <div class="stat-card"><div class="lbl">Under Review</div><div class="val">${s.under_review}</div></div>
      <div class="stat-card"><div class="lbl">Interviews Scheduled</div><div class="val">${s.interviews_scheduled}</div></div>
      <div class="stat-card"><div class="lbl">Recruited</div><div class="val">${s.recruited}</div></div>
      <div class="stat-card"><div class="lbl">Total Started</div><div class="val">${s.total_started}</div><div class="sub">${s.incomplete} incomplete</div></div>
      <div class="stat-card"><div class="lbl">Interview Attendance</div><div class="val">${s.interview_attended}</div><div class="sub">${s.interview_no_show} no-shows</div></div>
      <div class="stat-card"><div class="lbl">Rejected</div><div class="val">${s.rejected}</div></div>
      <div class="stat-card"><div class="lbl">Interview → Recruit</div><div class="val">${s.interview_to_recruit_rate}%</div><div class="sub">${s.application_to_recruit_rate}% overall</div></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Recruitment funnel</h3></div>
      ${s.funnel.map(f => `
        <div class="funnel-row">
          <div class="funnel-label">${f.label}</div>
          <div class="funnel-bar-wrap"><div class="funnel-bar" style="width:${Math.max(4, (f.value/maxFunnel)*100)}%"></div></div>
          <div class="funnel-val mono">${f.value}</div>
        </div>
      `).join('')}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Applications by state</h3></div>
      ${s.by_state.length ? s.by_state.map(x => `
        <div class="state-row">
          <div class="state-name">${x.state}</div>
          <div class="state-bar-wrap"><div class="state-bar" style="width:${Math.max(4, (x.count/maxState)*100)}%"></div></div>
          <div class="state-count mono">${x.count}</div>
        </div>
      `).join('') : `<div class="empty-state">No completed applications yet.</div>`}
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Applications by country</h3></div>
      ${s.by_country.length ? s.by_country.map(x => `
        <div class="state-row">
          <div class="state-name">${x.country}</div>
          <div class="state-bar-wrap"><div class="state-bar" style="width:${Math.max(4, (x.count/maxCountry)*100)}%"></div></div>
          <div class="state-count mono">${x.count}</div>
        </div>
      `).join('') : `<div class="empty-state">No completed applications yet.</div>`}
    </div>
  `;
}

// ============================================================
// APPLICANTS LIST
// ============================================================
let listFilters = {};

async function renderApplicants() {
  const content = document.getElementById('content');
  content.innerHTML = `
    <div class="toolbar">
      <input type="search" id="searchInput" placeholder="Search name, email, phone, or application ID…">
      <select id="filterStage">
        <option value="">All stages</option>
        ${Object.entries(STAGE_META).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}
      </select>
      <select id="filterCountry"><option value="">All countries</option></select>
      <select id="filterState"><option value="">All states</option></select>
      <select id="filterInterview">
        <option value="">Any interview status</option>
        ${Object.entries(INTERVIEW_META).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
      </select>
      <select id="sortSelect">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="interview_date">Interview date</option>
        <option value="state">State</option>
        <option value="stage">Stage</option>
      </select>
    </div>
    <div id="tableWrap"></div>
  `;

  document.getElementById('searchInput').addEventListener('input', debounce(loadApplicants, 300));
  ['filterStage','filterCountry','filterState','filterInterview','sortSelect'].forEach(id => document.getElementById(id).addEventListener('change', loadApplicants));

  // Populate country/state dropdowns from actual applicant data
  try {
    const { countries, states } = await api('/api/admin/applicants/meta/locations');
    const countrySel = document.getElementById('filterCountry');
    const stateSel = document.getElementById('filterState');
    countries.forEach(c => countrySel.insertAdjacentHTML('beforeend', `<option value="${c}">${c}</option>`));
    states.forEach(s => stateSel.insertAdjacentHTML('beforeend', `<option value="${s}">${s}</option>`));
  } catch (e) { /* filters still work without options if this fails */ }

  loadApplicants();
}

function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

async function loadApplicants() {
  const search = document.getElementById('searchInput')?.value || '';
  const stage = document.getElementById('filterStage')?.value || '';
  const country = document.getElementById('filterCountry')?.value || '';
  const state = document.getElementById('filterState')?.value || '';
  const interview_attendance = document.getElementById('filterInterview')?.value || '';
  const sort = document.getElementById('sortSelect')?.value || 'newest';

  const params = new URLSearchParams({ status: 'completed' });
  if (search) params.set('search', search);
  if (stage) params.set('stage', stage);
  if (country) params.set('country', country);
  if (state) params.set('state', state);
  if (interview_attendance) params.set('interview_attendance', interview_attendance);
  if (sort) params.set('sort', sort);

  const rows = await api('/api/admin/applicants?' + params.toString());
  const wrap = document.getElementById('tableWrap');

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state">No applicants match these filters yet.</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="applicants">
        <thead><tr>
          <th>Applicant</th><th>Application ID</th><th>Phone</th><th>Location</th><th>Country</th>
          <th>Applied</th><th>Stage</th><th>Interview</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr data-id="${r.id}">
              <td><strong>${r.first_name || ''} ${r.last_name || ''}</strong><br><span style="color:var(--muted); font-size:12px;">${r.email || ''}</span></td>
              <td class="app-id-cell">${r.application_id}</td>
              <td>${r.phone || '—'}</td>
              <td>${[r.city, r.state].filter(Boolean).join(', ') || '—'}</td>
              <td>${r.country || '—'}</td>
              <td>${fmtDate(r.created_at)}</td>
              <td>${pill(r.recruitment_stage)}</td>
              <td>${INTERVIEW_META[r.interview_status] || '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  wrap.querySelectorAll('tbody tr').forEach(tr => {
    tr.addEventListener('click', () => { location.hash = `#applicants/${tr.dataset.id}`; });
  });
}

// ============================================================
// APPLICANT PROFILE
// ============================================================
async function renderApplicantProfile(id) {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="empty-state">Loading applicant…</div>`;
  const a = await api(`/api/admin/applicants/${id}`);

  const stageOrder = ['application_received','under_review','interview','recruited'];

  content.innerHTML = `
    <a href="#applicants" style="font-size:13px; color:var(--muted); text-decoration:none; display:inline-block; margin-bottom:14px;">← Back to applicants</a>
    <div class="profile-grid">
      <div>
        <div class="panel">
          <div class="profile-header">
            <div style="display:flex; align-items:center; gap:14px;">
              <div class="avatar-lg">${initials(a.first_name, a.last_name)}</div>
              <div>
                <h2 style="font-size:19px;">${a.first_name || ''} ${a.last_name || ''}</h2>
                <div class="app-id-cell mono">${a.application_id}</div>
              </div>
            </div>
            ${pill(a.recruitment_stage)}
          </div>

          <div class="stage-pipeline">
            ${stageOrder.map(s => `<button class="stage-btn ${a.recruitment_stage===s?'current':''}" data-stage="${s}">${STAGE_META[s].label}</button>`).join('')}
            <button class="stage-btn" style="color:var(--danger); border-color:var(--danger-tint);" data-stage="rejected">Reject</button>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Candidate information</h3></div>
          <div class="kv-grid">
            <div class="kv-item"><div class="k">Email</div><div class="v">${a.email || '—'}</div></div>
            <div class="kv-item"><div class="k">Phone</div><div class="v">${a.phone || '—'}</div></div>
            <div class="kv-item"><div class="k">WhatsApp</div><div class="v">${a.whatsapp_number || '—'}</div></div>
            <div class="kv-item"><div class="k">Location</div><div class="v">${[a.city, a.state, a.country].filter(Boolean).join(', ') || '—'}</div></div>
            <div class="kv-item"><div class="k">Education</div><div class="v">${a.education_level || '—'}</div></div>
            <div class="kv-item"><div class="k">Employment status</div><div class="v">${a.employment_status || '—'}</div></div>
            <div class="kv-item"><div class="k">Telesales experience</div><div class="v">${a.telesales_experience || '—'} ${a.experience_duration ? '· ' + a.experience_duration : ''}</div></div>
            <div class="kv-item"><div class="k">Sales experience</div><div class="v">${a.sales_experience || '—'}</div></div>
            <div class="kv-item"><div class="k">Previous role</div><div class="v">${[a.previous_role, a.previous_company].filter(Boolean).join(' at ') || '—'}</div></div>
            <div class="kv-item"><div class="k">Start availability</div><div class="v">${a.start_availability || '—'}</div></div>
            <div class="kv-item"><div class="k">Preferred arrangement</div><div class="v">${a.preferred_work_arrangement || '—'}</div></div>
            <div class="kv-item"><div class="k">CV</div><div class="v">${a.cv_url ? `<a href="${a.cv_url}" target="_blank" style="color:var(--primary-dark); text-decoration:underline;">${a.cv_filename || 'Download'}</a>` : '—'}</div></div>
          </div>
          <div style="margin-top:16px;">
            <div class="k" style="font-size:11.5px; color:var(--muted); font-family:var(--font-mono); text-transform:uppercase;">Why they want this role</div>
            <p style="margin-top:6px; font-size:14px; color:var(--ink-soft); line-height:1.6;">${a.reason_for_applying || '—'}</p>
          </div>
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Interview</h3>
            <button class="btn btn-primary btn-sm" id="scheduleBtn">${a.interview_status === 'not_scheduled' ? 'Schedule interview' : 'Reschedule'}</button>
          </div>
          ${a.interview_status !== 'not_scheduled' ? `
            <div class="kv-grid">
              <div class="kv-item"><div class="k">Date & time</div><div class="v">${fmtDate(a.interview_date)} ${a.interview_time || ''}</div></div>
              <div class="kv-item"><div class="k">Type</div><div class="v">${a.interview_type || '—'}</div></div>
              <div class="kv-item"><div class="k">Status</div><div class="v">${INTERVIEW_META[a.interview_status]}</div></div>
              <div class="kv-item"><div class="k">Link / Address</div><div class="v">${a.interview_link || a.interview_address || '—'}</div></div>
            </div>
            <div style="display:flex; gap:8px; margin-top:14px;">
              <button class="btn btn-secondary btn-sm" id="markAttended">Mark attended</button>
              <button class="btn btn-secondary btn-sm" id="markNoShow">Mark did not attend</button>
              <button class="btn btn-outline btn-sm" id="sendReminder">Send reminder</button>
            </div>
          ` : `<p style="font-size:13.5px; color:var(--muted);">No interview scheduled yet.</p>`}
        </div>

        <div class="panel">
          <div class="panel-head"><h3>Internal notes</h3></div>
          <div style="display:flex; gap:8px; margin-bottom:14px;">
            <input id="noteInput" placeholder="Add a note about this candidate…" style="flex:1; padding:10px 12px; border:1.5px solid var(--border); border-radius:8px;">
            <button class="btn btn-secondary btn-sm" id="addNoteBtn">Add</button>
          </div>
          <div id="notesList">
            ${a.internal_notes.length ? a.internal_notes.map(n => `
              <div class="note-item"><div class="note-meta">${n.author} · ${fmtDateTime(n.created_at)}</div>${n.note}</div>
            `).join('') : `<p style="font-size:13px; color:var(--muted);">No notes yet. Notes are only visible to the recruitment team.</p>`}
          </div>
        </div>
      </div>

      <div>
        <div class="panel">
          <div class="panel-head"><h3>Stage history</h3></div>
          ${a.history.length ? a.history.map(h => `
            <div class="timeline-item">
              <div class="timeline-dot"></div>
              <div>
                <div>${STAGE_META[h.previous_stage]?.label || h.previous_stage || 'Start'} → <strong>${STAGE_META[h.new_stage]?.label || h.new_stage}</strong></div>
                <div class="tmeta">${h.changed_by} · ${fmtDateTime(h.created_at)}</div>
              </div>
            </div>
          `).join('') : `<p style="font-size:13px; color:var(--muted);">No stage changes yet.</p>`}
        </div>
        <div class="panel">
          <div class="panel-head"><h3>Notifications sent</h3></div>
          ${a.notifications.length ? a.notifications.map(n => `
            <div class="timeline-item">
              <div class="timeline-dot" style="background:var(--amber);"></div>
              <div>
                <div>${n.notification_type.replace(/_/g,' ')} <span style="color:var(--muted);">via ${n.channel}</span></div>
                <div class="tmeta">${fmtDateTime(n.sent_at)} · ${n.status}</div>
              </div>
            </div>
          `).join('') : `<p style="font-size:13px; color:var(--muted);">No notifications sent yet.</p>`}
        </div>
      </div>
    </div>
  `;

  // Stage buttons
  content.querySelectorAll('.stage-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const stage = btn.dataset.stage;
      if (stage === a.recruitment_stage) return;
      if (stage === 'rejected') return openRejectModal(a.id);
      await api(`/api/admin/applicants/${a.id}/stage`, { method: 'POST', body: JSON.stringify({ new_stage: stage }) });
      toast(`Moved to ${STAGE_META[stage].label}`);
      renderApplicantProfile(id);
    });
  });

  document.getElementById('scheduleBtn').addEventListener('click', () => openInterviewModal(a));
  document.getElementById('markAttended')?.addEventListener('click', async () => {
    await api(`/api/admin/applicants/${a.id}/attendance`, { method: 'POST', body: JSON.stringify({ status: 'attended' }) });
    toast('Marked as attended'); renderApplicantProfile(id);
  });
  document.getElementById('markNoShow')?.addEventListener('click', async () => {
    await api(`/api/admin/applicants/${a.id}/attendance`, { method: 'POST', body: JSON.stringify({ status: 'did_not_attend' }) });
    toast('Marked as did not attend'); renderApplicantProfile(id);
  });
  document.getElementById('sendReminder')?.addEventListener('click', async () => {
    await api(`/api/admin/applicants/${a.id}/remind`, { method: 'POST', body: JSON.stringify({}) });
    toast('Reminder sent'); renderApplicantProfile(id);
  });
  document.getElementById('addNoteBtn').addEventListener('click', async () => {
    const input = document.getElementById('noteInput');
    if (!input.value.trim()) return;
    await api(`/api/admin/applicants/${a.id}/notes`, { method: 'POST', body: JSON.stringify({ note: input.value.trim() }) });
    input.value = '';
    renderApplicantProfile(id);
  });
}

function openRejectModal(id) {
  openModal(`
    <h3>Reject applicant</h3>
    <div class="fg" style="margin-bottom:16px;">
      <label>Reason (optional, internal only)</label>
      <textarea id="rejReason" placeholder="e.g. Did not meet communication requirements"></textarea>
    </div>
    <div style="display:flex; gap:10px;">
      <button class="btn btn-outline btn-block" id="cancelReject">Cancel</button>
      <button class="btn btn-danger btn-block" id="confirmReject">Reject applicant</button>
    </div>
  `);
  document.getElementById('cancelReject').addEventListener('click', closeModal);
  document.getElementById('confirmReject').addEventListener('click', async () => {
    const reason = document.getElementById('rejReason').value;
    await api(`/api/admin/applicants/${id}/stage`, { method: 'POST', body: JSON.stringify({ new_stage: 'rejected', rejection_reason: reason }) });
    closeModal(); toast('Applicant rejected');
    route();
  });
}

function openInterviewModal(a) {
  openModal(`
    <h3>Schedule interview</h3>
    <div class="form-grid">
      <div class="fg"><label>Date</label><input type="date" id="iDate" value="${a.interview_date || ''}"></div>
      <div class="fg"><label>Time</label><input type="time" id="iTime" value="${a.interview_time || ''}"></div>
      <div class="fg"><label>Time zone</label><input type="text" id="iTz" value="${a.interview_timezone || 'WAT (GMT+1)'}"></div>
      <div class="fg"><label>Type</label>
        <select id="iType">
          ${['Phone Call','WhatsApp Call','Google Meet','Physical Interview','Other'].map(t => `<option ${a.interview_type===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="fg" style="margin-top:12px;"><label>Meeting link (if online)</label><input type="text" id="iLink" value="${a.interview_link || ''}" placeholder="https://meet.google.com/..."></div>
    <div class="fg" style="margin-top:12px;"><label>Address (if physical)</label><input type="text" id="iAddress" value="${a.interview_address || ''}"></div>
    <div class="fg" style="margin-top:12px;"><label>Instructions (optional)</label><textarea id="iInstructions">${a.interview_instructions || ''}</textarea></div>
    <div style="display:flex; gap:10px; margin-top:18px;">
      <button class="btn btn-outline btn-block" id="cancelInterview">Cancel</button>
      <button class="btn btn-primary btn-block" id="confirmInterview">Save & notify</button>
    </div>
  `);
  document.getElementById('cancelInterview').addEventListener('click', closeModal);
  document.getElementById('confirmInterview').addEventListener('click', async () => {
    const body = {
      interview_date: document.getElementById('iDate').value,
      interview_time: document.getElementById('iTime').value,
      interview_timezone: document.getElementById('iTz').value,
      interview_type: document.getElementById('iType').value,
      interview_link: document.getElementById('iLink').value,
      interview_address: document.getElementById('iAddress').value,
      interview_instructions: document.getElementById('iInstructions').value,
    };
    if (!body.interview_date || !body.interview_time) { toast('Please set a date and time'); return; }
    await api(`/api/admin/applicants/${a.id}/interview`, { method: 'POST', body: JSON.stringify(body) });
    closeModal(); toast('Interview scheduled — candidate notified');
    route();
  });
}

// ============================================================
// INTERVIEWS
// ============================================================
async function renderInterviews() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="empty-state">Loading interviews…</div>`;
  const rows = await api('/api/admin/applicants?stage=interview&sort=interview_date');

  if (!rows.length) {
    content.innerHTML = `<div class="panel empty-state">No interviews scheduled yet. Move an applicant to the Interview stage from their profile to schedule one.</div>`;
    return;
  }

  content.innerHTML = `
    <div class="table-wrap">
      <table class="applicants">
        <thead><tr><th>Applicant</th><th>Date</th><th>Time</th><th>Type</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td><strong>${r.first_name} ${r.last_name}</strong><br><span style="color:var(--muted); font-size:12px;">${r.application_id}</span></td>
              <td>${fmtDate(r.interview_date)}</td>
              <td>${r.interview_time || '—'}</td>
              <td>${r.interview_type || '—'}</td>
              <td>${INTERVIEW_META[r.interview_status]}</td>
              <td>
                <button class="btn btn-secondary btn-sm" data-act="view" data-id="${r.id}">View</button>
                ${r.interview_status === 'scheduled' ? `
                  <button class="btn btn-secondary btn-sm" data-act="attended" data-id="${r.id}">Attended</button>
                  <button class="btn btn-outline btn-sm" data-act="noshow" data-id="${r.id}">No-show</button>
                ` : ''}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  content.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      if (btn.dataset.act === 'view') { location.hash = `#applicants/${id}`; return; }
      const status = btn.dataset.act === 'attended' ? 'attended' : 'did_not_attend';
      await api(`/api/admin/applicants/${id}/attendance`, { method: 'POST', body: JSON.stringify({ status }) });
      toast('Attendance updated'); renderInterviews();
    });
  });
}

// ============================================================
// JOB SETTINGS
// ============================================================
async function renderJobSettings() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="empty-state">Loading job settings…</div>`;
  const j = await api('/api/admin/job-settings');
  const resp = JSON.parse(j.responsibilities || '[]');
  const reqs = JSON.parse(j.requirements || '[]');

  content.innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Role details</h3></div>
      <div class="form-grid">
        <div class="fg"><label>Job title</label><input id="jTitle" value="${j.job_title || ''}"></div>
        <div class="fg"><label>Application status</label>
          <select id="jOpen"><option value="1" ${j.application_open? 'selected':''}>Open</option><option value="0" ${!j.application_open? 'selected':''}>Closed</option></select>
        </div>
      </div>
      <div class="fg" style="margin-top:14px;"><label>Job summary</label><textarea id="jSummary">${j.job_summary || ''}</textarea></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Responsibilities</h3></div>
      <div id="respList" class="tag-list"></div>
      <div style="display:flex; gap:8px; margin-top:10px;"><input id="respInput" placeholder="Add a responsibility…" style="flex:1; padding:10px 12px; border:1.5px solid var(--border); border-radius:8px;"><button class="btn btn-secondary btn-sm" id="respAdd">Add</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Requirements</h3></div>
      <div id="reqList" class="tag-list"></div>
      <div style="display:flex; gap:8px; margin-top:10px;"><input id="reqInput" placeholder="Add a requirement…" style="flex:1; padding:10px 12px; border:1.5px solid var(--border); border-radius:8px;"><button class="btn btn-secondary btn-sm" id="reqAdd">Add</button></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Compensation</h3></div>
      <div class="form-grid">
        <div class="fg"><label>Minimum salary (₦/month)</label><input type="number" id="jMin" value="${j.min_salary || 0}"></div>
        <div class="fg"><label>Maximum salary (₦/month)</label><input type="number" id="jMax" value="${j.max_salary || 0}"></div>
      </div>
      <div class="fg" style="margin-top:14px;"><label>Commission description</label><textarea id="jCommission">${j.commission_description || ''}</textarea></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Employment terms</h3></div>
      <div class="form-grid">
        <div class="fg"><label>Employment type</label><input id="jType" value="${j.employment_type || ''}"></div>
        <div class="fg"><label>Work arrangement</label><input id="jArrangement" value="${j.work_arrangement || ''}"></div>
        <div class="fg"><label>Working days</label><input id="jDays" value="${j.working_days || ''}"></div>
        <div class="fg"><label>Working hours</label><input id="jHours" value="${j.working_hours || ''}"></div>
        <div class="fg"><label>Probation period</label><input id="jProbation" value="${j.probation_period || ''}"></div>
        <div class="fg"><label>Payment schedule</label><input id="jPayment" value="${j.payment_schedule || ''}"></div>
      </div>
      <div class="fg" style="margin-top:14px;"><label>Performance expectations</label><textarea id="jPerf">${j.performance_expectations || ''}</textarea></div>
    </div>

    <div class="panel">
      <div class="panel-head"><h3>Notifications</h3></div>
      <div class="fg">
        <label>WhatsApp integration</label>
        <select id="jWhatsapp">
          <option value="1" ${j.whatsapp_enabled ? 'selected' : ''}>Enabled — candidates get WhatsApp notifications</option>
          <option value="0" ${!j.whatsapp_enabled ? 'selected' : ''}>Disabled — email notifications only</option>
        </select>
      </div>
    </div>

    <button class="btn btn-primary" id="saveJob">Save changes</button>
  `;

  let responsibilities = [...resp];
  let requirements = [...reqs];

  function renderTags(listEl, arr, onRemove) {
    listEl.innerHTML = arr.map((t, i) => `<span class="tag-editable">${t}<button data-i="${i}">✕</button></span>`).join('');
    listEl.querySelectorAll('button').forEach(b => b.addEventListener('click', () => onRemove(+b.dataset.i)));
  }
  const respListEl = document.getElementById('respList');
  const reqListEl = document.getElementById('reqList');

  function refreshResp() { renderTags(respListEl, responsibilities, (i) => { responsibilities.splice(i,1); refreshResp(); }); }
  function refreshReq() { renderTags(reqListEl, requirements, (i) => { requirements.splice(i,1); refreshReq(); }); }
  refreshResp(); refreshReq();

  document.getElementById('respAdd').addEventListener('click', () => {
    const inp = document.getElementById('respInput');
    if (inp.value.trim()) { responsibilities.push(inp.value.trim()); inp.value=''; refreshResp(); }
  });
  document.getElementById('reqAdd').addEventListener('click', () => {
    const inp = document.getElementById('reqInput');
    if (inp.value.trim()) { requirements.push(inp.value.trim()); inp.value=''; refreshReq(); }
  });

  document.getElementById('saveJob').addEventListener('click', async () => {
    const body = {
      job_title: document.getElementById('jTitle').value,
      job_summary: document.getElementById('jSummary').value,
      responsibilities, requirements,
      min_salary: +document.getElementById('jMin').value,
      max_salary: +document.getElementById('jMax').value,
      currency: '₦',
      commission_description: document.getElementById('jCommission').value,
      employment_type: document.getElementById('jType').value,
      work_arrangement: document.getElementById('jArrangement').value,
      working_days: document.getElementById('jDays').value,
      working_hours: document.getElementById('jHours').value,
      probation_period: document.getElementById('jProbation').value,
      performance_expectations: document.getElementById('jPerf').value,
      payment_schedule: document.getElementById('jPayment').value,
      application_open: document.getElementById('jOpen').value === '1',
      application_deadline: null,
      whatsapp_enabled: document.getElementById('jWhatsapp').value === '1',
    };
    await api('/api/admin/job-settings', { method: 'PUT', body: JSON.stringify(body) });
    toast('Job settings saved');
  });
}

// ============================================================
// NOTIFICATION TEMPLATES
// ============================================================
async function renderTemplates() {
  const content = document.getElementById('content');
  content.innerHTML = `<div class="empty-state">Loading templates…</div>`;
  const templates = await api('/api/admin/templates');

  content.innerHTML = templates.map(t => `
    <div class="panel">
      <div class="panel-head"><h3>${t.label}</h3><span class="app-id-cell mono">${t.key}</span></div>
      ${t.subject !== null ? `<div class="fg" style="margin-bottom:12px;"><label>Email subject</label><input data-key="${t.key}" class="tplSubject" value="${t.subject || ''}"></div>` : ''}
      <div class="fg"><label>Message</label><textarea data-key="${t.key}" class="tplBody" style="min-height:100px;">${t.body}</textarea></div>
      <p class="hint" style="color:var(--muted); font-size:12.5px; margin-top:8px;">Variables: {{first_name}} {{last_name}} {{application_id}} {{job_title}} {{interview_date}} {{interview_time}} {{interview_link}}</p>
      <button class="btn btn-secondary btn-sm" style="margin-top:12px;" data-save="${t.key}">Save template</button>
    </div>
  `).join('');

  content.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.save;
      const subjectEl = content.querySelector(`.tplSubject[data-key="${key}"]`);
      const bodyEl = content.querySelector(`.tplBody[data-key="${key}"]`);
      await api(`/api/admin/templates/${key}`, { method: 'PUT', body: JSON.stringify({ subject: subjectEl ? subjectEl.value : null, body: bodyEl.value }) });
      toast('Template saved');
    });
  });
}

boot();
