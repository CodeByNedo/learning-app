function scheduleDateKey(day){const date=scheduleWeekDate();date.setDate(date.getDate()+day);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
function scheduleDateComments(day){return (scheduleView.comments||[]).filter(comment=>comment.comment_date===scheduleDateKey(day));}
function scheduleCommentRow(days){
 if(!Array.from({length:days},(_,day)=>scheduleDateComments(day).length).some(Boolean))return '';
 return `<div class="calendar-comment-label">${t('Comments')}</div>${Array.from({length:days},(_,day)=>`<div class="calendar-date-comments">${scheduleDateComments(day).map(comment=>`<button type="button" class="calendar-comment-card" data-edit-calendar-comment="${comment.id}" title="${escapeHtml(comment.body)}"><span class="calendar-comment-tag">▤ ${t('Comment')}</span><span class="calendar-comment-text">${escapeHtml(comment.body)}</span></button>`).join('')}</div>`).join('')}`;
}
function openCalendarComment(comment=null,selectedDate=null){
 const dialog=document.createElement('dialog');dialog.className='calendar-comment-dialog';dialog.setAttribute('aria-labelledby','calendar-comment-title');
 const today=new Date(),todayKey=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
 dialog.innerHTML=`<form><p class="eyebrow">${t('Calendar')}</p><h2 id="calendar-comment-title">${t(comment?'Edit comment':'Add comment')}</h2><label>${t('Date')}<input name="comment_date" type="date" required value="${comment?.comment_date||selectedDate||(scheduleView.weekOffset===0?todayKey:scheduleDateKey(0))}"></label><label>${t('Comment')}<textarea name="body" rows="5" maxlength="5000" required placeholder="${t('e.g. Bring the project, consultation, no classes…')}">${escapeHtml(comment?.body||'')}</textarea></label><p class="calendar-comment-error" role="alert"></p><div class="calendar-delete-confirm" hidden><strong>${t('Delete this comment?')}</strong><div class="actions"><button type="button" class="secondary" data-cancel-delete>${t('Cancel')}</button><button type="button" class="danger" data-confirm-delete>${t('Delete')}</button></div></div><div class="actions" data-comment-actions>${comment?`<button type="button" class="danger" data-delete-comment>${t('Delete')}</button>`:''}<button type="button" class="secondary" data-close-comment>${t('Cancel')}</button><button type="submit">${t('Save')}</button></div></form>`;
 document.body.append(dialog);let busy=false;
 dialog.addEventListener('close',()=>dialog.remove());dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 dialog.querySelector('[data-close-comment]').onclick=()=>dialog.close();
 const perform=async(method,payload)=>{
  if(busy)return;busy=true;dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
  try{await api('calendar-comments'+(comment?'/'+comment.id:''),method,payload);dialog.close();await renderSchedule();}
  catch(error){dialog.querySelector('[role=alert]').textContent=error.message;}
  finally{busy=false;dialog.querySelectorAll('button').forEach(button=>button.disabled=false);}
 };
 dialog.querySelector('form').onsubmit=event=>{event.preventDefault();const fields=event.target.elements;perform(comment?'PATCH':'POST',{comment_date:fields.comment_date.value,body:fields.body.value});};
 if(comment){
  const confirmation=dialog.querySelector('.calendar-delete-confirm'),actions=dialog.querySelector('[data-comment-actions]');
  dialog.querySelector('[data-delete-comment]').onclick=()=>{confirmation.hidden=false;actions.hidden=true;dialog.querySelector('[data-cancel-delete]').focus();};
  dialog.querySelector('[data-cancel-delete]').onclick=()=>{confirmation.hidden=true;actions.hidden=false;};
  dialog.querySelector('[data-confirm-delete]').onclick=()=>perform('DELETE',{confirm:true});
 }
 dialog.showModal();dialog.querySelector('textarea').focus();
}
