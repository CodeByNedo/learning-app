const practiceView={loaded:false,loading:false,lang:null,collections:[],collection:null,sources:[],rounds:[],round:null,questions:[],index:0,aiReady:false,model:'',busy:false,drafts:{},selected:new Set(),summary:false};
const practiceText=value=>escapeHtml(String(value??''));

async function renderPractice(){
 if(practiceView.loaded){if(practiceView.lang!==language)paintPractice();return;}
 if(practiceView.loading)return;
 practiceView.loading=true;
 try{await loadPracticeCollections();practiceView.loaded=true;paintPractice();}
 catch(error){$('#page-practice').innerHTML=`<section class="panel"><p role="alert">${practiceText(error.message)}</p><button id="practice-reload">${t('Try again')}</button></section>`;$('#practice-reload').onclick=()=>renderPractice();}
 finally{practiceView.loading=false;}
}
async function loadPracticeCollections(){
 const result=await api('practice/collections');practiceView.collections=result.collections;practiceView.aiReady=result.ai_ready;practiceView.model=result.model;
}
async function openPracticeCollection(id){
 const result=await api('practice/collections/'+id);
 Object.assign(practiceView,{collection:result.collection,sources:result.sources,rounds:result.rounds,round:null,questions:[],summary:false,selected:new Set(result.sources.map(source=>source.id))});
 paintPractice();
}
function practiceSetup(){return `<details class="practice-setup" ${practiceView.aiReady?'':'open'}><summary>${t(practiceView.aiReady?'AI connected':'Connect AI')}</summary><p>${t('PDFs stay local. Generating questions sends selected text to OpenAI; checking answers sends the answer and source pages. API usage may incur charges.')}</p><p>${t('Copy .env.example to .env in the project folder and set OPENAI_API_KEY. Keep the key private; do not paste it in chat. ChatGPT and API access are separate.')}</p><button type="button" class="secondary" id="practice-check-ai">${t('Check connection settings')}</button><span class="muted">${t('Model')}: ${practiceText(practiceView.model)}</span></details>`;}

