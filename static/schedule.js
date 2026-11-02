const scheduleView={id:null,schedules:[],entries:[],weekend:false,request:0};
let scheduleClockFormat='24';
try{scheduleClockFormat=localStorage.getItem('ajde.scheduleClockFormat')==='12'?'12':'24';}catch{}
function scheduleTime(minutes){
 const hour=Math.floor(minutes/60),minute=String(minutes%60).padStart(2,'0');
 return scheduleClockFormat==='12'?`${hour%12||12}:${minute} ${hour%24>=12?'PM':'AM'}`:`${String(hour).padStart(2,'0')}:${minute}`;
}
const scheduleDay=day=>new Date(2024,0,1+day).toLocaleDateString(locale(),{weekday:'long'});
function scheduleFormatControl(){return `<label class="schedule-format">${t('Time format')}<select data-schedule-format><option value="24" ${scheduleClockFormat==='24'?'selected':''}>24 h · 13:00</option><option value="12" ${scheduleClockFormat==='12'?'selected':''}>12 h · 1:00 PM</option></select></label>`;}
function scheduleTimePicker(id,minutes,allowMidnight=false){
 const twelve=scheduleClockFormat==='12',hour=Math.floor(minutes/60),minute=minutes%60;
 const part=(name,value,min,max,label,disabled=false)=>`<input type="text" id="${id}-${name}" data-schedule-time-part data-time-min="${min}" data-time-max="${max}" list="${id}-${name}-options" inputmode="numeric" maxlength="2" pattern="[0-9]{1,2}" required autocomplete="off" aria-label="${t(label)}" value="${String(value).padStart(2,'0')}" ${disabled?'disabled':''}><datalist id="${id}-${name}-options">${Array.from({length:max-min+1},(_,number)=>`<option value="${String(number+min).padStart(2,'0')}"></option>`).join('')}</datalist>`;
 return `<div class="schedule-time-picker" data-picker-id="${id}" data-clock-format="${scheduleClockFormat}" data-allow-midnight="${allowMidnight}" role="group" aria-label="${t(id==='class-start'?'Starts':'Ends')}">${part('hour',twelve?(hour%12||12):hour,twelve?1:0,twelve?12:allowMidnight?24:23,id==='class-start'?'Start hour':'End hour')}<span aria-hidden="true">:</span>${part('minute',minute,0,59,id==='class-start'?'Start minute':'End minute',!twelve&&hour===24)}${twelve?`<select data-period aria-label="AM / PM"><option ${hour%24<12?'selected':''}>AM</option><option ${hour%24>=12?'selected':''}>PM</option></select>`:''}</div>`;
}
function normalizeScheduleTimePart(input,format=false){
 const value=input.value.trim(),min=Number(input.dataset.timeMin||0),max=Number(input.dataset.timeMax);
 const valid=/^[0-9]{1,2}$/.test(value)&&Number(value)>=min&&Number(value)<=max;
 input.setCustomValidity(value&&!valid?`${min} – ${max}`:'');
 if(valid&&format)input.value=String(Number(value)).padStart(2,'0');
}
function readSchedulePicker(picker){
 const inputs=picker.querySelectorAll('input'),hour=Number(inputs[0].value),minute=Number(inputs[1].value);
 if(picker.dataset.clockFormat!=='12')return hour*60+minute;
 const result=(hour%12+(picker.querySelector('[data-period]').value==='PM'?12:0))*60+minute;
 return result===0&&picker.dataset.allowMidnight==='true'?1440:result;
}
for(const eventName of ['input','change','blur'])document.addEventListener(eventName,event=>{
 if(event.target.matches?.('[data-schedule-time-part]'))normalizeScheduleTimePart(event.target,eventName!=='input');
},true);
document.addEventListener('change',event=>{
 if(!event.target.matches?.('[data-schedule-format]'))return;
 const invalid=[...document.querySelectorAll('.schedule-time-picker input')].find(input=>!input.disabled&&!input.checkValidity());
 if(invalid){event.target.value=scheduleClockFormat;invalid.reportValidity();return;}
 const pickers=[...document.querySelectorAll('.schedule-time-picker')].map(picker=>({picker,minutes:readSchedulePicker(picker),fields:[...picker.querySelectorAll('input')].map(input=>input.getAttribute('data-time'))}));
 scheduleClockFormat=event.target.value;try{localStorage.setItem('ajde.scheduleClockFormat',scheduleClockFormat);}catch{}
 for(const {picker,minutes,fields} of pickers){
  const template=document.createElement('template');template.innerHTML=scheduleTimePicker(picker.dataset.pickerId,minutes,picker.dataset.allowMidnight==='true');
  const replacement=template.content.firstElementChild;replacement.querySelectorAll('input').forEach((input,index)=>{if(fields[index])input.setAttribute('data-time',fields[index]);});picker.replaceWith(replacement);
 }
 document.querySelectorAll('[data-schedule-format]').forEach(select=>select.value=scheduleClockFormat);
 if(scheduleView.schedules.length)paintSchedule();
});
document.addEventListener('input',event=>{
 const picker=event.target.closest?.('.schedule-time-picker');if(!picker||picker.dataset.clockFormat!=='24'||picker.dataset.allowMidnight!=='true')return;
 const inputs=picker.querySelectorAll('input');if(event.target!==inputs[0])return;
 inputs[1].disabled=Number(inputs[0].value)===24;if(inputs[1].disabled)inputs[1].value='00';
});
function readScheduleTime(id){return readSchedulePicker($('#'+id+'-hour').closest('.schedule-time-picker'));}

