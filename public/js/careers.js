const NG_STATES = ["Abia","Adamawa","Akwa Ibom","Anambra","Bauchi","Bayelsa","Benue","Borno",
"Cross River","Delta","Ebonyi","Edo","Ekiti","Enugu","Gombe","Imo","Jigawa","Kaduna","Kano",
"Katsina","Kebbi","Kogi","Kwara","Lagos","Nasarawa","Niger","Ogun","Ondo","Osun","Oyo","Plateau",
"Rivers","Sokoto","Taraba","Yobe","Zamfara","FCT (Abuja)"];

const state = {
  step: 1,
  totalSteps: 5,
  application_id: localStorage.getItem('app_id') || null,
  data: JSON.parse(localStorage.getItem('app_data') || '{}'),
  cvFile: null,
  submitted: false
};

function persist() {
  localStorage.setItem('app_data', JSON.stringify(state.data));
  if (state.application_id) localStorage.setItem('app_id', state.application_id);
}

// ---------------- Job content ----------------
async function loadJob() {
  const res = await fetch('/api/job');
  const job = await res.json();
  document.getElementById('jobTitle').textContent = job.job_title;
  document.getElementById('jobSummary').textContent = job.job_summary;
  document.getElementById('statSalary').textContent = `${job.currency}${fmt(job.min_salary)}+`;
  document.getElementById('statType').textContent = job.employment_type;
  document.getElementById('salaryRange').textContent = `${job.currency}${fmt(job.min_salary)} – ${job.currency}${fmt(job.max_salary)}`;
  document.getElementById('commissionDesc').textContent = job.commission_description;

  document.getElementById('responsibilitiesList').innerHTML = job.responsibilities.map(listItem).join('');
  document.getElementById('requirementsList').innerHTML = job.requirements.map(listItem).join('');

  const terms = [
    ['Employment type', job.employment_type],
    ['Work arrangement', job.work_arrangement],
    ['Working days', job.working_days],
    ['Working hours', job.working_hours],
    ['Probation period', job.probation_period],
    ['Payment schedule', job.payment_schedule],
  ];
  document.getElementById('termsGrid').innerHTML = terms.map(([label, value]) => `
    <div class="term-item"><div class="t-label">${label}</div><div class="t-value">${value || '—'}</div></div>
  `).join('');

  refreshIcons();
}
function fmt(n) { return Number(n || 0).toLocaleString('en-NG'); }
function listItem(text) {
  return `<li><span class="ico"><i data-lucide="check"></i></span>${text}</li>`;
}
function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

// ---------------- Drawer ----------------
const drawer = document.getElementById('drawer');
const backdrop = document.getElementById('drawerBackdrop');

function openDrawer() {
  drawer.classList.add('open');
  backdrop.classList.add('open');
  document.body.style.overflow = 'hidden';
  renderStep();
}
function closeDrawer() {
  drawer.classList.remove('open');
  backdrop.classList.remove('open');
  document.body.style.overflow = '';
}
['topbarApply','heroApply','bottomApply','mobileApply'].forEach(id => {
  document.getElementById(id).addEventListener('click', openDrawer);
});
document.getElementById('drawerClose').addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);

// ---------------- Step rendering ----------------
const stepLabels = ['Personal Information','Location','Experience','Assessment','Review & Submit'];

function renderStepper() {
  document.getElementById('stepper').innerHTML = Array.from({length: state.totalSteps}).map((_, i) =>
    `<i class="${i < state.step ? 'active' : ''}"></i>`).join('');
}

function renderStep() {
  renderStepper();
  const body = document.getElementById('formSteps');
  const back = document.getElementById('backBtn');
  const next = document.getElementById('nextBtn');
  back.style.display = state.step > 1 && !state.submitted ? 'inline-flex' : 'none';
  next.textContent = state.step === state.totalSteps ? 'Submit application' : 'Continue';
  next.style.display = state.submitted ? 'none' : 'flex';

  const stepFns = [stepPersonal, stepLocation, stepExperience, stepAssessment, stepReview];
  body.innerHTML = `<span class="step-label">Step ${state.step} of ${state.totalSteps}</span>
    <h3 class="step-title">${stepLabels[state.step - 1]}</h3>` + stepFns[state.step - 1]();

  wireStepInputs();
  refreshIcons();
}

