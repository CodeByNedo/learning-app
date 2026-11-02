const globalNotebook={query:'',subject:'',folder:'',page:1,request:0};

function renderGlobalNotes() {
 $('#page-notes').innerHTML=`<div class="notes-workspace"><aside class="folder-sidebar"><div class="section-title"><h3>${t('Folders')}</h3><div class="explorer-tools"><button class="secondary" id="global-add-note" title="${t('New note')}" aria-label="${t('New note')}">▤+</button><button class="secondary" id="global-new-folder" title="${t('New folder')}" aria-label="${t('New folder')}">▱+</button></div></div><div id="folder-tree"></div></aside><section class="panel"><div class="folder-location-header"><h2 id="global-folder-heading">${t('All notes')}</h2><button class="secondary" id="global-new-subfolder" ${globalNotebook.folder?'':'hidden'}>+ ${t('New subfolder')}</button></div><div class="section-title" style="justify-content:flex-end"><button id="global-new-note" >+ ${t('New note')}</button></div><form id="global-note-filters"><input id="global-note-search" type="search" maxlength="200" placeholder="${t('Search titles and text')}" aria-label="${t('Search titles and text')}" value="${escapeHtml(globalNotebook.query)}"><select id="global-note-subject" aria-label="${t('Subject')}"><option value="">${t('All subjects')}</option>${state.subjects.map(subject=>`<option value="${subject.id}" ${String(subject.id)===globalNotebook.subject?'selected':''}>${escapeHtml(subject.name)}${subject.archived?' · '+t('Archived'):''}</option>`).join('')}</select><button class="secondary">${t('Search')}</button></form><div id="global-notes-results" aria-live="polite"></div><div id="global-notes-pagination"></div></section></div>`;
 $('#global-note-filters').onsubmit=event=>{event.preventDefault();globalNotebook.query=$('#global-note-search').value;globalNotebook.page=1;loadGlobalNotes();};
 $('#global-note-subject').onchange=event=>{globalNotebook.subject=event.target.value;globalNotebook.page=1;loadGlobalNotes();};
 $('#global-note-search').oninput=event=>{if(!event.target.value){globalNotebook.query='';globalNotebook.page=1;loadGlobalNotes();}};
 $('#global-new-note').onclick=()=>chooseNoteSubject();
 $('#global-add-note').onclick=()=>chooseNoteSubject(true);
 $('#global-new-folder').onclick=()=>openNoteFolderDialog();
 $('#global-new-subfolder').onclick=()=>openNoteFolderDialog(null,Number(globalNotebook.folder));
 if(typeof refreshFolderTree==='function')refreshFolderTree().then(()=>loadGlobalNotes());
 else loadGlobalNotes();
}

async function loadGlobalNotes() {
 if(!$('#global-notes-results'))return;
 const request=++globalNotebook.request;
 try {
  const result=await api(`notes?q=${encodeURIComponent(globalNotebook.query)}&subject_id=${globalNotebook.subject}&folder_id=${globalNotebook.folder}&page=${globalNotebook.page}`);
  if(request!==globalNotebook.request)return;
  globalNotebook.page=result.page;
  $('#global-notes-results').innerHTML=`<p class="note-count">${result.total} ${t('notes')}</p><div class="global-note-grid">${result.notes.map(note=>`<button class="global-note-card" draggable="true" data-drag-note="${note.id}" data-global-note="${note.id}" data-note-subject="${note.subject_id}"><span class="subject-with-icon">${note.subject_id?subjectIcon(note.subject_id):'<i class="subject-marker subject-avatar">▤</i>'}<span>${escapeHtml(subjectName(note.subject_id) || t('General notes'))}</span></span>${note.pinned?`<span class="pin-label">★ ${t('Pinned')}</span>`:''}<small class="note-folder-location">▱ ${escapeHtml(noteFolderPath(note.folder_id) || t('No folder'))}</small><strong>${escapeHtml(note.title)}</strong><span class="global-note-preview">${escapeHtml(note.preview)}</span><time>${t('Updated')}: ${noteDate(note.updated_at)}</time></button>`).join('')||`<p class="muted">${t('No notes found.')}</p>`}</div>`;
  $('#global-notes-pagination').innerHTML=`<button class="secondary" id="global-notes-prev" ${result.page<=1?'disabled':''}>←</button><span>${t('Page')} ${result.page} ${t('of')} ${result.pages}</span><button class="secondary" id="global-notes-next" ${result.page>=result.pages?'disabled':''}>→</button>`;
  $('#global-notes-prev').onclick=()=>{globalNotebook.page--;loadGlobalNotes();};
  $('#global-notes-next').onclick=()=>{globalNotebook.page++;loadGlobalNotes();};
  document.querySelectorAll('[data-global-note]').forEach(button=>button.onclick=async()=>{
   try {await openNotes(noteSubjectValue(button.dataset.noteSubject),globalNotebook.folder);await selectNote(Number(button.dataset.globalNote));}
   catch(error){toast(error.message);}
  });
 }catch(error){if(request===globalNotebook.request)$('#global-notes-results').textContent=error.message;}
}

function folderSubjectId(folderId){
 const seen=new Set();let folder=noteFolderStore.find(item=>item.id===Number(folderId));
 while(folder&&!seen.has(folder.id)){seen.add(folder.id);if(folder.subject_id)return folder.subject_id;folder=noteFolderStore.find(item=>item.id===folder.parent_id);}
 return null;
}
async function startGlobalNote(subjectId, folderId='') {
 await openNotes(subjectId,folderId);
 $('#new-note').click();
}
function chooseNoteSubject(forcePicker=false) {
 if(!forcePicker && globalNotebook.folder){
  startGlobalNote(folderSubjectId(globalNotebook.folder),globalNotebook.folder).catch(error=>toast(error.message));return;
 }
 const dialog=$('#note-subject-picker');
 dialog.innerHTML=`<form id="choose-note-subject-form"><h2 id="note-subject-title">${t('New note')}</h2><label>${t('Folder')}<select id="new-note-folder"><option value="">${t('No folder')}</option>${folderOptions(globalNotebook.folder)}</select></label><div class="actions"><button type="button" class="secondary" id="cancel-note-subject">${t('Cancel')}</button><button>${t('Create note')}</button></div></form>`;
 $('#cancel-note-subject').onclick=()=>dialog.close();
 $('#choose-note-subject-form').onsubmit=event=>{event.preventDefault();const folder=$('#new-note-folder').value;const subject=folderSubjectId(folder);dialog.close();startGlobalNote(subject,folder).catch(error=>toast(error.message));};
 dialog.showModal();
}

if(state && currentPage()==='notes')renderGlobalNotes();
