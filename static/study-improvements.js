function openQuickStudy(){
 if(state?.timer){location.hash='study';return;}
 const dialog=document.createElement('dialog');dialog.className='quick-study-dialog';
 dialog.innerHTML=`<div class="section-title"><h2>${t('Choose a subject')}</h2><button type="button" class="secondary" data-close-quick>${t('Close')}</button></div><input type="search" id="quick-subject-search" placeholder="${t('Search subjects…')}" aria-label="${t('Search subjects…')}"><div id="quick-subject-results"></div>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[data-close-quick]').onclick=()=>dialog.close();
 const search=dialog.querySelector('input'),results=dialog.querySelector('#quick-subject-results');
 const draw=()=>{
  const query=search.value.trim().toLocaleLowerCase(locale());
  const recent=new Map();state.sessions.forEach(session=>{const stamp=new Date(session.started_at).getTime();recent.set(session.subject_id,Math.max(recent.get(session.subject_id)||0,stamp));});
  const subjects=state.subjects.filter(subject=>!subject.archived&&(subject.name+' '+subject.abbreviation).toLocaleLowerCase(locale()).includes(query)).sort((a,b)=>(recent.get(b.id)||0)-(recent.get(a.id)||0)||a.name.localeCompare(b.name,locale()));
  results.innerHTML=subjects.map(subject=>`<button type="button" class="quick-study-choice" data-quick-start="${subject.id}">${subjectIcon(subject.id)}<span>${escapeHtml(subject.name)}</span><strong>▶</strong></button>`).join('')||`<p class="muted">${t('No subjects found.')}</p>`;
  results.querySelectorAll('[data-quick-start]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{await api('timer/start','POST',{subject_id:Number(button.dataset.quickStart)});dialog.close();location.hash='study';await refresh();}catch(error){button.disabled=false;toast(error.message);}});
 };
 search.oninput=draw;search.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();results.querySelector('button')?.click();}};draw();dialog.showModal();search.focus();
}
$('#quick-study').onclick=openQuickStudy;
document.addEventListener('keydown',event=>{if(event.altKey&&!event.ctrlKey&&!event.metaKey&&event.code==='KeyS'&&!document.querySelector('dialog[open]')){event.preventDefault();openQuickStudy();}});