function field(name, label, opts = {}) {
  const val = state.data[name] || '';
  const type = opts.type || 'text';
  if (type === 'select') {
    const options = opts.options.map(o => `<option value="${o}" ${o === val ? 'selected' : ''}>${o}</option>`).join('');
    return `<div class="field" data-field="${name}"><label for="f_${name}">${label}</label>
      <select id="f_${name}" name="${name}" ${opts.required ? 'required' : ''}>
        <option value="">Select…</option>${options}
      </select><div class="error-text">This field is required.</div></div>`;
  }
  if (type === 'textarea') {
    return `<div class="field" data-field="${name}"><label for="f_${name}">${label}</label>
      <textarea id="f_${name}" name="${name}" ${opts.required ? 'required' : ''} placeholder="${opts.placeholder || ''}">${val}</textarea>
      <div class="error-text">Please share a short answer.</div></div>`;
  }
  return `<div class="field" data-field="${name}"><label for="f_${name}">${label}</label>
    <input id="f_${name}" type="${type}" name="${name}" value="${val}" ${opts.required ? 'required' : ''} placeholder="${opts.placeholder || ''}">
    <div class="error-text">This field is required.</div></div>`;
}

function choiceRow(name, label, options) {
  const val = state.data[name] || '';
  return `<div class="field" data-field="${name}"><label>${label}</label>
    <div class="choice-row">
      ${options.map(o => `<label class="choice ${val === o ? 'selected' : ''}">
        <input type="radio" name="${name}" value="${o}" ${val === o ? 'checked' : ''}>${o}
      </label>`).join('')}
    </div>
    <div class="error-text">Please choose one.</div>
  </div>`;
}

function stepPersonal() {
  return `
    <div class="field-row">
      ${field('first_name', 'First name', { required: true })}
      ${field('last_name', 'Last name', { required: true })}
    </div>
    ${field('email', 'Email address', { type: 'email', required: true })}
    <div class="field-row">
      ${field('phone', 'Phone number', { type: 'tel', required: true })}
      ${field('whatsapp_number', 'WhatsApp number', { type: 'tel', required: true })}
    </div>
    <div class="field-row">
      ${field('gender', 'Gender (optional)', { type: 'select', options: ['Male','Female','Prefer not to say'] })}
      ${field('date_of_birth', 'Date of birth (optional)', { type: 'date' })}
    </div>
  `;
}

function stepLocation() {
  const country = state.data.country || 'Nigeria';
  return `
    ${field('country', 'Country', { type: 'select', options: ['Nigeria','Ghana','Kenya','Other'], required: true })}
    <div id="stateWrap">
      ${country === 'Nigeria'
        ? field('state', 'State', { type: 'select', options: NG_STATES, required: true })
        : field('state', 'State / Region', { required: true })}
    </div>
    ${field('city', 'City / Local Government Area', { required: true })}
  `;
}

function stepExperience() {
  return `
    ${field('education_level', 'Highest education level', { type: 'select', required: true,
      options: ['Secondary School','OND / Diploma','HND','Bachelor\u2019s Degree','Master\u2019s Degree','Other'] })}
    ${field('employment_status', 'Current employment status', { type: 'select', required: true,
      options: ['Employed','Unemployed','Student','Self-employed'] })}
    ${choiceRow('telesales_experience', 'Previous telesales experience', ['Yes','No'])}
    ${choiceRow('sales_experience', 'Previous sales experience', ['Yes','No'])}
    ${field('experience_duration', 'Years/months of sales experience (optional)', { placeholder: 'e.g. 1 year 6 months' })}
    <div class="field-row">
      ${field('previous_company', 'Previous company (optional)')}
      ${field('previous_role', 'Previous role (optional)')}
    </div>
  `;
}

