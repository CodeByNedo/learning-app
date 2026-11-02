const notebook = {folder:'',subjectId:null, note:null, page:1, pages:1, query:'', request:0, selectionRequest:0, saving:false};
const noteDate = value => new Date(value).toLocaleString(locale(), {day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});

function noteDirty() {
 const title=$('#note-title-input'),body=$('#note-body');
 return Boolean(title && body && (title.value!==(notebook.note?.title || '') || body.value!==(notebook.note?.body || '') || ($('#note-folder-select')?.value || '')!==String(notebook.originalFolder ?? '')));
}

function allowNoteNavigation() {
 if(notebook.saving || noteDirty()){toast(t('Save or discard your changes first.'));return false;}
 return true;
}

async function openNotes(subjectId, folderId = '') {
 const dialog=$('#notes-dialog');
 if(dialog.open && !allowNoteNavigation())return;
 const subject=state.subjects.find(item=>item.id===subjectId);if(subjectId && !subject)return;
 await fetchNoteFolders();
 notebook.subjectId=subjectId;notebook.note=null;notebook.page=1;notebook.query='';notebook.folder=String(folderId || '');notebook.selectionRequest++;
 dialog.innerHTML=`<div class="notebook-header"><div class="subject-with-icon">${subject?subjectIcon(subjectId):'<i class="subject-marker" aria-hidden="true">▱</i>'}<div><p class="eyebrow">${t('Notes')}</p><h2 id="notes-title">${escapeHtml(subject?.name || noteFolderPath(folderId) || t('Notes'))}</h2></div></div><button class="secondary" id="close-notes">${t('Close')} ×</button></div><div class="notebook-layout"><aside class="notebook-sidebar"><button id="new-note">+ ${t('New note')}</button><div class="notebook-folder-tools"><select id="notebook-folder-filter" aria-label="${t('Folder')}"><option value="">${t('All folders')}</option>${folderOptions(notebook.folder)}</select><button class="secondary" id="notebook-new-folder" aria-label="${t('New folder')}">+</button></div><form id="note-search-form"><input id="note-search" type="search" maxlength="200" placeholder="${t('Search titles and text')}" aria-label="${t('Search titles and text')}"><button class="secondary">${t('Search')}</button></form><div id="notes-list" aria-live="polite"></div><div id="notes-pagination"></div></aside><section id="note-editor"><div class="note-empty"><h3>${t('Select a note or create a new one.')}</h3><p>${t('Start with a title and a few lines.')}</p></div></section></div>`;
 $('#close-notes').onclick=()=>{if(allowNoteNavigation())dialog.close();};
 dialog.oncancel=event=>{if(!allowNoteNavigation())event.preventDefault();};
 $('#new-note').onclick=()=>{if(!allowNoteNavigation())return;notebook.selectionRequest++;notebook.note=null;renderNoteEditor();$('#note-title-input').focus();};
 $('#notebook-folder-filter').onchange=event=>{if(!allowNoteNavigation()){event.target.value=notebook.folder;return;}notebook.folder=event.target.value;notebook.page=1;loadNotes();};
 $('#notebook-new-folder').onclick=()=>openNoteFolderDialog(null,notebook.folder?Number(notebook.folder):null);
 $('#note-search-form').onsubmit=event=>{event.preventDefault();notebook.query=$('#note-search').value;notebook.page=1;loadNotes();};
 $('#note-search').oninput=event=>{if(!event.target.value){notebook.query='';notebook.page=1;loadNotes();}};
 if(!dialog.open)dialog.showModal();
 await loadNotes();
}

async function loadNotes() {
 const request=++notebook.request;
 $('#notes-list').innerHTML=`<p class="muted">${t('Loading…')}</p>`;
 try {
  const result=await api(`notes?subject_id=${notebook.subjectId || ''}&folder_id=${notebook.folder}&q=${encodeURIComponent(notebook.query)}&page=${notebook.page}`);
  if(request!==notebook.request)return;
  notebook.page=result.page;notebook.pages=result.pages;
  $('#notes-list').innerHTML=`<p class="note-count">${result.total} ${t('notes')}</p>`+(result.notes.map(note=>`<button class="note-list-item ${notebook.note?.id===note.id?'selected':''}" data-open-note="${note.id}" aria-pressed="${notebook.note?.id===note.id}"><span class="note-list-title">${note.pinned?`<small class="pin-label">★ ${t('Pinned')}</small>`:''}${escapeHtml(note.title)}</span><span class="note-list-preview">${escapeHtml(note.preview.replace(/\s+/g,' '))}</span><time>${noteDate(note.updated_at)}</time></button>`).join('')||`<p class="muted note-list-empty">${t('No notes found.')}</p>`);
  $('#notes-pagination').innerHTML=`<button class="secondary" id="notes-prev" ${result.page<=1?'disabled':''}>←</button><span>${t('Page')} ${result.page} ${t('of')} ${result.pages}</span><button class="secondary" id="notes-next" ${result.page>=result.pages?'disabled':''}>→</button>`;
  $('#notes-prev').onclick=()=>{notebook.page--;loadNotes();};
  $('#notes-next').onclick=()=>{notebook.page++;loadNotes();};
  if(typeof loadGlobalNotes==='function' && currentPage()==='notes')loadGlobalNotes();
  document.querySelectorAll('[data-open-note]').forEach(button=>button.onclick=()=>selectNote(Number(button.dataset.openNote)));
 }catch(error){if(request===notebook.request)$('#notes-list').textContent=error.message;}
}

