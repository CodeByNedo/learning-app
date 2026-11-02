let noteFolderStore=[];
async function fetchNoteFolders(){const result=await api('note-folders');noteFolderStore=result.folders;return noteFolderStore;}
function noteFolderPath(id){
 const names=[],seen=new Set();let folder=noteFolderStore.find(item=>item.id===Number(id));
 while(folder&&!seen.has(folder.id)){seen.add(folder.id);names.unshift(folder.name);folder=noteFolderStore.find(item=>item.id===folder.parent_id);}
 return names.join(' / ');
}
function folderOptions(selectedId='',excludedId=null){
 const excluded=new Set(excludedId?[excludedId]:[]);
 for(let i=0;i<noteFolderStore.length;i++)for(const folder of noteFolderStore)if(excluded.has(folder.parent_id))excluded.add(folder.id);
 return noteFolderStore.filter(folder=>!excluded.has(folder.id)).sort((a,b)=>noteFolderPath(a.id).localeCompare(noteFolderPath(b.id),locale())).map(folder=>`<option value="${folder.id}" ${String(folder.id)===String(selectedId)?'selected':''}>${escapeHtml(noteFolderPath(folder.id))}</option>`).join('');
}
const folderTreeExpanded=new Set();
const folderTreeNotes=new Map();
let folderTreeRequest=0;
async function refreshFolderTree(){
 const request=++folderTreeRequest;
 try{
  await fetchNoteFolders();if(request!==folderTreeRequest||!$('#folder-tree'))return;
  if(globalNotebook.folder&&!noteFolderStore.some(folder=>String(folder.id)===globalNotebook.folder))globalNotebook.folder='';
  let selected=noteFolderStore.find(folder=>String(folder.id)===globalNotebook.folder);
  while(selected){folderTreeExpanded.add(selected.id);selected=noteFolderStore.find(folder=>folder.id===selected.parent_id);}
  folderTreeNotes.clear();
  await Promise.all(noteFolderStore.filter(folder=>folderTreeExpanded.has(folder.id)).map(async folder=>{
   const result=await api(`notes?folder_id=${folder.id}&direct=1&page=1`);
   if(request===folderTreeRequest)folderTreeNotes.set(folder.id,result);
  }));
  if(request===folderTreeRequest)renderFolderTree();
 }catch(error){toast(error.message);}
}
function renderFolderTree(){
 const host=$('#folder-tree');if(!host)return;
 const subtreeCount=id=>{const ids=new Set([id]);for(let i=0;i<noteFolderStore.length;i++)for(const folder of noteFolderStore)if(ids.has(folder.parent_id))ids.add(folder.id);return noteFolderStore.filter(folder=>ids.has(folder.id)).reduce((n,folder)=>n+folder.note_count,0);};
 const branch=parent=>noteFolderStore.filter(folder=>folder.parent_id===parent).map(folder=>{
  const expanded=folderTreeExpanded.has(folder.id),count=subtreeCount(folder.id),hasChildren=noteFolderStore.some(child=>child.parent_id===folder.id)||count>0;
  const result=folderTreeNotes.get(folder.id);
  return `<li class="folder-node"><div class="folder-tree-row" draggable="true" data-drag-folder="${folder.id}" data-drop-folder="${folder.id}"><button class="folder-toggle" data-toggle-folder="${folder.id}" aria-label="${t(expanded?'Collapse folder':'Expand folder')}: ${escapeHtml(folder.name)}" aria-expanded="${expanded}" ${hasChildren?'':'disabled'}>${hasChildren?(expanded?'▾':'▸'):'·'}</button><button class="folder-tree-link ${globalNotebook.folder===String(folder.id)?'selected':''}" data-filter-folder="${folder.id}" title="${escapeHtml(noteFolderPath(folder.id))}"><span class="folder-glyph">${expanded?'▱':'▰'}</span><span>${escapeHtml(folder.name)}</span><small>${count}</small></button><button class="folder-add-note" data-folder-new-note="${folder.id}" title="${t('New note')}" aria-label="${t('New note')}: ${escapeHtml(folder.name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 3H5v18h9M13 3l5 5v4M13 3v5h5M7 12h5M7 16h4M18 15v6M15 18h6"/></svg></button><button class="folder-add-child" data-child-folder="${folder.id}" title="${t('New subfolder')}" aria-label="${t('New subfolder')}: ${escapeHtml(folder.name)}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11V6H11L9 3H3v17h10M18 14v7M14.5 17.5h7"/></svg></button><button class="folder-edit" data-edit-note-folder="${folder.id}" aria-label="${t('Edit folder')}: ${escapeHtml(folder.name)}">⋯</button></div>${expanded?`<ul class="folder-children">${branch(folder.id)}${(result?.notes||[]).map(note=>`<li><button class="folder-note-file" draggable="true" data-drag-note="${note.id}" data-tree-note="${note.id}" data-tree-subject="${note.subject_id}" title="${escapeHtml(note.title)}"><span>▤</span><span>${escapeHtml(note.title)}</span>${note.pinned?'<small>★</small>':''}</button></li>`).join('')}${result&&result.page<result.pages?`<li><button class="folder-more" data-more-folder="${folder.id}">${t('Show more notes')}…</button></li>`:''}${!hasChildren?`<li class="folder-empty">${t('Empty folder')}</li>`:''}</ul>`:''}</li>`;
 }).join('');
 host.innerHTML=`<button class="folder-all ${globalNotebook.folder?'':'selected'}" data-filter-folder="">${t('All notes')}</button><div class="folder-root-drop" data-drop-folder="">↑ ${t('Drop here for top level')}</div><ul class="folder-root">${branch(null)}</ul>${noteFolderStore.length?'':`<p class="muted">${t('No folders yet.')}</p>`}`;
 host.querySelectorAll('[data-filter-folder]').forEach(button=>button.onclick=()=>{globalNotebook.folder=button.dataset.filterFolder;globalNotebook.page=1;refreshFolderTree().then(()=>loadGlobalNotes());});
 host.querySelectorAll('[data-toggle-folder]').forEach(button=>button.onclick=async()=>{
  const id=Number(button.dataset.toggleFolder);
  if(folderTreeExpanded.has(id)){folderTreeExpanded.delete(id);renderFolderTree();return;}
  folderTreeExpanded.add(id);
  try{if(!folderTreeNotes.has(id))folderTreeNotes.set(id,await api(`notes?folder_id=${id}&direct=1&page=1`));renderFolderTree();}catch(error){toast(error.message);}
 });
 host.querySelectorAll('[data-folder-new-note]').forEach(button=>button.onclick=()=>{const id=Number(button.dataset.folderNewNote);startGlobalNote(folderSubjectId(id),String(id)).catch(error=>toast(error.message));});
 host.querySelectorAll('[data-child-folder]').forEach(button=>button.onclick=()=>openNoteFolderDialog(null,Number(button.dataset.childFolder)));
 host.querySelectorAll('[data-edit-note-folder]').forEach(button=>button.onclick=()=>openNoteFolderDialog(Number(button.dataset.editNoteFolder)));
 host.querySelectorAll('[data-tree-note]').forEach(button=>button.onclick=async()=>{try{await openNotes(noteSubjectValue(button.dataset.treeSubject));await selectNote(Number(button.dataset.treeNote));}catch(error){toast(error.message);}});
 host.querySelectorAll('[data-more-folder]').forEach(button=>button.onclick=async()=>{
  button.disabled=true;const id=Number(button.dataset.moreFolder),previous=folderTreeNotes.get(id);
  try{const result=await api(`notes?folder_id=${id}&direct=1&page=${previous.page+1}`);folderTreeNotes.set(id,{...result,notes:[...previous.notes,...result.notes]});renderFolderTree();}catch(error){button.disabled=false;toast(error.message);}
 });
 if($('#global-folder-heading'))$('#global-folder-heading').textContent=globalNotebook.folder?noteFolderPath(globalNotebook.folder):t('All notes');
 if($('#global-folder-heading'))$('#global-folder-heading').dataset.dropFolder=globalNotebook.folder;
 if($('#global-new-subfolder'))$('#global-new-subfolder').hidden=!globalNotebook.folder;
}