// Assign lanes within each connected overlap group. Touching intervals share a lane.
function layoutScheduleEntries(entries){
 const sorted=[...entries].sort((a,b)=>a.start_minute-b.start_minute||a.end_minute-b.end_minute||a.id-b.id);
 const result=[];let group=[],groupEnd=-1;
 function flush(){
  const lanes=[];const placed=group.map(entry=>{
   let lane=lanes.findIndex(end=>end<=entry.start_minute);if(lane<0)lane=lanes.length;
   lanes[lane]=entry.end_minute;return {...entry,lane};
  });
  result.push(...placed.map(entry=>({...entry,lanes:lanes.length,overlap:group.some(other=>other.id!==entry.id&&other.start_minute<entry.end_minute&&other.end_minute>entry.start_minute)})));
  group=[];groupEnd=-1;
 }
 for(const entry of sorted){if(group.length&&entry.start_minute>=groupEnd)flush();group.push(entry);groupEnd=Math.max(groupEnd,entry.end_minute);}
 flush();return result;
}

async function renderSchedule(){
 const request=++scheduleView.request;
 try{
  const result=await api('schedules');if(request!==scheduleView.request)return;
  scheduleView.schedules=result.schedules;
  if(!result.schedules.some(item=>item.id===scheduleView.id))scheduleView.id=(result.schedules.find(item=>item.is_active)||result.schedules[0])?.id||null;
  if(scheduleView.id){const detail=await api('schedules/'+scheduleView.id);if(request!==scheduleView.request)return;scheduleView.entries=detail.entries;}
  else scheduleView.entries=[];
  paintSchedule();
 }catch(error){toast(error.message);}
}

function scheduleEventTextColor(color){
 const channels=color.slice(1).match(/../g).map(value=>{const channel=parseInt(value,16)/255;return channel<=0.04045?channel/12.92:((channel+0.055)/1.055)**2.4;});
 const luminance=channels[0]*0.2126+channels[1]*0.7152+channels[2]*0.0722;
 return (luminance+0.05)/0.05>=1.05/(luminance+0.05)?'#000000':'#ffffff';
}

function scheduleTodaySummary(entries,day){
 const classes=entries.filter(entry=>entry.weekday===day).sort((a,b)=>a.start_minute-b.start_minute||a.end_minute-b.end_minute);
 return `<section class="schedule-today" aria-label="${t("Today's classes")}"><div class="schedule-today-label"><div><strong>${t('Today')}</strong><span>${escapeHtml(scheduleDay(day))}</span></div>${classes.length?`<span class="schedule-today-count">${t('Classes')}: ${classes.length}</span>`:''}</div><div class="schedule-today-classes" role="list">${classes.length?classes.map(entry=>{
  const subject=state.subjects.find(item=>item.id===entry.subject_id),color=/^#[0-9a-f]{6}$/i.test(subject?.color||'')?subject.color:'#6b9679';
  const kind=t(entry.kind==='lecture'?'Lecture':'Exercise');
  return `<div class="schedule-today-class" role="listitem" style="--event-color:${color}"><span class="schedule-today-time">${scheduleTime(entry.start_minute)}–${scheduleTime(entry.end_minute)}</span><span class="schedule-today-name">${escapeHtml(subject?.name||t('Subject'))}</span><span class="schedule-today-meta"><abbr title="${kind}">${t(entry.kind==='lecture'?'Lecture short':'Exercise short')}</abbr>${entry.room?`<span> · ${escapeHtml(entry.room)}</span>`:''}</span></div>`;
 }).join(''):`<p>${t('No classes today.')}</p>`}</div></section>`;
}

