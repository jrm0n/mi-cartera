// Privacidad visual: los cálculos y los datos guardados no se modifican.
(() => {
 'use strict';
 const KEY='mi_cartera_privacy_v1',root=document.documentElement;
 const skip='script,style,noscript,[data-privacy-toggle],.rangebar,.segmented,.navbtn,.sidebtn,.analysis-link,input,textarea,select,option,privacy-value,privacy-input,privacy-chart,#authGate,#dataBusyOverlay,#startupOverlay,.fund-name,.drawer-title,.sidebrand,.top-version,#appVersionLabel,#appVersionAnalysis';
 const financialInput='input[type="number"],input[inputmode="decimal"],#fLatestNav';
 let enabled=false;
 try{enabled=localStorage.getItem(KEY)==='hidden'}catch{}
 const observer=new MutationObserver(()=>{if(enabled)scan()});
 function observe(){observer.observe(document.body,{childList:true,subtree:true,characterData:true})}
 // Fechas, ISIN, versiones y etiquetas como 1M/5D siguen siendo legibles.
 function sensitiveRanges(text){
  const protectedRanges=[...text.matchAll(/\b(?:[A-Z]{2}[A-Z0-9]{10}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{1,2}:\d{2}(?::\d{2})?|v\d+\.\d+\.\d+)\b/gi)].map(m=>[m.index,m.index+m[0].length]);
  return [...text.matchAll(/(?<![\p{L}\p{N}])(?:[+−–-]\s*)?\d+(?:[.,]\d+)*(?:[\u00a0\u202f ]?(?:€|\$|£|%|pp\b|EUR\b|USD\b|GBP\b))?(?![\p{L}\p{N}])/gu)].filter(m=>{
   const start=m.index,end=start+m[0].length;
   if(protectedRanges.some(([a,b])=>start<b&&end>a))return false;
   // Los años aislados son etiquetas de periodo, no importes.
   return !/^(?:19|20)\d{2}$/.test(m[0]);
  });
 }
 function maskText(node){
  const text=node.nodeValue,matches=sensitiveRanges(text);if(!matches.length)return;
  const fragment=document.createDocumentFragment();let previous=0;
  for(const match of matches){
   fragment.append(document.createTextNode(text.slice(previous,match.index)));
   const value=document.createElement('privacy-value');value.textContent=match[0];value.setAttribute('role','img');value.setAttribute('aria-label','Valor oculto');fragment.append(value);previous=match.index+match[0].length;
  }
  fragment.append(document.createTextNode(text.slice(previous)));node.replaceWith(fragment);
 }
 function scan(){
  observer.disconnect();
  try{
   for(const id of ['app','detailContent','opContent']){
    const host=document.getElementById(id);if(!host)continue;
    const walker=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);const nodes=[];
    while(walker.nextNode())if(!walker.currentNode.parentElement.closest(skip))nodes.push(walker.currentNode);
    nodes.forEach(maskText);
    for(const canvas of host.querySelectorAll('canvas')){
     if(canvas.parentElement.tagName==='PRIVACY-CHART')continue;
     const wrap=document.createElement('privacy-chart');wrap.setAttribute('role','img');wrap.setAttribute('aria-label','Gráfico oculto');canvas.replaceWith(wrap);wrap.append(canvas);
    }
    for(const input of host.querySelectorAll(financialInput)){
     if(input.parentElement.tagName==='PRIVACY-INPUT')continue;
     const wrap=document.createElement('privacy-input');wrap.setAttribute('role','img');wrap.setAttribute('aria-label','Valor oculto');input.replaceWith(wrap);wrap.append(input);
     input.dataset.privacyWasInert=String(input.inert);input.inert=true;
    }
   }
  }finally{observe()}
 }
 function restore(){
  observer.disconnect();
  document.querySelectorAll('privacy-value').forEach(el=>el.replaceWith(document.createTextNode(el.textContent)));
  document.querySelectorAll('privacy-chart,privacy-input').forEach(el=>{
   const input=el.querySelector('input');if(input){input.inert=input.dataset.privacyWasInert==='true';delete input.dataset.privacyWasInert}
   el.replaceWith(...el.childNodes);
  });
  observe();
 }
 function render(){
  root.classList.toggle('privacy-hidden',enabled);
  document.querySelectorAll('[data-privacy-toggle]').forEach(button=>{
   button.setAttribute('aria-pressed',String(enabled));button.setAttribute('aria-label',enabled?'Mostrar cifras':'Ocultar cifras');button.title=enabled?'Mostrar cifras':'Ocultar cifras';
   button.innerHTML=enabled?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c5.5 0 9 7 9 7a17 17 0 0 1-3.1 3.9M6.2 6.2A19 19 0 0 0 3 12s3.5 7 9 7a10 10 0 0 0 5.8-1.8"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7Z"/><circle cx="12" cy="12" r="3"/></svg>';
  });
  if(enabled)scan();else restore();
 }
 document.querySelectorAll('[data-privacy-toggle]').forEach(button=>button.addEventListener('click',()=>{
  enabled=!enabled;try{localStorage.setItem(KEY,enabled?'hidden':'visible')}catch{}render();
 }));
 // Evita copiar cifras ocultas a través de la selección de texto.
 document.addEventListener('copy',event=>{if(enabled&&document.getSelection()?.toString()){event.preventDefault();event.clipboardData?.setData('text/plain','———')}});
 window.addEventListener('storage',event=>{if(event.key===KEY){enabled=event.newValue==='hidden';render()}});
 render();
})();