async function openNoteFolderDialog(id=null,parentId=null){
 try{
  await fetchNoteFolders();const folder=noteFolderStore.find(item=>item.id===id);const dialog=$('#note-folder-dialog');
  dialog.innerHTML=`<form id="note-folder-form"><h2 id="folder-dialog-title">${t(folder?'Edit folder':parentId?'New subfolder':'New folder')}</h2><label>${t('Folder name')}<input id="note-folder-name" maxlength="100" required value="${escapeHtml(folder?.name || '')}"></label>${folder?`<label>${t('Parent folder')}<select id="note-folder-parent"><option value="">${t('Top level')}</option>${folderOptions(folder.parent_id,id)}</select></label>`:parentId?`<p class="folder-create-location">▱ ${escapeHtml(noteFolderPath(parentId))}</p>`:''}<p id="note-folder-error" role="alert"></p><div class="actions">${folder?`<button type="button" class="danger" id="delete-note-folder">${t('Delete')}</button>`:''}<button type="button" class="secondary" id="cancel-note-folder">${t('Cancel')}</button><button>${t('Save')}</button></div></form>`;
  $('#cancel-note-folder').onclick=()=>dialog.close();
  $('#note-folder-form').onsubmit=async event=>{
   event.preventDefault();try{
    const parent=folder?$('#note-folder-parent').value:parentId;
    const result=await api('note-folders'+(folder?'/'+folder.id:''),folder?'PATCH':'POST',{name:$('#note-folder-name').value,parent_id:parent?Number(parent):null});
    if(parent)folderTreeExpanded.add(Number(parent));
    if(!folder)globalNotebook.folder=String(result.folder.id);
    dialog.close();await refreshFolderTree();await refreshNotebookFolderOptions();if(currentPage()==='notes')loadGlobalNotes();
   }catch(error){$('#note-folder-error').textContent=error.message;}
  };
  if(folder)$('#delete-note-folder').onclick=()=>confirmNoteFolderDelete(folder.id);
  dialog.showModal();
 }catch(error){toast(error.message);}
}
async function refreshNotebookFolderOptions(){
 await fetchNoteFolders();
 if(notebook.folder&&!noteFolderStore.some(folder=>String(folder.id)===notebook.folder))notebook.folder='';
 if($('#notes-dialog').open && notebook.note?.folder_id && !noteFolderStore.some(folder=>folder.id===notebook.note.folder_id)){notebook.note=null;renderNoteEditor();}
 if($('#note-folder-select')){const value=$('#note-folder-select').value;$('#note-folder-select').innerHTML=`<option value="">${t('No folder')}</option>`+folderOptions(value);}
 if($('#notebook-folder-filter')){const value=$('#notebook-folder-filter').value;$('#notebook-folder-filter').innerHTML=`<option value="">${t('All folders')}</option>`+folderOptions(value);}
}

