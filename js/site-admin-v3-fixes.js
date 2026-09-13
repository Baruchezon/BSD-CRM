'use strict';
(function(){
  function syncHealth(){
    const boxes=Array.from(document.querySelectorAll('#analyticsHealth'));
    if(boxes.length<2)return;
    const source=boxes.find(x=>x.innerHTML.trim())||boxes[0];
    boxes.forEach(x=>{if(x!==source){x.className=source.className;x.innerHTML=source.innerHTML;}});
  }
  function routeContentLinks(){
    document.querySelectorAll('a[href*="site-content-editor.html"]').forEach(a=>{
      const href=a.getAttribute('href')||'';
      const q=href.includes('?')?'?'+href.split('?')[1]:'';
      a.setAttribute('href','site-content-studio.html'+q);
    });
  }
  document.addEventListener('click',e=>{
    if(e.target.closest?.('[data-tab],[data-range]'))setTimeout(()=>{syncHealth();routeContentLinks();},30);
  });
  const boot=()=>{setTimeout(()=>{syncHealth();routeContentLinks();},300);setTimeout(routeContentLinks,1200)};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  setInterval(()=>{syncHealth();routeContentLinks();},1500);
})();