async function selectNote(id) {
 if(!allowNoteNavigation())return;
 const request=++notebook.selectionRequest;
 try {
  const result=await api(noteEndpoint(id));
  if(request!==notebook.selectionRequest)return;
  notebook.note=result.note;renderNoteEditor();
  document.querySelectorAll('[data-open-note]').forEach(button=>{
   const selected=Number(button.dataset.openNote)===id;
   button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));
  });
 }catch(error){toast(error.message);}
}

function renderNoteEditor() {
 const note=notebook.note;
 const root=notebook.subjectId?noteFolderStore.find(folder=>folder.subject_id===notebook.subjectId):null;
 notebook.originalFolder=note?note.folder_id:(notebook.folder || root?.id || '');
 $('#note-editor').innerHTML=`<form id="note-form"><div class="note-editor-toolbar"><span id="note-save-state">${t(note?'Saved':'New note')}</span>${note?`<div><button type="button" class="secondary" id="pin-note">${t(note.pinned?'Unpin':'Pin to top')}</button><button type="button" class="secondary" id="delete-note">${t('Delete')}</button></div>`:''}</div><label class="note-title-label">${t('Title')}<input id="note-title-input" maxlength="160" required placeholder="${t('Note title')}" value="${escapeHtml(note?.title || '')}"></label>${note?`<div class="note-timestamps"><span>${t('Created')}: ${noteDate(note.created_at)}</span><span>${t('Updated')}: ${noteDate(note.updated_at)}</span></div>`:''}<div class="note-folder-location-row"><span>▱ ${escapeHtml(noteFolderPath(notebook.originalFolder) || t('No folder'))}</span>${note?`<button type="button" class="secondary" id="change-note-folder">${t('Move')}</button>`:''}</div><label class="note-folder-label"><select id="note-folder-select" aria-label="${t('Folder')}" hidden><option value="">${t('No folder')}</option>${folderOptions(notebook.originalFolder)}</select></label><label class="note-body-label">${t('Note content')}<textarea id="note-body" maxlength="100000" placeholder="${t('Write your note here…')}">${escapeHtml(note?.body || '')}</textarea></label><div id="note-delete-confirm" hidden><p>${t('Delete this note permanently?')}</p><button type="button" class="danger" id="confirm-delete-note">${t('Delete')}</button><button type="button" class="secondary" id="cancel-delete-note">${t('Cancel')}</button></div><div class="note-editor-footer"><span id="note-error" role="alert"></span><button type="button" class="secondary" id="discard-note">${t('Discard changes')}</button><button id="save-note">${t('Save note')}</button></div></form>`;
 for(const selector of ['#note-title-input','#note-body','#note-folder-select'])$(selector).oninput=()=>$('#note-save-state').textContent=t(noteDirty()?'Unsaved changes':'Saved');
 if($('#change-note-folder'))$('#change-note-folder').onclick=()=>{$('#note-folder-select').hidden=false;$('#change-note-folder').hidden=true;};
 $('#discard-note').onclick=()=>{if(!notebook.saving)renderNoteEditor();};
 $('#note-form').onsubmit=async event=>{
  event.preventDefault();if(notebook.saving)return;
  notebook.saving=true;$('#save-note').disabled=true;
  try {
   const data={title:$('#note-title-input').value,body:$('#note-body').value};
   const folder=$('#note-folder-select').value;
   if(folder || note)data.folder_id=folder?Number(folder):null;
   const result=await api(noteEndpoint(note?.id),note?'PATCH':'POST',data);
   notebook.note=result.note;notebook.page=1;renderNoteEditor();$('#notes-dialog').close();toast(t('Note saved.'));
   if(currentPage()==='notes'){await refreshFolderTree();await loadGlobalNotes();}
  }catch(error){$('#note-error').textContent=error.message;$('#save-note').disabled=false;}
  finally{notebook.saving=false;}
 };
 if(note){
  $('#pin-note').onclick=async()=>{
   if(!allowNoteNavigation())return;
   try {const result=await api(noteEndpoint(note.id),'PATCH',{pinned:!note.pinned});notebook.note=result.note;renderNoteEditor();await loadNotes();}
   catch(error){toast(error.message);}
  };
  $('#delete-note').onclick=()=>{if(allowNoteNavigation())$('#note-delete-confirm').hidden=false;};
  $('#cancel-delete-note').onclick=()=>$('#note-delete-confirm').hidden=true;
  $('#confirm-delete-note').onclick=async()=>{
   if(notebook.saving)return;notebook.saving=true;$('#confirm-delete-note').disabled=true;
   try {await api(noteEndpoint(note.id),'DELETE');notebook.note=null;await fetchNoteFolders();renderNoteEditor();await loadNotes();if(currentPage()==='notes')refreshFolderTree();toast(t('Note deleted.'));}
   catch(error){$('#note-error').textContent=error.message;$('#confirm-delete-note').disabled=false;}
   finally{notebook.saving=false;}
  };
 }
}

document.addEventListener('click',event=>{
 const button=event.target.closest('[data-notes]');
 if(button)openNotes(Number(button.dataset.notes)).catch(error=>toast(error.message));
});
window.addEventListener('beforeunload',event=>{if(noteDirty()){event.preventDefault();event.returnValue='';}});

function noteEndpoint(id){return (notebook.subjectId?`subjects/${notebook.subjectId}/notes`:'notes')+(id?'/'+id:'');}
function noteSubjectValue(value){const id=Number(value);return Number.isInteger(id)&&id>0?id:null;}
