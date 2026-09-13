'use strict';
(function(){
  function syncHealth(){
    const boxes=Array.from(document.querySelectorAll('#analyticsHealth'));
    if(boxes.length<2)return;
    const source=boxes.find(x=>x.innerHTML.trim())||boxes[0];
    boxes.forEach(x=>{if(x!==source){x.className=source.className;x.innerHTML=source.innerHTML;}});
  }
  document.addEventListener('click',e=>{if(e.target.closest?.('[data-tab],[data-range]'))setTimeout(syncHealth,30)});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(syncHealth,500)},{once:true});
  setInterval(syncHealth,1500);
})();