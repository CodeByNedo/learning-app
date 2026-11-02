let overviewWeekOffset = 0;
let historySubject = '', historyFrom = '', historyTo = '';
const currentPage = () => ['home','subjects','schedule','notes','history','settings','study'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
const totalTime = rows => rows.reduce((sum, row) => sum + row.duration_seconds, 0);
const subjectName = id => state.subjects.find(subject => subject.id === id)?.name || '';

function sessionRows(rows, editable = true) {
 return rows.map(session => `<div class="session">${subjectIcon(session.subject_id)}<span><b>${escapeHtml(subjectName(session.subject_id))}</b><small>${escapeHtml(new Date(session.started_at).toLocaleString(locale()))}</small></span><b>${duration(session.duration_seconds)}</b>${editable ? `<button class="secondary" data-edit="${session.id}">${t('Edit')}</button><button class="secondary" data-delete="${session.id}">${t('Delete')}</button>` : ''}</div>`).join('') || `<p class="muted">${t('No sessions in this period.')}</p>`;
}

function renderWorkspace() {
 const page = currentPage();
 document.querySelectorAll('[data-page]').forEach(link => {
  link.classList.toggle('selected', link.dataset.page === page);
  if(link.dataset.page === page) link.setAttribute('aria-current','page'); else link.removeAttribute('aria-current');
 });
 for (const name of ['home','subjects','schedule','notes','history','settings','study']) $('#page-'+name).hidden = page !== name;
 $('#add').hidden = page !== 'subjects';
 const titles = {home:'Your study overview',subjects:'Your subjects',history:'Session history',settings:'Settings',notes:'Notes',schedule:'Schedule',study:'Study'};
 document.querySelector('header h1').textContent = t(titles[page]);
 const studying = page === 'study';
 document.body.classList.toggle('study-mode', studying);
 document.querySelector('header').hidden = studying;
 document.querySelector('.stats').hidden = studying || page==='schedule';
 document.querySelector('.app-tabs').hidden = studying;
 document.querySelector('footer').hidden = studying;
 renderStudy();
 renderHome();
 renderHistory();
 renderSettings();
 if(page==='notes' && typeof renderGlobalNotes==='function')renderGlobalNotes();
 if(page==='schedule' && typeof renderSchedule==='function')renderSchedule();
}

function renderHome() {
 const today = new Date();today.setHours(0,0,0,0);
 const week = new Date(today);week.setDate(week.getDate()-((week.getDay()+6)%7));
 week.setDate(week.getDate()+overviewWeekOffset*7);
 const dates = Array.from({length:7},(_,index)=>{const day=new Date(week);day.setDate(day.getDate()+index);return day;});
 const weekEnd = new Date(week);weekEnd.setDate(weekEnd.getDate()+7);
 const rangeLabel = `${week.toLocaleDateString(locale(),{day:'numeric',month:'short',year:'numeric'})} – ${dates[6].toLocaleDateString(locale(),{day:'numeric',month:'short',year:'numeric'})}`;
 const totals = dates.map(day=>totalTime(state.sessions.filter(session=>dayKey(session.started_at)===dayKey(day))));
 const maxDay = Math.max(...totals,1);
 const studiedDays = totals.filter(seconds=>seconds>0).length;
 const last = state.sessions.filter(session=>session.duration_seconds>0).reduce((latest,session)=>!latest||new Date(session.started_at)>new Date(latest.started_at)?session:latest,null);
 let lastLabel = t('No study recorded yet');
 if(last){
  const lastDate = new Date(last.started_at);
  const calendarDay = Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
  const lastCalendarDay = Date.UTC(lastDate.getFullYear(),lastDate.getMonth(),lastDate.getDate());
  const days = Math.max(0,Math.round((calendarDay-lastCalendarDay)/86400000));
  lastLabel = days===0?t('Today'):days===1?t('Yesterday'):language==='sr'?`Prije ${days} dana`:`${days} days ago`;
 }
 const amounts = state.subjects.map(subject=>({subject,seconds:totalTime(state.sessions.filter(session=>session.subject_id===subject.id && new Date(session.started_at)>=week && new Date(session.started_at)<weekEnd))})).filter(item=>item.seconds>0).sort((a,b)=>b.seconds-a.seconds);
 $('#page-home').innerHTML = `<div class="home-layout overview-layout"><section class="panel activity-panel"><div class="section-title"><div><p class="eyebrow">${t('YOUR RHYTHM')}</p><h2>${t(overviewWeekOffset===0?'This week':'Study week')}</h2><p class="week-range">${rangeLabel}</p></div><span class="activity-count">${studiedDays} / 7 <span>${t('study days')}</span></span></div><div class="week-navigation"><button class="secondary" data-week-shift="-1" aria-label="${t('Previous week')}">← ${t('Previous week')}</button>${overviewWeekOffset!==0?`<button class="secondary" data-current-week>${t('This week')}</button>`:''}<button class="secondary" data-week-shift="1" ${overviewWeekOffset===0?'disabled':''} aria-label="${t('Next week')}">${t('Next week')} →</button></div><p class="chart-hint">${t('Select a day to see its details.')}</p><div class="weekly-chart" role="group" aria-label="${t('Study time by day')}">${dates.map((day,index)=>`<button type="button" data-study-day="${index}" class="chart-day ${dayKey(day)===dayKey(today)?'is-today':''}" ${day>today?'disabled':''} aria-label="${escapeHtml(day.toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'long',year:'numeric'}))}: ${duration(totals[index])}"><span class="chart-value">${duration(totals[index])}</span><span class="chart-column"><i style="height:${totals[index]?Math.max(3,totals[index]/maxDay*100):0}%"></i></span><span class="chart-label">${escapeHtml(day.toLocaleDateString(locale(),{weekday:'short'}))}</span><span class="chart-date">${day.getDate()}.${day.getMonth()+1}.</span></button>`).join('')}</div><div class="last-study"><span class="last-study-dot"></span><div><small>${t('Last study')}</small><strong>${lastLabel}</strong></div>${last?`<span class="last-study-subject">${escapeHtml(subjectName(last.subject_id))}</span>`:''}</div></section><section class="panel subject-distribution"><h2>${t(overviewWeekOffset===0?'This week by subject':'Selected week by subject')}</h2>${amounts.map(({subject,seconds})=>`<div class="distribution"><div><span class="subject-with-icon">${subjectIcon(subject.id)}<span>${escapeHtml(subject.name)}</span></span><b>${duration(seconds)}</b></div></div>`).join('')||`<div class="chart-empty"><p>${t('No study time in this week.')}</p><span>${t('Your activity will appear here after a saved session.')}</span></div>`}</section></div><section class="panel recent-panel"><div class="section-title"><h2>${t('Recent sessions')}</h2><a class="text-link" href="#history">${t('History')} →</a></div>${sessionRows(state.sessions.slice(0,3), false)}</section>`;
}

function renderHistory() {
 const rows = state.sessions.filter(session => {
  const date = new Date(session.started_at);
  const key = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  return (!historySubject || session.subject_id===Number(historySubject)) && (!historyFrom || key>=historyFrom) && (!historyTo || key<=historyTo);
 });
 $('#page-history').innerHTML = `<section class="panel"><div class="section-title"><h2>${t('History')}</h2><button data-manual ${state.subjects.some(subject=>!subject.archived)?'':'disabled'}>+ ${t('Add study session')}</button></div><div class="history-filters"><label>${t('Subject')}<select id="history-subject"><option value="">${t('All subjects')}</option>${state.subjects.map(subject=>`<option value="${subject.id}" ${historySubject===String(subject.id)?'selected':''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label><label>${t('From date')}<input id="history-from" type="date" value="${historyFrom}"></label><label>${t('To date')}<input id="history-to" type="date" value="${historyTo}"></label><div class="filter-total"><small>${t('Filtered total')}</small><strong>${duration(totalTime(rows))}</strong></div></div>${sessionRows(rows)}</section>`;
 for(const key of ['subject','from','to']) $('#history-'+key).onchange = event => {
  if(key==='subject')historySubject=event.target.value;
  if(key==='from')historyFrom=event.target.value;
  if(key==='to')historyTo=event.target.value;
  renderHistory();
 };
}

function renderSettings() {
 $('#page-settings').innerHTML = `<div class="settings-layout"><section class="panel"><h2>${t('Timer checkpoint')}</h2><p class="muted">${t('Automatically pause after the selected interval. Resume when you are ready.')}</p><form id="checkpoint-form"><label>${t('Timer checkpoint')}<input id="checkpoint" type="number" min="0" max="525600" step="1" required value="${state.settings.checkpoint_minutes}"></label><p class="muted">${t('Enter minutes. Default: 45. Use 0 to turn off automatic pauses.')}</p><label>${t('Break duration (minutes)')}<input id="break-duration" type="number" min="1" max="1440" step="1" required value="${state.settings.break_minutes}"></label><p class="muted">${t('The break counts down. Study resumes only when you choose Continue.')}</p><button>${t('Save changes')}</button></form><p class="muted">${t('Daily totals assign each session to its start date. Active sessions appear after you finish.')}</p></section><section class="panel"><h2>${t('Local data')}</h2><p class="muted">${t('Your data is stored on this computer. Download a backup before moving it.')}</p><a class="button-link" href="/api/export" download>${t('Download backup')}</a><p class="muted">${t('Download a JSON copy of your subjects, sessions and settings.')}</p><p class="muted">${t('Archive keeps all your study history.')}</p></section></div>`;
 $('#checkpoint-form').onsubmit = async event => {event.preventDefault();const input=$('#checkpoint');if(!input.reportValidity()||!$('#break-duration').reportValidity())return;try {await api('settings','PATCH',{checkpoint_minutes:Number(input.value),break_minutes:Number($('#break-duration').value)});await refresh();toast(t('Settings saved.'));}catch(error){toast(error.message);}};
}

function openManualSession() {
 const form = $('#session-form');form.reset();
 form.elements.subject_id.innerHTML = state.subjects.filter(subject=>!subject.archived).map(subject=>`<option value="${subject.id}">${escapeHtml(subject.name)}</option>`).join('');
 const date = new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());form.elements.started_at.value=date.toISOString().slice(0,16);
 $('#session-dialog').showModal();
}

document.addEventListener('click', event => {
 const button = event.target.closest('button');if(!button)return;
 if(button.dataset.weekShift){overviewWeekOffset=Math.min(0,overviewWeekOffset+Number(button.dataset.weekShift));renderHome();}
 if(button.hasAttribute('data-current-week')){overviewWeekOffset=0;renderHome();}
 if(button.hasAttribute('data-study-day'))openStudyDay(Number(button.dataset.studyDay));
 if(button.hasAttribute('data-manual'))openManualSession();
 if(button.hasAttribute('data-close-session'))$('#session-dialog').close();
});
$('#session-form').onsubmit = async event => {
 event.preventDefault();const fields = event.target.elements;
 try {
  await api('sessions','POST',{subject_id:Number(fields.subject_id.value),started_at:new Date(fields.started_at.value).toISOString(),duration_seconds:Math.round(Number(fields.minutes.value)*60)});
  $('#session-dialog').close();await refresh();toast(t('Session saved.'));
 }catch(error){toast(error.message);}
};
$('#archive-filter').onchange=()=>render();
window.addEventListener('hashchange',()=>{if(state)renderWorkspace();});

// Polling also reconciles automatic checkpoints and changes made in another tab.
setInterval(async () => {
 if(!state?.timer || document.hidden)return;
 try {
  const next = await api('state');
  const changed = JSON.stringify(next.timer)!==JSON.stringify(state.timer) && (next.timer?.segment_at!==state.timer?.segment_at || next.timer?.elapsed_seconds!==state.timer?.elapsed_seconds || next.timer?.break_until!==state.timer?.break_until || next.timer?.break_due!==state.timer?.break_due || next.timer?.checkpoint_due!==state.timer?.checkpoint_due);
  state=next;
  if(changed)render();
 }catch(error){toast(error.message);}
},5000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh().catch(error=>toast(error.message));});

let finishingStudy = false;
function renderStudy() {
 const banner = $('#study-banner');
 banner.hidden = !state.timer || currentPage() === 'study';
 banner.innerHTML = state.timer ? `<div class="study-banner-info"><span class="study-status-dot ${state.timer.segment_at===null?'paused':''}"></span><div><strong>${t(state.timer.break_until?'Break in progress':state.timer.segment_at===null?'Paused — ready to continue?':'Session in progress')}</strong><span>${escapeHtml(subjectName(state.timer.subject_id))}</span></div></div><strong id="banner-clock" class="banner-clock"></strong><a class="button-link" href="#study">${t('Return to study')} →</a>` : '';
 tick();
 const active = $('#active'), finish = $('#study-finish');
 active.hidden = !state.timer || finishingStudy;
 finish.hidden = !state.timer || !finishingStudy;
 if (!state.timer) {
  finishingStudy = false;
  if (currentPage() === 'study') {
   finish.hidden = false;
   finish.innerHTML = `<div class="focus-empty"><h2>${t('No active session. Choose a subject to start.')}</h2><a class="button-link" href="#subjects">${t('Choose a subject')}</a></div>`;
  }
  return;
 }
 const subject = state.subjects.find(item => item.id === state.timer.subject_id);
 if (!finishingStudy) {
  active.querySelectorAll('.focus-back, .focus-caption, .focus-checkpoint').forEach(element=>element.remove());
  active.insertAdjacentHTML('afterbegin', `<a class="focus-back text-link" href="#home">← ${t('Back to overview')}</a>`);
  active.insertAdjacentHTML('beforeend', `<p class="focus-caption">${t(state.timer.segment_at === null ? 'A break is part of learning. Continue when you are ready.' : 'Only active study time is counted.')}</p><p class="focus-checkpoint">${state.settings.checkpoint_minutes ? `${t('Automatic pause after')} ${state.settings.checkpoint_minutes} ${t('minutes')}` : t('Timer check is off. Remember to stop your session.')}</p>`);
  return;
 }
 const draft = $('#finish-note')?.value ?? '';
 finish.innerHTML = `<div class="finish-card"><p class="eyebrow">${t('A good step forward.')}</p><h1>${escapeHtml(subject.name)}</h1><p class="muted">${t('Time studied')}</p><strong class="finish-duration">${duration(state.timer.seconds)}</strong><p class="muted">${t('Your timer is paused while you wrap up.')}</p><form id="finish-form"><label>${t('Anything you want to note after studying?')} <span class="muted">${t('(optional)')}</span><textarea id="finish-note" maxlength="100000" rows="3" placeholder="${t('Optional. Anything you write is saved as a note for this subject.')}">${escapeHtml(draft)}</textarea></label><div class="finish-actions"><button id="finish-submit">${t('Save and go home')}</button><button type="button" class="secondary" id="keep-studying">${t('Keep studying')}</button></div></form></div>`;
 $('#keep-studying').onclick = async () => {
  try { await api('timer/resume','POST',{}); finishingStudy=false; finish.innerHTML=''; await refresh(); } catch(error){toast(error.message);}
 };
 $('#finish-form').onsubmit = async event => {
  event.preventDefault();const submit=$('#finish-submit');submit.disabled=true;
  try {
   await api('timer/finish','POST',{session_note:$('#finish-note').value});
   finishingStudy=false;finish.innerHTML='';location.hash='home';await refresh();toast(t('Session saved.'));
  } catch(error){submit.disabled=false;toast(error.message);}
 };
}
async function openStudyFinish(expected = {}) {
 await api('timer/pause','POST',{...expected,timed_break:false});
 finishingStudy=true;location.hash='study';await refresh();
}

if(state)renderWorkspace();

function openStudyDay(index) {
 if(!Number.isInteger(index)||index<0||index>6)return;
 const day = new Date();day.setHours(0,0,0,0);day.setDate(day.getDate()-((day.getDay()+6)%7)+overviewWeekOffset*7+index);
 const rows = state.sessions.filter(session=>dayKey(session.started_at)===dayKey(day));
 const amounts = state.subjects.map(subject=>({subject,seconds:totalTime(rows.filter(session=>session.subject_id===subject.id))})).filter(item=>item.seconds>0).sort((a,b)=>b.seconds-a.seconds);
 const dialog=$('#day-stats-dialog');
 const compactTime = seconds => {
  if(seconds<60)return `${seconds} ${language==='sr'?'sek':'sec'}`;
  const minutes=Math.floor(seconds/60),remaining=seconds%60;
  return `${minutes} min${remaining?` ${remaining} ${language==='sr'?'sek':'sec'}`:''}`;
 };
 const sessionCounts = id => rows.filter(session=>session.subject_id===id).length;
 dialog.innerHTML=`<div class="day-dialog-header"><div><p class="eyebrow">${t('Daily overview')}</p><h2 id="day-stats-title">${escapeHtml(day.toLocaleDateString(locale(),{weekday:'long',day:'numeric',month:'long'}))}</h2><span class="day-year">${day.getFullYear()}.</span></div><button class="secondary" id="close-day-stats">${t('Close')} ×</button></div><div class="day-summary"><div><span>${t('Total time')}</span><strong>${compactTime(totalTime(rows))}</strong></div><div><span>${t('Study sessions')}</span><strong>${rows.length}</strong></div><div><span>${t('Subjects')}</span><strong>${amounts.length}</strong></div></div><div class="day-detail-columns"><section class="day-subjects"><h3>${t('Time by subject')}</h3>${amounts.map(({subject,seconds})=>`<article class="day-subject-card">${subjectIcon(subject.id)}<div><h4>${escapeHtml(subject.name)}</h4><small>${sessionCounts(subject.id)} ${t('Study sessions').toLocaleLowerCase(locale())}</small></div><b>${compactTime(seconds)}</b></article>`).join('')||`<p class="muted">${t('No study recorded for this day.')}</p>`}</section><section class="day-sessions"><h3>${t('Session history')}</h3><div class="day-session-list">${rows.map(session=>`<article class="day-session"><time>${escapeHtml(new Date(session.started_at).toLocaleTimeString(locale(),{hour:'2-digit',minute:'2-digit'}))}</time><span class="subject-with-icon">${subjectIcon(session.subject_id)}<span>${escapeHtml(subjectName(session.subject_id))}</span></span><b>${compactTime(session.duration_seconds)}</b></article>`).join('')||`<p class="muted">${t('No sessions in this period.')}</p>`}</div></section></div><p class="muted day-stats-note">${t('Daily totals assign each session to its start date. Active sessions appear after you finish.')}</p>`;
 $('#close-day-stats').onclick=()=>dialog.close();
 dialog.showModal();
}