document.addEventListener('click',event=>{
 const more=document.querySelector('.schedule-more[open]');if(more&&!more.contains(event.target))more.open=false;
});

function paintSchedule(){
 const current=scheduleView.schedules.find(item=>item.id===scheduleView.id);
 if(!current){$('#page-schedule').innerHTML=`<section class="panel schedule-empty"><p class="eyebrow">${t('YOUR WEEK')}</p><h2>${t('A clear view of your week.')}</h2><p class="muted">${t('Create a schedule, then add classes for your subjects.')}</p><button id="first-schedule">+ ${t('Create schedule')}</button></section>`;$('#first-schedule').onclick=()=>editScheduleName();return;}
 const entries=scheduleView.entries;
 const showWeekend=scheduleView.weekend||entries.some(entry=>entry.weekday>=5);
 const days=showWeekend?7:5;
 const start=Math.min(420,...entries.map(entry=>Math.floor(entry.start_minute/60)*60));
 const end=Math.max(1200,...entries.map(entry=>Math.ceil(entry.end_minute/60)*60));
 const scale=64/60,height=(end-start)*scale;
 const today=(new Date().getDay()+6)%7;
 const hours=Array.from({length:(end-start)/60+1},(_,i)=>start+i*60);
 $('#page-schedule').innerHTML=`<section class="schedule-toolbar panel"><div class="schedule-choice"><label for="schedule-choice">${t('Schedule')}</label><select id="schedule-choice">${scheduleView.schedules.map(item=>`<option value="${item.id}" ${item.id===current.id?'selected':''}>${escapeHtml(item.name)}${item.is_active?' · '+t('Default'):''}</option>`).join('')}</select></div>${scheduleFormatControl()}<div class="schedule-toolbar-actions"><button class="secondary" id="new-schedule">+ ${t('New schedule')}</button><button id="add-class" ${state.subjects.some(subject=>!subject.archived)?'':'disabled'}>+ ${t('Add class')}</button><details class="schedule-more"><summary aria-label="${t('Schedule options')}" title="${t('Schedule options')}">⋯</summary><div class="schedule-more-menu"><button class="secondary" id="rename-schedule">${t('Rename')}</button><button class="secondary" id="default-schedule" ${current.is_active?'disabled':''}>${t(current.is_active?'Default schedule':'Set as default')}</button><button class="secondary" id="delete-schedule">${t('Delete')}</button></div></details></div></section>${scheduleTodaySummary(entries,today)}<div class="schedule-caption"><label><input type="checkbox" id="schedule-weekend" ${showWeekend?'checked':''} ${entries.some(entry=>entry.weekday>=5)?'disabled':''}>${t('Show weekend')}</label></div><div class="schedule-scroll"><div class="schedule-week" style="--schedule-days:${days}"><div class="schedule-corner">${t('Time')}</div>${Array.from({length:days},(_,day)=>`<div class="schedule-day-header ${day===today?'today':''}"><span>${escapeHtml(scheduleDay(day))}</span><button data-day-add="${day}" aria-label="${t('Add class')} · ${escapeHtml(scheduleDay(day))}">+</button></div>`).join('')}<div class="schedule-hours" style="height:${height}px">${hours.map(minute=>`<span style="top:${(minute-start)*scale}px">${scheduleTime(minute)}</span>`).join('')}</div>${Array.from({length:days},(_,day)=>`<div class="schedule-day ${day===today?'today':''}" data-schedule-day="${day}" role="group" tabindex="0" aria-label="${escapeHtml(scheduleDay(day))}" style="height:${height}px">${hours.slice(0,-1).map(minute=>`<div class="schedule-hour-rule" style="top:${(minute-start)*scale}px"></div>`).join('')}${layoutScheduleEntries(entries.filter(entry=>entry.weekday===day)).map(entry=>{
  const subject=state.subjects.find(subject=>subject.id===entry.subject_id);
  const title=subject?.name||t('Subject');
  const kind=t(entry.kind==='lecture'?'Lecture':'Exercise');
  const length=entry.end_minute-entry.start_minute;
  const color=/^#[0-9a-f]{6}$/i.test(subject?.color||'')?subject.color:'#6b9679';
  const description=`${title} · ${kind} · ${scheduleTime(entry.start_minute)}–${scheduleTime(entry.end_minute)}${entry.room?' · '+entry.room:''}${entry.overlap?' · '+t('Overlapping classes'):''}`;
  return `<button class="schedule-event ${entry.kind} ${length<45?'compact':length<120?'dense':''}" data-class-id="${entry.id}" title="${escapeHtml(description)}" aria-label="${escapeHtml(description)}" style="--event-color:${color};--event-text:${scheduleEventTextColor(color)};top:${(entry.start_minute-start)*scale}px;height:${Math.max(16,length*scale-3)}px;left:calc(${entry.lane/entry.lanes*100}% + 3px);width:calc(${100/entry.lanes}% - 6px)"><span class="schedule-event-heading"><span class="schedule-type-badge" title="${kind}">${t(entry.kind==='lecture'?'Lecture short':'Exercise short')}</span></span><span class="schedule-event-title">${subject?.abbreviation?`<span class="schedule-subject-code">${escapeHtml(subject.abbreviation)}</span> `:''}${escapeHtml(title)}</span><span class="schedule-event-time">${scheduleTime(entry.start_minute)}–${scheduleTime(entry.end_minute)}</span>${length>=45?`${entry.overlap?`<span class="schedule-event-kind">⚑ ${t('Overlapping classes')}</span>`:''}${entry.room?`<span class="schedule-event-room">${escapeHtml(entry.room)}</span>`:''}`:''}</button>`;
 }).join('')}<div class="schedule-now" data-now-day="${day}" hidden><span></span></div></div>`).join('')}</div></div><div class="schedule-legend"><span><i class="lecture"></i>${t('Lecture')}</span><span><i class="exercise"></i>${t('Exercise')}</span></div>`;
 $('#schedule-choice').onchange=event=>{scheduleView.id=Number(event.target.value);renderSchedule();};
 const more=$('.schedule-more');
 more.onkeydown=event=>{if(event.key==='Escape'){more.open=false;more.querySelector('summary').focus();}};
 more.querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>more.open=false));
 $('#new-schedule').onclick=()=>editScheduleName();
 $('#rename-schedule').onclick=()=>editScheduleName(current);
 $('#default-schedule').onclick=async()=>{try{await api('schedules/'+current.id,'PATCH',{is_active:true});await renderSchedule();}catch(error){toast(error.message);}};
 $('#delete-schedule').onclick=()=>confirmScheduleDelete('schedule',current.id,current.name);
 $('#add-class').onclick=()=>editScheduleClass();
 $('#schedule-weekend').onchange=event=>{scheduleView.weekend=event.target.checked;paintSchedule();};
 document.querySelectorAll('[data-day-add]').forEach(button=>button.onclick=()=>editScheduleClass(null,Number(button.dataset.dayAdd)));
 document.querySelectorAll('[data-class-id]').forEach(button=>button.onclick=event=>{event.stopPropagation();editScheduleClass(entries.find(entry=>entry.id===Number(button.dataset.classId)));});
 document.querySelectorAll('[data-schedule-day]').forEach(column=>{
  column.onclick=event=>{if(event.target.closest('[data-class-id]'))return;const minute=Math.max(start,Math.min(end-15,start+Math.floor((event.clientY-column.getBoundingClientRect().top)/scale/15)*15));editScheduleClass(null,Number(column.dataset.scheduleDay),minute);};
  column.onkeydown=event=>{if(event.target===column&&(event.key==='Enter'||event.key===' ')){event.preventDefault();editScheduleClass(null,Number(column.dataset.scheduleDay));}};
 });
 scheduleView.start=start;scheduleView.end=end;updateScheduleNow();
}

