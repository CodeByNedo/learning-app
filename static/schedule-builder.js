let scheduleBuilderId=0;

function builderRowValues(row){
 return {subject_id:Number(row.querySelector('[data-field=subject]').value),weekday:Number(row.querySelector('[data-field=day]').value),kind:row.querySelector('[data-field=kind]').value,
  start_minute:readSchedulePicker(row.querySelectorAll('.schedule-time-picker')[0]),
  end_minute:readSchedulePicker(row.querySelectorAll('.schedule-time-picker')[1]),room:row.querySelector('[data-field=room]').value};
}

function addScheduleBuilderRow(values={}){
 const host=$('#schedule-builder-rows');if(host.children.length>=250){toast(t('Use up to 250 classes per schedule.'));return;}
 const id=++scheduleBuilderId;
 const row=document.createElement('div');row.className='schedule-builder-row';
 const subjects=state.subjects.filter(subject=>!subject.archived);
 const picker=(kind,minutes,midnight=false)=>{
  let html=scheduleTimePicker('builder-'+id+'-'+kind,minutes,midnight);
  html=html.replace(`id="builder-${id}-${kind}-hour"`,`id="builder-${id}-${kind}-hour" data-time="${kind}-hour"`).replace(`id="builder-${id}-${kind}-minute"`,`id="builder-${id}-${kind}-minute" data-time="${kind}-minute"`);
  if(kind==='start')html=html.replace(`aria-label="${t('Ends')}"`,`aria-label="${t('Starts')}"`).replace(`aria-label="${t('End hour')}"`,`aria-label="${t('Start hour')}"`).replace(`aria-label="${t('End minute')}"`,`aria-label="${t('Start minute')}"`);
  return html;
 };
 row.innerHTML=`<label><span>${t('Subject')}</span><select data-field="subject" required aria-label="${t('Subject')}"><option value="">${t('Choose a subject')}</option>${subjects.map(subject=>`<option value="${subject.id}" ${values.subject_id===subject.id?'selected':''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label><label><span>${t('Day')}</span><select data-field="day" aria-label="${t('Day')}">${Array.from({length:7},(_,day)=>`<option value="${day}" ${(values.weekday??0)===day?'selected':''}>${escapeHtml(scheduleDay(day))}</option>`).join('')}</select></label><label><span>${t('Class type')}</span><select data-field="kind" aria-label="${t('Class type')}"><option value="lecture" ${values.kind!=='exercise'?'selected':''}>${t('Lecture')}</option><option value="exercise" ${values.kind==='exercise'?'selected':''}>${t('Exercise')}</option></select></label><label><span>${t('Starts')}</span>${picker('start',values.start_minute??540)}</label><label><span>${t('Ends')}</span>${picker('end',values.end_minute??600,true)}</label><label><span>${t('Room')}</span><input data-field="room" maxlength="100" placeholder="${t('(optional)')}" aria-label="${t('Room')}" value="${escapeHtml(values.room||'')}"></label><div class="builder-row-actions"><button type="button" class="secondary" data-copy-row title="${t('Copy row')}" aria-label="${t('Copy row')}">⧉</button><button type="button" class="secondary" data-remove-row title="${t('Remove row')}" aria-label="${t('Remove row')}">×</button></div>`;
 row.querySelector('[data-copy-row]').onclick=()=>{addScheduleBuilderRow(builderRowValues(row));host.lastElementChild.scrollIntoView({block:'nearest',behavior:'smooth'});};
 row.querySelector('[data-remove-row]').onclick=()=>{row.remove();updateBuilderSummary();};
 row.oninput=updateBuilderSummary;row.onchange=updateBuilderSummary;
 host.append(row);updateBuilderSummary();
}

function updateBuilderSummary(){
 const rows=[...document.querySelectorAll('.schedule-builder-row')];
 const entries=rows.map(builderRowValues);
 const subjects=new Set(entries.map(entry=>entry.subject_id).filter(Boolean));
 $('#schedule-builder-count').textContent=`${rows.length} ${t('classes')} · ${subjects.size} ${t('subjects')}`;
 rows.forEach((row,index)=>row.classList.toggle('builder-invalid',entries[index].end_minute<=entries[index].start_minute));
}

function openScheduleBuilder(){
 const dialog=$('#schedule-builder');
 dialog.innerHTML=`<form id="schedule-builder-form"><div class="schedule-builder-header"><div><p class="eyebrow">${t('YOUR WEEK')}</p><h2 id="schedule-builder-title">${t('Build your schedule')}</h2><p class="muted">${t('Add all your classes here, then create the schedule in one step.')}</p></div><button type="button" class="secondary" id="close-schedule-builder">${t('Cancel')}</button></div><div class="schedule-builder-name"><label>${t('Schedule name')}<input id="schedule-builder-name" required maxlength="100" placeholder="${t('e.g. My weekly schedule')}"></label><span id="schedule-builder-count"></span></div>${scheduleFormatControl()}<div class="schedule-builder-table"><div id="schedule-builder-rows"></div></div><button type="button" class="secondary" id="builder-add-row">+ ${t('Add another class')}</button><p id="schedule-builder-error" class="schedule-error" role="alert"></p><div class="schedule-builder-footer"><span class="muted">${t('You can add or change individual classes later in the calendar.')}</span><button id="create-schedule-with-classes">${t('Create schedule')}</button></div></form>`;
 $('#close-schedule-builder').onclick=()=>dialog.close();
 $('#builder-add-row').onclick=()=>{addScheduleBuilderRow();$('#schedule-builder-rows').lastElementChild?.scrollIntoView({block:'nearest',behavior:'smooth'});};
 if(state.subjects.some(subject=>!subject.archived))addScheduleBuilderRow();else updateBuilderSummary();
 $('#builder-add-row').disabled=!state.subjects.some(subject=>!subject.archived);
 $('#schedule-builder-form').onsubmit=async event=>{
  event.preventDefault();if($('#create-schedule-with-classes').disabled)return;const rows=[...document.querySelectorAll('.schedule-builder-row')],entries=rows.map(builderRowValues);
  const invalid=entries.findIndex(entry=>entry.end_minute<=entry.start_minute);
  if(invalid>=0){$('#schedule-builder-error').textContent=t('Choose a day and an end time later than the start time.');rows[invalid].scrollIntoView({block:'center',behavior:'smooth'});return;}
  const button=$('#create-schedule-with-classes');button.disabled=true;
  try{const result=await api('schedules','POST',{name:$('#schedule-builder-name').value,entries});scheduleView.id=result.schedule.id;dialog.close();await renderSchedule();}
  catch(error){button.disabled=false;$('#schedule-builder-error').textContent=error.message;}
 };
 dialog.showModal();
}