function paintPractice(){
 practiceView.lang=language;
 const v=practiceView;
 $('#page-practice').innerHTML=`<div class="practice-layout"><aside class="panel practice-library"><div class="section-title"><h2>${t('Collections')}</h2><button id="practice-new" aria-label="${t('New collection')}">+</button></div>${v.collections.length?v.collections.map(collection=>`<button class="practice-collection ${v.collection?.id===collection.id?'active':''}" data-practice-collection="${collection.id}"><strong>${practiceText(collection.name)}</strong><span>${practiceText(collection.subject_name)} · ${collection.source_count} PDF</span></button>`).join(''):`<p class="muted">${t('Create a collection for your subject and add PDFs.')}</p>`}</aside><section class="panel practice-main">${v.collection?`<div class="section-title"><div><p class="eyebrow">${practiceText(subjectName(v.collection.subject_id))}</p><h2>${practiceText(v.collection.name)}</h2></div><button class="secondary" id="practice-library-view">${t('Materials')}</button></div>${v.round?practiceRoundHTML():practiceMaterialsHTML()}`:`<div class="practice-empty"><h2>${t('Practice for your oral exam')}</h2><p class="muted">${t('Add PDFs, answer in your own words, and practise follow-up questions.')}</p><button id="practice-first">+ ${t('New collection')}</button></div>`}<p id="practice-error" class="practice-error" role="alert"></p><p id="practice-status" role="status" class="muted"></p></section></div>`;
 $('#practice-new').onclick=newPracticeCollection;
 if($('#practice-first'))$('#practice-first').onclick=newPracticeCollection;
 document.querySelectorAll('[data-practice-collection]').forEach(button=>button.onclick=()=>practiceAction(()=>openPracticeCollection(Number(button.dataset.practiceCollection))));
 if($('#practice-library-view'))$('#practice-library-view').onclick=()=>{v.round=null;v.summary=false;paintPractice();};
 bindPracticeMaterials();bindPracticeRound();
}
function practiceMaterialsHTML(){
 const v=practiceView;
 return `${practiceSetup()}<form id="practice-upload" class="practice-upload"><label>${t('Add PDFs')}<input type="file" name="files" id="practice-files" accept="application/pdf,.pdf" multiple required></label><button>${t('Upload PDFs')}</button><small class="muted">${t('Up to 10 PDFs / 20 MB per upload. Text PDFs only; OCR is not included.')}</small></form><div class="practice-sources">${v.sources.map(source=>`<label class="practice-source"><input type="checkbox" data-practice-source="${source.id}" ${v.selected.has(source.id)?'checked':''}><span><strong>${practiceText(source.name)}</strong><small>${source.readable_pages} / ${source.page_count} ${t('readable pages')}${source.readable_pages<source.page_count?' · '+t('Some pages have little or no text.'):''}</small></span><a href="/api/practice/sources/${source.id}/pdf" target="_blank" rel="noopener">${t('View PDF')}</a></label>`).join('')}</div><form id="practice-generate" class="practice-generate"><label>${t('Questions')}<input id="practice-count" type="number" min="1" max="10" value="5" required></label><button ${!v.aiReady||!v.sources.length?'disabled':''}>${t('Create practice')}</button></form><h3>${t('Saved practice')}</h3><div class="practice-saved">${v.rounds.map(round=>`<button class="secondary" data-practice-round="${round.id}"><strong>${round.question_count} ${t('questions')}</strong><span>${practiceText(new Date(round.created_at).toLocaleString(locale()))}</span></button>`).join('')||`<p class="muted">${t('No saved practice yet.')}</p>`}</div><details class="practice-delete"><summary>${t('Manage collection')}</summary><button type="button" class="danger" id="practice-delete">${t('Delete collection')}</button></details>`;
}
async function practiceAction(action,status=''){
 if(practiceView.busy)return;
 practiceView.busy=true;
 const section=$('#page-practice');section.setAttribute('aria-busy','true');
 const controls=[...section.querySelectorAll('button,input,select,textarea')].map(node=>[node,node.disabled]);controls.forEach(([node])=>node.disabled=true);
 if($('#practice-error'))$('#practice-error').textContent='';if($('#practice-status'))$('#practice-status').textContent=t(status);
 try{await action();}
 catch(error){if($('#practice-error'))$('#practice-error').textContent=error.message;}
 finally{practiceView.busy=false;section.removeAttribute('aria-busy');controls.forEach(([node,disabled])=>{if(node.isConnected)node.disabled=disabled;});if($('#practice-status'))$('#practice-status').textContent='';}
}
function newPracticeCollection(){
 if(practiceView.busy)return;
 const dialog=document.createElement('dialog');dialog.className='practice-dialog';
 const subjects=state.subjects.filter(subject=>!subject.archived);
 dialog.innerHTML=`<form><h2>${t('New collection')}</h2><label>${t('Subject')}<select name="subject" required>${subjects.map(subject=>`<option value="${subject.id}">${practiceText(subject.name)}</option>`).join('')}</select></label><label>${t('Collection name')}<input name="name" maxlength="100" required placeholder="${t('e.g. First exam materials')}"></label><p class="practice-error" role="alert"></p><div class="actions"><button type="button" class="secondary">${t('Cancel')}</button><button type="submit" ${subjects.length?'':'disabled'}>${t('Create')}</button></div>${subjects.length?'':`<p>${t('Add a subject first.')}</p>`}</form>`;
 document.body.append(dialog);dialog.addEventListener('close',()=>dialog.remove());dialog.querySelector('[type=button]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const button=dialog.querySelector('[type=submit]');button.disabled=true;try{const form=dialog.querySelector('form');const result=await api('practice/collections','POST',{subject_id:Number(form.elements.subject.value),name:form.elements.name.value});await loadPracticeCollections();await openPracticeCollection(result.id);dialog.close();}catch(error){dialog.querySelector('[role=alert]').textContent=error.message;button.disabled=false;}};
 dialog.showModal();
}
function bindPracticeMaterials(){
 if($('#practice-check-ai'))$('#practice-check-ai').onclick=()=>practiceAction(async()=>{await loadPracticeCollections();paintPractice();});
 document.querySelectorAll('[data-practice-source]').forEach(input=>input.onchange=()=>{const id=Number(input.dataset.practiceSource);if(input.checked)practiceView.selected.add(id);else practiceView.selected.delete(id);});
 if($('#practice-upload'))$('#practice-upload').onsubmit=event=>{event.preventDefault();const files=[...$('#practice-files').files];if(files.length>10||files.reduce((sum,file)=>sum+file.size,0)>20*1024*1024){$('#practice-error').textContent=t('Upload up to 20 MB and 10 PDFs at a time.');return;}const body=new FormData();files.forEach(file=>body.append('files',file));practiceAction(async()=>{const response=await fetch('/api/practice/collections/'+practiceView.collection.id+'/sources',{method:'POST',body});const result=await response.json();if(!response.ok)throw Error(t(result.error||'Something went wrong.'));await loadPracticeCollections();await openPracticeCollection(practiceView.collection.id);},'Reading PDFs…');};
 if($('#practice-generate'))$('#practice-generate').onsubmit=event=>{event.preventDefault();const count=Number($('#practice-count').value),source_ids=[...practiceView.selected];if(!source_ids.length){$('#practice-error').textContent=t('Choose PDFs from this collection.');return;}practiceAction(async()=>{const result=await api('practice/collections/'+practiceView.collection.id+'/rounds','POST',{count,source_ids,language});await openPracticeRound(result.id);},'Creating questions…');};
 document.querySelectorAll('[data-practice-round]').forEach(button=>button.onclick=()=>practiceAction(()=>openPracticeRound(Number(button.dataset.practiceRound))));
 if($('#practice-delete'))$('#practice-delete').onclick=()=>{if(!confirm(t('Delete this collection, PDFs and all practice attempts?')))return;practiceAction(async()=>{await api('practice/collections/'+practiceView.collection.id,'DELETE',{confirm:true});practiceView.collection=null;await loadPracticeCollections();paintPractice();});};
}
async function openPracticeRound(id){
 const result=await api('practice/rounds/'+id);Object.assign(practiceView,{round:result.round,questions:result.questions,index:Math.max(0,result.questions.findIndex(q=>!q.attempts.length)),summary:false});paintPractice();
}
function practiceFeedback(evaluation){
 return `<div class="practice-feedback"><div class="practice-score"><strong>${evaluation.score}%</strong><span>${t('Approximate key-concept coverage')}</span></div><progress max="100" value="${evaluation.score}" aria-label="${t('Approximate key-concept coverage')}"></progress><p>${practiceText(evaluation.feedback)}</p><div class="practice-feedback-columns"><div><h4>${t('What you got right')}</h4>${evaluation.correct.length?`<ul>${evaluation.correct.map(point=>`<li>${practiceText(point)}</li>`).join('')}</ul>`:`<p>—</p>`}</div><div><h4>${t('What to improve')}</h4>${evaluation.missing.length?`<ul>${evaluation.missing.map(point=>`<li>${practiceText(point)}</li>`).join('')}</ul>`:`<p>—</p>`}</div></div><details><summary>${t('Reference answer and sources')}</summary><p class="practice-prose">${practiceText(evaluation.model_answer)}</p>${evaluation.citations.map(citation=>`<blockquote><a href="/api/practice/sources/${citation.source_id}/pdf#page=${citation.page}" target="_blank" rel="noopener">${practiceText(citation.name)} · ${t('Page')} ${citation.page}</a><p>${practiceText(citation.quote)}</p></blockquote>`).join('')}</details></div>`;
}
function practiceRoundHTML(){
 const v=practiceView;
 if(v.summary)return `<h3>${t('Practice overview')}</h3><div class="practice-summary">${v.questions.map((q,index)=>`<button class="secondary" data-practice-jump="${index}"><span>${index+1}. ${practiceText(q.question)}</span><strong>${q.attempts.length?q.attempts.at(-1).evaluation.score+'%':t('Not answered')}</strong></button>`).join('')}</div><button id="practice-repeat">${t('Repeat weaker answers')}</button>`;
 const q=v.questions[v.index],attempt=q.retry?null:q.attempts.at(-1),draftKey='q'+q.id;
 return `<div class="practice-question-nav"><span>${t('Question')} ${v.index+1} / ${v.questions.length}</span><button class="secondary" id="practice-overview">${t('Overview')}</button></div><h3 class="practice-question">${practiceText(q.question)}</h3><p class="muted">${t('Say your answer aloud, then write its main points.')}</p>${attempt?`<details class="practice-your-answer"><summary>${t('Your answer')}</summary><p class="practice-prose">${practiceText(attempt.answer)}</p></details>${practiceFeedback(attempt.evaluation)}${attempt.evaluation.followup?`<section class="practice-followup"><h3>${t('Follow-up question')}</h3><p>${practiceText(attempt.evaluation.followup.question)}</p>${attempt.followup_evaluation?`<details><summary>${t('Your answer')}</summary><p class="practice-prose">${practiceText(attempt.followup_answer)}</p></details>${practiceFeedback(attempt.followup_evaluation)}`:`<form id="practice-followup-answer"><textarea maxlength="12000" required rows="4" aria-label="${t('Your answer')}" placeholder="${t('Your answer')}">${practiceText(v.drafts['a'+attempt.id]||'')}</textarea><button ${v.aiReady?'':'disabled'}>${t('Check follow-up')}</button></form>`}</section>`:''}`:`<form id="practice-answer"><label>${t('Your answer')}<textarea rows="7" maxlength="12000" required placeholder="${t('Explain in your own words…')}">${practiceText(v.drafts[draftKey]||'')}</textarea></label><button ${v.aiReady?'':'disabled'}>${t('Check answer')}</button></form>`}<div class="practice-navigation"><button class="secondary" id="practice-previous" ${v.index?'':'disabled'}>← ${t('Previous')}</button>${attempt?`<button class="secondary" id="practice-retry">${t('Try this question again')}</button>`:''}<button class="secondary" id="practice-next">${t(v.index===v.questions.length-1?'Finish practice':'Next')} →</button></div>${v.aiReady?'':`<p class="muted">${t('Set an OpenAI API key in the local .env file first.')}</p>`}`;
}
function bindPracticeRound(){
 const v=practiceView;if(!v.round)return;
 const q=v.questions[v.index];
 if($('#practice-answer')){
  const textarea=$('#practice-answer textarea');textarea.oninput=()=>v.drafts['q'+q.id]=textarea.value;
  $('#practice-answer').onsubmit=event=>{event.preventDefault();const answer=textarea.value;practiceAction(async()=>{const result=await api('practice/questions/'+q.id+'/answer','POST',{answer});q.attempts.push({id:result.id,answer,evaluation:result.evaluation,followup_evaluation:null});q.retry=false;delete v.drafts['q'+q.id];paintPractice();},'Checking answer…');};
 }
 if($('#practice-followup-answer')){
  const attempt=q.attempts.at(-1),textarea=$('#practice-followup-answer textarea');textarea.oninput=()=>v.drafts['a'+attempt.id]=textarea.value;
  $('#practice-followup-answer').onsubmit=event=>{event.preventDefault();const answer=textarea.value;practiceAction(async()=>{const result=await api('practice/attempts/'+attempt.id+'/followup','POST',{answer});attempt.followup_answer=answer;attempt.followup_evaluation=result.evaluation;delete v.drafts['a'+attempt.id];paintPractice();},'Checking answer…');};
 }
 if($('#practice-overview'))$('#practice-overview').onclick=()=>{v.summary=true;paintPractice();};
 if($('#practice-previous'))$('#practice-previous').onclick=()=>{v.index--;paintPractice();};
 if($('#practice-next'))$('#practice-next').onclick=()=>{if(v.index===v.questions.length-1)v.summary=true;else v.index++;paintPractice();};
 if($('#practice-retry'))$('#practice-retry').onclick=()=>{q.retry=true;paintPractice();};
 document.querySelectorAll('[data-practice-jump]').forEach(button=>button.onclick=()=>{v.index=Number(button.dataset.practiceJump);v.summary=false;paintPractice();});
 if($('#practice-repeat'))$('#practice-repeat').onclick=()=>{const index=v.questions.findIndex(question=>!question.attempts.length||question.attempts.at(-1).evaluation.score<70);if(index<0){$('#practice-status').textContent=t('All questions reached at least 70%. You can retry any question.');return;}v.index=index;v.questions[index].retry=true;v.summary=false;paintPractice();};
}
if(state&&currentPage()==='practice')renderPractice();