function updateScheduleNow(){
 const date=new Date(),day=(date.getDay()+6)%7,minute=date.getHours()*60+date.getMinutes();
 document.querySelectorAll('[data-now-day]').forEach(line=>{line.hidden=Number(line.dataset.nowDay)!==day||minute<scheduleView.start||minute>scheduleView.end;if(!line.hidden)line.style.top=((minute-scheduleView.start)*64/60)+'px';});
}

function editScheduleName(schedule=null){
 if(!schedule){openScheduleBuilder();return;}
 const dialog=$('#schedule-dialog');
 dialog.innerHTML=`<form id="schedule-name-form"><h2 id="schedule-dialog-title">${t(schedule?'Rename schedule':'New schedule')}</h2><label>${t('Schedule name')}<input id="schedule-name" maxlength="100" required value="${escapeHtml(schedule?.name||'')}" placeholder="${t('e.g. My weekly schedule')}"></label><p class="schedule-error" id="schedule-error" role="alert"></p><div class="actions"><button type="button" class="secondary" id="cancel-schedule">${t('Cancel')}</button><button>${t('Save')}</button></div></form>`;
 $('#cancel-schedule').onclick=()=>dialog.close();
 $('#schedule-name-form').onsubmit=async event=>{event.preventDefault();try{const result=await api('schedules'+(schedule?'/'+schedule.id:''),schedule?'PATCH':'POST',{name:$('#schedule-name').value});if(!schedule)scheduleView.id=result.schedule.id;dialog.close();await renderSchedule();}catch(error){$('#schedule-error').textContent=error.message;}};
 dialog.showModal();
}

