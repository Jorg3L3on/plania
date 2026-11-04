function hm(el,weeks,seed){const C=['#22c55e','#3b82f6','#e64980','#facc15','#a78bfa'];let s=seed||7;const r=()=>(s=(s*9301+49297)%233280)/233280;
for(let w=0;w<weeks;w++)for(let d=0;d<7;d++){const i=document.createElement('i');const busy=r()+(w>weeks-14?.25:0)+(w%9<2?-.3:0);
if(w==weeks-1&&d>5){}else if(busy>.42){const p=w<12?C[3]:(w<26?C[r()<.6?2:3]:C[Math.floor(r()*5)]);i.style.background=p;i.style.opacity=Math.min(1,.35+(busy-.42)*1.4)}el.appendChild(i)}}
