let state, selected = null, editingSubject = null;
const $ = s => document.querySelector(s);
const escapeHtml = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function subjectIcon(subjectId) {
 const subject=state?.subjects.find(item=>item.id===Number(subjectId));
 const initials=subject?.abbreviation || (subject?.name || '?').split(/\s+/).filter(Boolean).slice(0,2).map(word=>word[0]).join('').toUpperCase();
 const palette=[['#e6eee0','#466c4e'],['#e7edf3','#4b708e'],['#f1e9dc','#967b49'],['#eee8f2','#896699'],['#f5e4e4','#955d5d'],['#e0efed','#427d75']];
 let [background,color]=palette[Math.abs(Number(subjectId)||0)%palette.length];
 if(/^#[0-9a-f]{6}$/i.test(subject?.color || '')) {
  background=subject.color;
  const rgb=[1,3,5].map(index=>parseInt(background.slice(index,index+2),16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  color=0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2]>0.179?'#172d23':'#ffffff';
 }
 return `<i class="subject-marker subject-avatar" aria-hidden="true" style="background:${background};color:${color}">${escapeHtml(initials)}</i>`;
}
const duration = seconds => {const m=Math.floor(seconds/60);if(seconds>0&&seconds<60)return '<1 min';return m>=60?`${Math.floor(m/60)}h ${m%60}m`:`${m}m`;};
const dayKey = value => {const d=new Date(value);return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;};
function toast(text){$('#message').textContent=text;$('#message').style.display='block';setTimeout(()=>$('#message').style.display='none',4500);}
async function api(path, method='GET', data){const response=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw Error(t(result.error || 'Something went wrong.'));return result;}
async function refresh(){state=await api('state');if(state.settings.theme)applyTheme(state.settings.theme);render();}
function render(){
 const today=new Date(), week=new Date(today);week.setHours(0,0,0,0);week.setDate(week.getDate()-((week.getDay()+6)%7));
 const sum=rows=>rows.reduce((n,r)=>n+r.duration_seconds,0);
 $('#today').textContent=duration(sum(state.sessions.filter(s=>dayKey(s.started_at)===dayKey(today))));
 const weekly=sum(state.sessions.filter(s=>new Date(s.started_at)>=week));$('#week').textContent=duration(weekly);$('#average').textContent=duration(weekly/(((today.getDay()+6)%7)+1));
 const query = ($('#search').value || '').trim().toLocaleLowerCase(locale());
 const visible = filterAndSortSubjects(state.subjects, state.sessions, {
  query, archived:$('#archive-filter').value==='archived', activity:$('#activity-filter').value, sort:$('#sort').value
 }, today);
 $('#subject-count').textContent = `${visible.length} ${t('subjects')}`;
 $('#subjects').innerHTML=state.subjects.length?visible.map(subject=>{
  const sessions=state.sessions.filter(s=>s.subject_id===subject.id), total=sum(sessions), weekly=sum(sessions.filter(s=>new Date(s.started_at)>=week));
  const dates=Array.from({length:7},(_,i)=>{const d=new Date(today);d.setDate(d.getDate()-6+i);return d;});
  const amounts=dates.map(d=>sum(sessions.filter(s=>dayKey(s.started_at)===dayKey(d))));const maximum=Math.max(...amounts,1);
  let exam=t("No exam date");if(subject.exam_date){const days=Math.round((new Date(subject.exam_date+'T00:00:00')-new Date(today.getFullYear(),today.getMonth(),today.getDate()))/86400000);exam=days<0?t("Exam date passed"):days===0?t("Exam today"):language === 'sr' ? `Do ispita: ${days} ${days % 10 === 1 && days % 100 !== 11 ? 'dan' : 'dana'}` : `${days} days to exam`;}
  return `<article class="subject-row"><div class="subject-info">${subject.archived?`<input type="checkbox" class="archive-checkbox" data-select-subject="${subject.id}" aria-label="${escapeHtml(subject.name)}">`:""}${subjectIcon(subject.id)}<div><button class="subject-name" data-detail="${subject.id}">${escapeHtml(subject.name)}</button><p class="next-preview">${subject.next_step ? `${t('Continue here:')} ${escapeHtml(subject.next_step)}` : t('No next step yet.')}</p><small>${t("Last studied:")} ${sessions.length?escapeHtml(new Date(sessions[0].started_at).toLocaleDateString(locale())):t("Not yet")}</small></div></div><div class="time-column"><strong>${duration(weekly)}</strong><small>${duration(total)} ${t('total')}</small></div><div class="activity-column"><div class="bars">${amounts.map((n,i)=>`<div class="bar" style="height:${Math.max(5,n/maximum*100)}%" title="${dates[i].toLocaleDateString(locale())}: ${duration(n)}"></div>`).join('')}</div><div class="days">${dates.map(d=>`<span>${d.toLocaleDateString(locale(),{weekday:'narrow'})}</span>`).join('')}</div><small>${t('Last 7 days')}</small></div><div class="exam-column"><span class="badge">${exam}</span>${subject.exam_date?`<small>${escapeHtml(new Date(subject.exam_date+'T00:00:00').toLocaleDateString(locale()))}</small>`:''}</div><div class="row-actions">${subject.archived?`<button class="danger" data-delete-subject="${subject.id}">${t("Delete")}</button>`:`<button data-start="${subject.id}" ${state.timer?'disabled':''}>${t("Start learning")}</button>`}${subject.folder_path?`<button class="secondary" data-open-folder="${subject.id}">▱ ${t("Open folder")}</button>`:""}<button class="secondary" data-notes="${subject.id}">▤ ${t("Notes")}</button><button class="secondary" data-detail="${subject.id}">${t("Details")}</button></div></article>`;
 }).join('') || `<div class="empty">${t('No matching subjects.')}</div>` : `<div class="empty"><h2>${t("Your first session starts here.")}</h2><p class="muted">${t("Add a subject, pick a small next step, and press start.")}</p><button data-add>${t("Add your first subject")}</button></div>`;
 const active=$('#active');active.hidden=!state.timer;
 if(state.timer){const subject=state.subjects.find(s=>s.id===state.timer.subject_id);active.innerHTML=`<p class="eyebrow" style="color:#b8cfb8">${t(state.timer.break_until ? "Break in progress" : state.timer.segment_at===null ? "Paused — ready to continue?" : "CURRENT SESSION")}</p><h2>${escapeHtml(subject.name)}</h2><p class="muted">${escapeHtml(subject.next_step||t("One thing at a time. You have started."))}</p>${state.timer.break_until?`<p id="break-status" class="break-status" role="status">${t('Break ends in')}</p>`:''}<strong id="clock"></strong>${state.timer.break_until?`<p class="break-study-total">${t('Time studied')}: <strong id="study-total-time"></strong></p>`:''}<div class="actions" style="justify-content:start"><button class="secondary" data-action="${state.timer.segment_at===null?'resume':'pause'}">${state.timer.segment_at===null?t("Resume"):t("Pause")}</button>${state.timer.checkpoint_due && !state.timer.break_until?`<button class="secondary" data-action="break">${t('Take a break')}</button>`:''}<button class="secondary" data-action="finish">${t("Finish learning")}</button><button class="secondary" data-notes="${subject.id}">▤ ${t("Notes")}</button>${subject.folder_path?`<button class="secondary" data-open-folder="${subject.id}">▱ ${t("Open folder")}</button>`:""}</div>`;tick();}
 if(typeof renderArchiveTools==='function')renderArchiveTools(visible);
 renderDetail();
 if (typeof renderWorkspace === 'function') renderWorkspace();
}
function clockLabel(seconds){return `${String(Math.floor(seconds/3600)).padStart(2,'0')}:${String(Math.floor(seconds/60)%60).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function tick(){
 if(!state?.timer)return;
 const timer=state.timer;
 const elapsed=timer.elapsed_seconds+(timer.segment_at===null?0:Math.max(0,Math.floor(Date.now()/1000-timer.segment_at)));
 const studied=timer.segment_at!==null&&timer.next_checkpoint_seconds?Math.min(elapsed,timer.next_checkpoint_seconds):elapsed;
 const takingBreak=timer.break_until!==null&&timer.break_until!==undefined;
 const remaining=takingBreak?Math.max(0,Math.ceil(timer.break_until-Date.now()/1000)):null;
 const label=clockLabel(takingBreak?remaining:studied);
 for(const selector of ['#clock','#banner-clock']){const element=$(selector);if(element)element.textContent=label;}
 if($('#study-total-time'))$('#study-total-time').textContent=clockLabel(studied);
 if($('#break-status'))$('#break-status').textContent=t(remaining===0?'Break finished — continue when ready.':'Break ends in');
 if($('#active'))$('#active').classList.toggle('taking-break',takingBreak);
}

function renderDetail(){const panel=$('#detail'),subject=state.subjects.find(s=>s.id===selected);panel.hidden=!subject;if(!subject)return;panel.innerHTML=`<div class="section-title"><h2>${escapeHtml(subject.name)}</h2><button class="secondary" data-close>${t("Close")}</button></div><button class="secondary" data-edit-subject="${subject.id}">${t("Edit subject")}</button><button class="secondary" data-archive="${subject.id}">${t(subject.archived ? "Restore subject" : "Archive subject")}</button><button class="secondary" data-notes="${subject.id}">▤ ${t("Notes")}</button><section class="folder-settings"><label>${t("Subject folder")}<div class="folder-input-row"><input id="detail-folder-path" maxlength="2048" value="${escapeHtml(subject.folder_path || '')}" placeholder="C:\\…"><button type="button" class="secondary" data-pick-folder="detail-folder-path">${t("Browse")}</button></div></label><div class="folder-settings-actions"><button class="secondary" data-save-folder="${subject.id}">${t("Save path")}</button>${subject.folder_path?`<button class="secondary" data-open-folder="${subject.id}">▱ ${t("Open folder")}</button>`:''}</div></section><label>${t("Next time, start here")}<input id="next-step" maxlength="1000" placeholder="${t('e.g. Review the example from lecture 2')}" value="${escapeHtml(subject.next_step)}"></label><button data-save-note>${t("Save next step")}</button><h2>${t("Session history")}</h2><p class="muted">${t("Daily totals assign each session to its start date. Active sessions appear after you finish.")}</p>${state.sessions.filter(s=>s.subject_id===selected).map(s=>`<div class="session"><span>${escapeHtml(new Date(s.started_at).toLocaleString(locale()))}</span><b>${duration(s.duration_seconds)}</b><button class="secondary" data-edit="${s.id}">${t("Edit")}</button><button class="secondary" data-delete="${s.id}">${t("Delete")}</button></div>`).join('')||`<p class="muted">${t("No sessions yet. Start when you are ready.")}</p>`}`;}
function openSubjectForm(subject = null) {
 editingSubject = subject?.id ?? null;
 const form = $('#subject-form');
 form.reset();
 form.elements.name.value = subject?.name || '';
 form.elements.exam_date.value = subject?.exam_date || '';
 form.elements.abbreviation.value = subject?.abbreviation || '';
 form.elements.color.value = subject?.color || '#295a45';
 form.elements.folder_path.value = subject?.folder_path || '';
 $('#subject-form h2').textContent = t(subject ? 'Edit subject' : 'Add a subject');
 $('#subject-submit').textContent = t(subject ? 'Save changes' : 'Add a subject');
 $('#subject-dialog').showModal();
}
$('#add').onclick=()=>openSubjectForm();$('#cancel').onclick=()=>$('#subject-dialog').close();
$('#subject-form').onsubmit=async event=>{event.preventDefault();try{await api(editingSubject ? 'subjects/'+editingSubject : 'subjects',editingSubject ? 'PATCH' : 'POST',Object.fromEntries(new FormData(event.target)));event.target.reset();$('#subject-dialog').close();await refresh();}catch(e){toast(e.message);}};
document.addEventListener('click',async event=>{const el=event.target.closest('button');if(!el)return;try{
 if(el.hasAttribute('data-add'))openSubjectForm();
 if(el.dataset.archive){const subject=state.subjects.find(s=>s.id===Number(el.dataset.archive));await api('subjects/'+subject.id,'PATCH',{archived:subject.archived?0:1});await refresh();}
 if(el.dataset.editSubject)openSubjectForm(state.subjects.find(subject=>subject.id===Number(el.dataset.editSubject)));
 if(el.dataset.start){await api('timer/start','POST',{subject_id:Number(el.dataset.start)});location.hash='study';await refresh();}
 if(el.dataset.action==='finish'){await openStudyFinish();}
 else if(el.dataset.action){await api('timer/'+el.dataset.action,'POST',{});await refresh();}
 if(el.dataset.detail){selected=Number(el.dataset.detail);renderDetail();$('#detail').scrollIntoView({behavior:'smooth'});}
 if(el.hasAttribute('data-close')){selected=null;renderDetail();}
 if(el.hasAttribute('data-save-note')){await api('subjects/'+selected,'PATCH',{next_step:$('#next-step').value});await refresh();toast(t("Next step saved."));}
 if(el.dataset.edit)openSessionAction(Number(el.dataset.edit),'edit');
 if(el.dataset.delete)openSessionAction(Number(el.dataset.delete),'delete');
 }catch(e){toast(e.message);}});
setInterval(tick,1000);refresh().catch(e=>toast(e.message));

localizePage();
$('#language').onchange = event => {
 const draft = $('#next-step')?.value;
 language = event.target.value;
 try { localStorage.setItem('ajde.language', language);
 if(window.pywebview?.api?.set_language)window.pywebview.api.set_language(language); } catch {}
 localizePage();
 if (state) render();
 if (draft !== undefined && $('#next-step')) $('#next-step').value = draft;
};

$('#search').oninput = () => { if(state) render(); };
$('#sort').onchange = () => { if(state) render(); };

function openSessionAction(sessionId, action) {
 const session = state.sessions.find(row=>row.id===sessionId);
 if(!session){toast(t('Session not found.'));return;}
 const subject = state.subjects.find(row=>row.id===session.subject_id);
 const dialog = $('#session-action-dialog');
 const editing = action === 'edit';
 dialog.innerHTML = `<form id="session-action-form"><h2 id="session-action-title">${t(editing?'Edit study session':'Delete this session?')}</h2><p><b>${escapeHtml(subject?.name || '')}</b></p><p class="muted">${escapeHtml(new Date(session.started_at).toLocaleString(locale()))}</p>${editing?`<label>${t('Minutes studied')}<input id="session-action-minutes" type="number" min="0" max="10080" step="any" required value="${session.duration_seconds/60}"></label>`:`<p>${t('This removes the session and updates your study totals.')}</p>`}<p id="session-action-error" role="alert" style="color:#a33333"></p><div class="actions"><button type="button" class="secondary" id="session-action-cancel">${t('Cancel')}</button><button id="session-action-submit" ${editing?'':'class="danger"'}>${t(editing?'Save changes':'Delete')}</button></div></form>`;
 $('#session-action-cancel').onclick = () => dialog.close();
 $('#session-action-form').onsubmit = async event => {
  event.preventDefault();const button=$('#session-action-submit');button.disabled=true;
  try {
   if(editing){
    const minutes=Number($('#session-action-minutes').value);
    if(!Number.isFinite(minutes)||minutes<0||minutes>10080)throw Error(t('Enter a valid number of minutes.'));
    await api('sessions/'+sessionId,'PATCH',{duration_seconds:Math.round(minutes*60)});
   }else await api('sessions/'+sessionId,'DELETE');
   dialog.close();await refresh();toast(t(editing?'Session saved.':'Session deleted.'));
  }catch(error){button.disabled=false;$('#session-action-error').textContent=error.message;}
 };
 dialog.showModal();
}

document.querySelectorAll('[data-theme-choice]').forEach(button => button.onclick = async () => {
 const previous = state?.settings.theme || 'light';
 const theme = button.dataset.themeChoice;
 applyTheme(theme);
 try { await api('settings','PATCH',{theme}); if(state)state.settings.theme=theme; }
 catch(error){applyTheme(previous);toast(error.message);}
});
applyTheme(document.documentElement.dataset.theme || 'light');

function filterAndSortSubjects(subjects,sessions,options,now=new Date()) {
 const start=new Date(now);start.setHours(0,0,0,0);start.setDate(start.getDate()-((start.getDay()+6)%7));
 const end=new Date(start);end.setDate(end.getDate()+7);
 const midnight=new Date(now);midnight.setHours(0,0,0,0);
 const metrics=new Map(subjects.map(subject=>[subject.id,{week:0,total:0,last:0}]));
 for(const session of sessions){
  const data=metrics.get(session.subject_id);if(!data)continue;
  const date=new Date(session.started_at);
  data.total+=session.duration_seconds;
  if(session.duration_seconds>0){data.last=Math.max(data.last,date.getTime());if(date>=start&&date<end)data.week+=session.duration_seconds;}
 }
 const visible=subjects.filter(subject=>{
  const data=metrics.get(subject.id);
  return Boolean(subject.archived)===options.archived && subject.name.toLocaleLowerCase(locale()).includes(options.query) &&
   (options.activity!=='week'||data.week>0) && (options.activity!=='not-week'||data.week===0) && (options.activity!=='never'||data.total===0);
 });
 const exam=subject=>{const value=subject.exam_date?new Date(subject.exam_date+'T00:00:00').getTime():Infinity;return value>=midnight.getTime()?value:Infinity;};
 visible.sort((a,b)=>{
  const first=metrics.get(a.id),second=metrics.get(b.id);
  let order=0;
  if(options.sort==='most-week')order=second.week-first.week;
  if(options.sort==='most-total')order=second.total-first.total;
  if(options.sort==='least')order=first.week-second.week;
  if(options.sort==='recent')order=second.last-first.last;
  if(options.sort==='oldest')order=first.last-second.last;
  if(options.sort==='exam'){const firstExam=exam(a),secondExam=exam(b);order=firstExam===secondExam?0:firstExam<secondExam?-1:1;}
  return order||a.name.localeCompare(b.name,locale());
 });
 return visible;
}
$('#activity-filter').onchange=()=>{if(state)render();};

document.addEventListener('click',async event=>{
 const button=event.target.closest('button');if(!button)return;
 try{
  if(button.dataset.pickFolder){
   if(!window.pywebview?.api)throw Error(t('Folder access is available in the Windows app.'));
   const path=await window.pywebview.api.choose_folder();
   if(path)$('#'+button.dataset.pickFolder).value=path;
  }
  if(button.dataset.openFolder){
   if(!window.pywebview?.api)throw Error(t('Folder access is available in the Windows app.'));
   const result=await window.pywebview.api.open_subject_folder(Number(button.dataset.openFolder));
   if(result.error)throw Error(t(result.error));
  }
  if(button.dataset.saveFolder){
   const draft=$('#next-step')?.value;
   await api('subjects/'+button.dataset.saveFolder,'PATCH',{folder_path:$('#detail-folder-path').value});
   await refresh();if(draft!==undefined&&$('#next-step'))$('#next-step').value=draft;
   toast(t('Folder path saved.'));
  }
 }catch(error){toast(error.message);}
});

window.addEventListener('pywebviewready',()=>{if(window.pywebview?.api?.set_language)window.pywebview.api.set_language(language);});