async function confirmNoteFolderDelete(id){
 try{
  const preview=await api('note-folders/'+id+'/delete-preview');
  const dialog=$('#confirm-folder-delete-dialog');
  dialog.innerHTML=`<form id="confirm-folder-delete-form"><h2 id="confirm-folder-delete-title">${t('Delete folder?')}</h2><p><strong>${escapeHtml(preview.name)}</strong></p><p class="muted">${t('This permanently deletes this folder and its contents.')}</p><p class="folder-delete-summary">${preview.subfolders} ${t('subfolders')} · ${preview.notes} ${t('notes')}</p><p id="folder-delete-error" role="alert"></p><div class="actions"><button type="button" class="secondary" id="cancel-folder-delete">${t('Cancel')}</button><button class="danger" id="do-folder-delete">${t('Delete')}</button></div></form>`;
  $('#cancel-folder-delete').onclick=()=>dialog.close();
  $('#confirm-folder-delete-form').onsubmit=async event=>{
   event.preventDefault();$('#do-folder-delete').disabled=true;
   try{
    await api('note-folders/'+id,'DELETE',{confirm:true});dialog.close();$('#note-folder-dialog').close();
    await refreshFolderTree();await refreshNotebookFolderOptions();if(currentPage()==='notes')await loadGlobalNotes();
    toast(t('Folder deleted.'));
   }catch(error){$('#do-folder-delete').disabled=false;$('#folder-delete-error').textContent=error.message;}
  };
  dialog.showModal();
 }catch(error){toast(error.message);}
}

function closeFolderContextMenu(){
 const menu=$('#folder-context-menu');if(menu)menu.hidden=true;
}
document.addEventListener('contextmenu',event=>{
 const row=event.target.closest('.folder-tree-row[data-drag-folder]');
 if(!row){closeFolderContextMenu();return;}
 event.preventDefault();
 const id=Number(row.dataset.dragFolder),folder=noteFolderStore.find(item=>item.id===id);if(!folder)return;
 const menu=$('#folder-context-menu');
 menu.innerHTML=`<div class="folder-context-name">${escapeHtml(folder.name)}</div><button role="menuitem" id="context-new-note"><span>▤+</span>${t('New note')}</button><button role="menuitem" id="context-new-folder"><span>▱+</span>${t('New subfolder')}</button>`;
 menu.hidden=false;
 const bounds=menu.getBoundingClientRect();
 menu.style.left=Math.max(8,Math.min(event.clientX,window.innerWidth-bounds.width-8))+'px';
 menu.style.top=Math.max(8,Math.min(event.clientY,window.innerHeight-bounds.height-8))+'px';
 $('#context-new-note').onclick=()=>{closeFolderContextMenu();startGlobalNote(folderSubjectId(id),String(id)).catch(error=>toast(error.message));};
 $('#context-new-folder').onclick=()=>{closeFolderContextMenu();openNoteFolderDialog(null,id);};
 $('#context-new-note').focus();
});
document.addEventListener('pointerdown',event=>{if(!event.target.closest('#folder-context-menu'))closeFolderContextMenu();});
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeFolderContextMenu();});
window.addEventListener('scroll',closeFolderContextMenu,true);
window.addEventListener('resize',closeFolderContextMenu);