function stepAssessment() {
  return `
    ${field('reason_for_applying', 'Why do you want to work in telesales?', { type: 'textarea', required: true })}
    ${choiceRow('comfortable_with_calls', 'Comfortable making outbound calls every day?', ['Yes','No'])}
    ${choiceRow('has_smartphone', 'Do you have access to a smartphone?', ['Yes','No'])}
    ${choiceRow('has_internet', 'Do you have reliable internet access?', ['Yes','No'])}
    ${field('start_availability', 'When can you start?', { type: 'select', required: true,
      options: ['Immediately','Within 1 week','Within 2 weeks','More than 2 weeks'] })}
    ${field('preferred_work_arrangement', 'Preferred working arrangement', { type: 'select', required: true,
      options: ['Remote','On-site','Hybrid','Any'] })}
    <div class="field">
      <label>CV / Resume (optional)</label>
      <div class="file-drop ${state.cvFile ? 'has-file' : ''}" id="fileDrop">
        <input type="file" id="cvInput" accept=".pdf,.doc,.docx">
        <i data-lucide="${state.cvFile ? 'check-circle' : 'upload-cloud'}"></i>
        <span id="fileLabel">${state.cvFile ? state.cvFile.name : 'Tap to upload PDF, DOC, or DOCX (max 5MB)'}</span>
      </div>
    </div>
  `;
}

function stepReview() {
  const d = state.data;
  return `
    <div id="dupBanner"></div>
    <div class="review-block">
      <h4>Personal</h4>
      <div class="review-row"><span>Name</span><span>${d.first_name || ''} ${d.last_name || ''}</span></div>
      <div class="review-row"><span>Email</span><span>${d.email || ''}</span></div>
      <div class="review-row"><span>Phone</span><span>${d.phone || ''}</span></div>
      <div class="review-row"><span>WhatsApp</span><span>${d.whatsapp_number || ''}</span></div>
    </div>
    <div class="review-block">
      <h4>Location</h4>
      <div class="review-row"><span>Country</span><span>${d.country || ''}</span></div>
      <div class="review-row"><span>State</span><span>${d.state || ''}</span></div>
      <div class="review-row"><span>City</span><span>${d.city || ''}</span></div>
    </div>
    <div class="review-block">
      <h4>Experience</h4>
      <div class="review-row"><span>Education</span><span>${d.education_level || ''}</span></div>
      <div class="review-row"><span>Telesales experience</span><span>${d.telesales_experience || ''}</span></div>
      <div class="review-row"><span>Sales experience</span><span>${d.sales_experience || ''}</span></div>
    </div>
    <div class="review-block">
      <h4>Assessment</h4>
      <div class="review-row"><span>Start availability</span><span>${d.start_availability || ''}</span></div>
      <div class="review-row"><span>Preferred arrangement</span><span>${d.preferred_work_arrangement || ''}</span></div>
      <div class="review-row"><span>CV attached</span><span>${state.cvFile ? 'Yes' : 'No'}</span></div>
    </div>
    <p class="hint" style="margin-top:4px;">By submitting, you agree we may contact you by email and WhatsApp about this application.</p>
  `;
}

function wireStepInputs() {
  document.querySelectorAll('#formSteps input, #formSteps select, #formSteps textarea').forEach(el => {
    if (el.type === 'radio') {
      el.addEventListener('change', () => {
        state.data[el.name] = el.value;
        persist();
        document.querySelectorAll(`.choice-row input[name="${el.name}"]`).forEach(r =>
          r.closest('.choice').classList.toggle('selected', r.checked));
      });
    } else if (el.type !== 'file') {
      el.addEventListener('input', () => { state.data[el.name] = el.value; persist(); });
      if (el.name === 'country') {
        el.addEventListener('change', () => renderStep());
      }
    }
  });
  const fileInput = document.getElementById('cvInput');
  if (fileInput) {
    fileInput.addEventListener('change', () => {
      const f = fileInput.files[0];
      if (f) {
        state.cvFile = f;
        const drop = document.getElementById('fileDrop');
        drop.classList.add('has-file');
        drop.querySelector('i').setAttribute('data-lucide', 'check-circle');
        document.getElementById('fileLabel').textContent = f.name;
        refreshIcons();
      }
    });
  }
}

