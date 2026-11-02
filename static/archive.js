const archivedSelection = new Set();
let visibleArchivedIds = [];

function renderArchiveTools(visible) {
 const tools=$('#archive-tools');
 tools.hidden=$('#archive-filter').value!=='archived';
 visibleArchivedIds=visible.filter(subject=>subject.archived).map(subject=>subject.id);
 for(const id of archivedSelection)if(!visibleArchivedIds.includes(id))archivedSelection.delete(id);
 const all=visibleArchivedIds.length>0 && visibleArchivedIds.every(id=>archivedSelection.has(id));
 tools.innerHTML=`<label><input type="checkbox" id="select-all-archived" ${all?'checked':''} ${visibleArchivedIds.length?'':'disabled'}>${t('Select visible subjects')}</label><span>${archivedSelection.size} / ${visibleArchivedIds.length}</span><button class="secondary" data-clear-archive ${archivedSelection.size?'':'disabled'}>${t('Clear selection')}</button><button class="danger" data-delete-archive-selection ${archivedSelection.size?'':'disabled'}>${t('Delete selected')} (${archivedSelection.size})</button>`;
 const selectAll=$('#select-all-archived');
 selectAll.indeterminate=archivedSelection.size>0&&!all;
 document.querySelectorAll('[data-select-subject]').forEach(input=>input.checked=archivedSelection.has(Number(input.dataset.selectSubject)));
}

function confirmDeleteSubjects(ids) {
 const subjects=state.subjects.filter(subject=>ids.includes(subject.id)&&subject.archived);
 if(!subjects.length)return;
 const dialog=$('#delete-subjects-dialog');
 dialog.innerHTML=`<form id="delete-subjects-form"><h2 id="delete-subjects-title">${t('Delete archived subjects?')}</h2><p class="muted">${t('This permanently deletes the selected subjects, notes and all their study sessions. This cannot be undone.')}</p><ul class="delete-subject-list">${subjects.map(subject=>`<li>${escapeHtml(subject.name)}</li>`).join('')}</ul><p role="alert" id="delete-subjects-error"></p><div class="actions"><button type="button" class="secondary" id="cancel-delete-subjects">${t('Cancel')}</button><button class="danger" id="confirm-delete-subjects">${t('Delete')} (${subjects.length})</button></div></form>`;
 $('#cancel-delete-subjects').onclick=()=>dialog.close();
 $('#delete-subjects-form').onsubmit=async event=>{
  event.preventDefault();const button=$('#confirm-delete-subjects');button.disabled=true;
  try {
   await api('subjects/delete','POST',{ids:subjects.map(subject=>subject.id)});
   subjects.forEach(subject=>archivedSelection.delete(subject.id));
   if(subjects.some(subject=>subject.id===selected))selected=null;
   dialog.close();await refresh();toast(t('Subjects deleted.'));
  }catch(error){button.disabled=false;$('#delete-subjects-error').textContent=error.message;}
 };
 dialog.showModal();
}

document.addEventListener('change',event=>{
 const input=event.target;
 if(input.matches('[data-select-subject]')){
  const id=Number(input.dataset.selectSubject);
  if(input.checked)archivedSelection.add(id);else archivedSelection.delete(id);
  renderArchiveTools(state.subjects.filter(subject=>visibleArchivedIds.includes(subject.id)));
 }
 if(input.id==='select-all-archived'){
  for(const id of visibleArchivedIds)if(input.checked)archivedSelection.add(id);else archivedSelection.delete(id);
  renderArchiveTools(state.subjects.filter(subject=>visibleArchivedIds.includes(subject.id)));
 }
});
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.deleteSubject)confirmDeleteSubjects([Number(button.dataset.deleteSubject)]);
 if(button.hasAttribute('data-delete-archive-selection'))confirmDeleteSubjects([...archivedSelection]);
 if(button.hasAttribute('data-clear-archive')){archivedSelection.clear();render();}
});
if(state)render();
