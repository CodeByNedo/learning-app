let internalNoteDrag=null;
let noteDropBusy=false;
const NOTE_DRAG_TYPE='application/x-ajde-note-item';

function canDropNoteItem(item,targetId,folders=noteFolderStore){
 if(!item)return false;
 if(targetId!==null&&!folders.some(folder=>folder.id===targetId))return false;
 if(item.kind==='note')return true;
 if(item.kind!=='folder')return false;
 const folder=folders.find(folder=>folder.id===item.id);
 if(!folder||folder.parent_id===targetId)return false;
 const seen=new Set([item.id]);
 for(let index=0;index<folders.length;index++)for(const child of folders)if(seen.has(child.parent_id))seen.add(child.id);
 return targetId===null||!seen.has(targetId);
}

function clearNoteDrag(){
 internalNoteDrag=null;
 document.body.classList.remove('internal-note-drag');
 document.querySelectorAll('.note-drop-target,.note-drag-source').forEach(element=>element.classList.remove('note-drop-target','note-drag-source'));
}

document.addEventListener('dragstart',event=>{
 const source=event.target.closest('[data-drag-note],[data-drag-folder]');
 if(!source||noteDropBusy)return;
 internalNoteDrag=source.dataset.dragNote?{kind:'note',id:Number(source.dataset.dragNote)}:{kind:'folder',id:Number(source.dataset.dragFolder)};
 event.dataTransfer.effectAllowed='move';
 event.dataTransfer.setData(NOTE_DRAG_TYPE,JSON.stringify(internalNoteDrag));
 source.classList.add('note-drag-source');
 document.body.classList.add('internal-note-drag');
});

document.addEventListener('dragover',event=>{
 if(!internalNoteDrag||noteDropBusy)return;
 const target=event.target.closest('[data-drop-folder]');
 document.querySelectorAll('.note-drop-target').forEach(element=>{if(element!==target)element.classList.remove('note-drop-target');});
 const id=target?.dataset.dropFolder?Number(target.dataset.dropFolder):null;
 if(!target||!canDropNoteItem(internalNoteDrag,id))return;
 event.preventDefault();event.dataTransfer.dropEffect='move';target.classList.add('note-drop-target');
 const sidebar=target.closest('.folder-sidebar');
 if(sidebar){const rectangle=sidebar.getBoundingClientRect();if(event.clientY<rectangle.top+35)sidebar.scrollTop-=12;else if(event.clientY>rectangle.bottom-35)sidebar.scrollTop+=12;}
});

document.addEventListener('dragleave',event=>{
 const target=event.target.closest('[data-drop-folder]');
 if(target&&!target.contains(event.relatedTarget))target.classList.remove('note-drop-target');
});

document.addEventListener('drop',async event=>{
 const target=event.target.closest('[data-drop-folder]');
 if(!target||!internalNoteDrag||noteDropBusy)return;
 const id=target.dataset.dropFolder?Number(target.dataset.dropFolder):null;
 const item=internalNoteDrag;
 if(!canDropNoteItem(item,id))return;
 event.preventDefault();clearNoteDrag();noteDropBusy=true;
 $('#page-notes')?.classList.add('note-drag-busy');
 try{
  if(item.kind==='note')await api('notes/'+item.id,'PATCH',{folder_id:id});
  else await api('note-folders/'+item.id,'PATCH',{parent_id:id});
  if(id!==null)folderTreeExpanded.add(id);
  await refreshFolderTree();await loadGlobalNotes();
  toast(t(item.kind==='note'?'Note moved.':'Folder moved.'));
 }catch(error){toast(error.message);}
 finally{noteDropBusy=false;$('#page-notes')?.classList.remove('note-drag-busy');}
});
document.addEventListener('dragend',clearNoteDrag);