function validateStep() {
  let valid = true;
  document.querySelectorAll('#formSteps .field').forEach(f => f.classList.remove('invalid'));
  document.querySelectorAll('#formSteps [required]').forEach(el => {
    if (el.type === 'radio') return; // handled separately
    if (!el.value) { el.closest('.field').classList.add('invalid'); valid = false; }
  });
  // radio groups
  const radioGroups = new Set();
  document.querySelectorAll('#formSteps input[type=radio]').forEach(r => radioGroups.add(r.name));
  radioGroups.forEach(name => {
    const checked = document.querySelector(`input[name="${name}"]:checked`);
    if (!checked) {
      document.querySelector(`.field[data-field="${name}"]`)?.classList.add('invalid');
      valid = false;
    }
  });
  return valid;
}

async function goNext() {
  if (state.submitted) return;
  if (!validateStep()) return;

  if (state.step < state.totalSteps) {
    // Autosave progress ("started application") after step 1 has enough identifying info
    if (state.data.email || state.data.phone) {
      const res = await fetch('/api/apply/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ application_id: state.application_id, ...state.data })
      });
      const json = await res.json();
      state.application_id = json.application_id;
      persist();
    }
    state.step++;
    if (state.step === state.totalSteps) await checkDuplicate();
    renderStep();
    document.getElementById('drawerBody').scrollTop = 0;
  } else {
    await submitApplication();
  }
}

function goBack() {
  if (state.step > 1) { state.step--; renderStep(); }
}

async function checkDuplicate() {
  const { email, phone } = state.data;
  if (!email && !phone) return;
  const res = await fetch(`/api/apply/check-duplicate?email=${encodeURIComponent(email||'')}&phone=${encodeURIComponent(phone||'')}`);
  const json = await res.json();
  const banner = document.getElementById('dupBanner');
  if (json.duplicate && banner) {
    banner.innerHTML = `<div class="banner"><i data-lucide="alert-triangle"></i> We already have a completed application matching this email/phone (${json.application_id}). You can still submit — our team will review both.</div>`;
    refreshIcons();
  }
}

async function submitApplication() {
  const btn = document.getElementById('nextBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  const fd = new FormData();
  fd.append('application_id', state.application_id || '');
  Object.entries(state.data).forEach(([k, v]) => fd.append(k, v));
  if (state.cvFile) fd.append('cv', state.cvFile);

  try {
    const res = await fetch('/api/apply/submit', { method: 'POST', body: fd });
    const json = await res.json();
    state.application_id = json.application_id;
    state.submitted = true;
    localStorage.removeItem('app_data');
    renderConfirmation();
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Submit application';
    alert('Something went wrong submitting your application. Please try again.');
  }
}

function renderConfirmation() {
  renderStepper();
  document.querySelectorAll('#stepper i').forEach(i => i.classList.add('active'));
  document.getElementById('formSteps').innerHTML = `
    <div class="confirm-wrap">
      <div class="confirm-icon">
        <i data-lucide="check"></i>
      </div>
      <h3 style="font-size:22px; margin-bottom:8px;">Application submitted</h3>
      <p class="hero-lede" style="margin:0 auto;">Thank you for applying for the Telesales Representative position. Our recruitment team will review your application. If selected for the next stage, you'll hear from us by email and WhatsApp.</p>
      <div class="app-id-chip">${state.application_id}</div>
      <p class="hint">Save this ID to check your status anytime.</p>
    </div>
  `;
  document.getElementById('backBtn').style.display = 'none';
  document.getElementById('nextBtn').style.display = 'none';
  const foot = document.getElementById('drawerFoot');
  foot.innerHTML = `<button class="btn btn-primary btn-block" id="closeConfirm">Done</button>`;
  document.getElementById('closeConfirm').addEventListener('click', () => { closeDrawer(); location.href = '/'; });
  refreshIcons();
}

document.getElementById('backBtn').addEventListener('click', goBack);
document.getElementById('nextBtn').addEventListener('click', goNext);

refreshIcons();
loadJob();