function editScheduleClass(entry=null,day=(new Date().getDay()+6)%7,minute=540){
 const subjects=state.subjects.filter(subject=>!subject.archived||subject.id===entry?.subject_id);
 if(!subjects.length){toast(t('Add a subject first.'));return;}
 const dialog=$('#schedule-dialog');
 dialog.innerHTML=`<form id="schedule-entry-form">${scheduleFormatControl()}<h2 id="schedule-dialog-title">${t(entry?'Edit class':'Add class')}</h2><label>${t('Subject')}<select id="class-subject" required>${subjects.map(subject=>`<option value="${subject.id}" ${entry?.subject_id===subject.id?'selected':''}>${escapeHtml(subject.name)}</option>`).join('')}</select></label><div class="schedule-form-pair"><label>${t('Class type')}<select id="class-kind"><option value="lecture" ${entry?.kind==='lecture'?'selected':''}>${t('Lecture')}</option><option value="exercise" ${entry?.kind==='exercise'?'selected':''}>${t('Exercise')}</option></select></label><label>${t('Day')}<select id="class-day">${Array.from({length:7},(_,index)=>`<option value="${index}" ${(entry?.weekday??day)===index?'selected':''}>${escapeHtml(scheduleDay(index))}</option>`).join('')}</select></label></div><div class="schedule-form-pair"><label>${t('Starts')}${scheduleTimePicker('class-start',entry?.start_minute??minute)}</label><label>${t('Ends')}${scheduleTimePicker('class-end',entry?.end_minute??Math.min(1440,minute+60),true)}</label></div><label>${t('Room')} <span class="muted">${t('(optional)')}</span><input id="class-room" maxlength="100" value="${escapeHtml(entry?.room||'')}" placeholder="${t('e.g. Room 204')}"></label><p class="schedule-error" id="schedule-error" role="alert"></p><div class="actions">${entry?`<button type="button" class="danger" id="remove-class">${t('Delete')}</button>`:''}<button type="button" class="secondary" id="cancel-schedule">${t('Cancel')}</button><button id="save-class">${t('Save')}</button></div></form>`;
 $('#cancel-schedule').onclick=()=>dialog.close();
 if(entry)$('#remove-class').onclick=()=>confirmScheduleDelete('entry',entry.id,subjectName(entry.subject_id));
 $('#schedule-entry-form').onsubmit=async event=>{
  event.preventDefault();const button=$('#save-class');button.disabled=true;
  try{
   const start=readScheduleTime('class-start'),end=readScheduleTime('class-end');
   await api(`schedules/${scheduleView.id}/entries${entry?'/'+entry.id:''}`,entry?'PATCH':'POST',{subject_id:Number($('#class-subject').value),weekday:Number($('#class-day').value),kind:$('#class-kind').value,start_minute:start,end_minute:end,room:$('#class-room').value});
   dialog.close();await renderSchedule();
  }catch(error){button.disabled=false;$('#schedule-error').textContent=error.message;}
 };
 dialog.showModal();
}

function confirmScheduleDelete(kind,id,name){
 const dialog=$('#schedule-confirm-dialog');
 dialog.innerHTML=`<form id="schedule-delete-form"><h2 id="schedule-confirm-title">${t(kind==='schedule'?'Delete this schedule and all its classes?':'Delete this class?')}</h2><p>${escapeHtml(name)}</p><p class="schedule-error" id="schedule-delete-error" role="alert"></p><div class="actions"><button type="button" class="secondary" id="cancel-schedule-delete">${t('Cancel')}</button><button class="danger" id="confirm-schedule-delete">${t('Delete')}</button></div></form>`;
 $('#cancel-schedule-delete').onclick=()=>dialog.close();
 $('#schedule-delete-form').onsubmit=async event=>{
  event.preventDefault();$('#confirm-schedule-delete').disabled=true;
  try{await api(kind==='schedule'?'schedules/'+id:`schedules/${scheduleView.id}/entries/${id}`,'DELETE',{confirm:true});dialog.close();if($('#schedule-dialog').open)$('#schedule-dialog').close();await renderSchedule();}
  catch(error){$('#confirm-schedule-delete').disabled=false;$('#schedule-delete-error').textContent=error.message;}
 };
 dialog.showModal();
}
setInterval(updateScheduleNow,30000);
if(state&&currentPage()==='schedule')renderSchedule();
