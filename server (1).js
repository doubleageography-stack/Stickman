// Run: node server.js  (no npm install needed) -> http://localhost:3000
const http=require('http'),fs=require('fs'),path=require('path');
// ---- CONFIG: every unresolved rule from the spec lives here ----
const CFG={minP:4,maxP:8,lives:3,
 attackRanges:{3:[45,75],2:[20,45],1:[10,20]},attackCooldown:30,votePenalty:30,
 attackRequiresSameRoom:true,cancelAttackIfTargetInvalid:true,
 invis:[5,7],scoutObserve:5,scoutCd:45,guardDur:20,guardCd:45,
 guardBlockConsumesAttack:true,medicCanSelf:false,medicCapAtMax:true,ventCooldown:0,
 sabCd:30,reactorTime:45,reactorRepairers:2,lightsDur:40,commsDur:40,doorsDur:15,
 meetingTime:45,meetingsPerPlayer:1,meetingPausesTimers:true,revealImposterOnVote:false,
 roleAssignment:'random'};
const ROOMS={Medbay:[60,40,240,180],Cafeteria:[350,40,300,180],Admin:[700,40,240,180],Electrical:[60,380,240,160],Storage:[350,380,300,160],Engine:[700,380,240,160],Reactor:[700,580,240,130]};
const HALLS=[[300,100,50,60],[650,100,50,60],[480,220,40,160],[160,220,40,160],[300,440,50,50],[650,440,50,50],[800,540,40,40],[800,220,40,160]];
const inR=(r,x,y)=>x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];
const roomAt=(x,y)=>{for(const k in ROOMS)if(inR(ROOMS[k],x,y))return k;return HALLS.some(r=>inR(r,x,y))?'Hallway':null};
const ctr=k=>{const r=ROOMS[k];return[r[0]+r[2]/2,r[1]+r[3]/2]};
const SPEED=150;
const VENTS=['Admin','Medbay','Engine','Reactor'];
const SHORT=[['Scan ID','Medbay',3],['Empty trash','Storage',3],['Align dish','Admin',3],['Calibrate','Engine',3],['Wipe table','Cafeteria',3]];
const LONG=[['Fuel engines','Storage',10],['Download data','Electrical',10]];
const COMMON=[['Swipe card','Admin',4],['Fix wires','Electrical',4]];
const CREW=['Engineer','Scout','Guardian Angel','Medic'],IMPS=['Regular Imposter','Phantom'];
const ROLE_ASSIGNERS={random:(n)=>{const r=[];const pool=sh([...CREW]);for(let i=0;i<n-1;i++)r.push(pool[i%4]);return{imp:IMPS[rnd(0,2)|0],crew:sh(r)}}};
function step(g,dt){if(g.phase!=='play'||g.meeting)return;
 for(const p of S(g)){if(!p.alive||!(p.dx||p.dy))continue;
  const ok=(x,y)=>[[0,0],[8,0],[-8,0],[0,8],[0,-8]].every(([a,b])=>roomAt(x+a,y+b))&&!(g.sab&&g.sab.type==='doors'&&roomAt(x,y)===g.sab.room&&p.room!==g.sab.room);
  const nx=p.x+p.dx*SPEED*dt,ny=p.y+p.dy*SPEED*dt;if(ok(nx,p.y))p.x=nx;if(ok(p.x,ny))p.y=ny;
  const r=roomAt(p.x,p.y);if(r&&r!==p.room)go(g,p,r)}}
const sh=a=>a.sort(()=>Math.random()-.5),rnd=(a,b)=>a+Math.random()*(b-a),now=()=>Date.now(),id=()=>Math.random().toString(36).slice(2,10);
const G={};
const S=(g)=>Object.values(g.players),imp=g=>g.players[g.imp];
function msg(g,p,text,kind){if(p){p.msgs.push({t:now(),text,kind});p.msgs=p.msgs.slice(-12)}}
function pub(g,text,kind){S(g).forEach(p=>msg(g,p,text,kind))}
function end(g,winner,why){if(g.phase==='over')return;g.phase='over';g.winner=winner;g.why=why;g.attack=null;g.sab=null;g.meeting=null}
function check(g){if(g.phase==='over'||g.phase==='lobby')return;
 const im=imp(g),crew=S(g).filter(p=>p.team==='crew');
 if(!im.alive)return end(g,'Crewmates','The Imposter lost all lives');
 if(!crew.some(p=>p.alive))return end(g,'Imposter','All Crewmates eliminated');
 const T=crew.flatMap(p=>p.tasks);if(T.every(t=>t.done))end(g,'Crewmates','All tasks completed')}
function lose(g,p){p.lives--;msg(g,p,'ALARM: you lost a life!','alarm');
 if(p.lives<=0){p.alive=false;p.doing=null;pub(g,p.name+' was eliminated.','elim');if(g.attack&&g.attack.target===p.id&&CFG.cancelAttackIfTargetInvalid)g.attack=null}}
function start(g){const ids=Object.keys(g.players),n=ids.length;
 const a=ROLE_ASSIGNERS[CFG.roleAssignment](n);g.imp=ids[rnd(0,n)|0];let k=0;
 const common=COMMON[rnd(0,2)|0];
 for(const i of ids){const p=g.players[i];p.lives=CFG.lives;p.alive=true;p.room='Cafeteria';p.c=ids.indexOf(i);[p.x,p.y]=ctr('Cafeteria');p.x+=(p.c-3.5)*24;p.dx=p.dy=0;p.msgs=[];p.invisUsed=false;p.healUsed=false;p.atkCd=0;p.scoutCd=0;p.guardCd=0;p.meetings=0;
  p.team=i===g.imp?'imp':'crew';p.role=i===g.imp?a.imp:a.crew[k++];
  const mk=(d,kind)=>({id:id(),name:d[0],room:d[1],dur:d[2],kind,done:false,fake:p.team==='imp'});
  const sh2=sh([...SHORT]);p.tasks=[mk(LONG[rnd(0,2)|0],'Long'),mk(common,'Common'),mk(sh2[0],'Short'),mk(sh2[1],'Short')]}
 g.phase='play';g.attack=null;g.sab=null;g.sabCd=now()+CFG.sabCd*1000;g.meeting=null;g.winner=null}
function setAtkTimer(g,target){const r=CFG.attackRanges[target.lives];return rnd(r[0],r[1])*1000}
function resolveMeeting(g){const m=g.meeting,t=now(),tally={};let skip=0;
 for(const v of Object.values(m.votes))v==='skip'?skip++:tally[v]=(tally[v]||0)+1;
 const top=Math.max(0,...Object.values(tally)),w=Object.keys(tally).filter(k=>tally[k]===top);
 if(top>0&&w.length===1&&top>skip){const p=g.players[w[0]];pub(g,p.name+' received the most votes.','vote');
  lose(g,p);if(p.team==='imp'){imp(g).atkCd=Math.max(imp(g).atkCd,t)+CFG.votePenalty*1000;
   if(CFG.revealImposterOnVote)pub(g,p.name+' WAS the Imposter.','vote')}
  else if(CFG.revealImposterOnVote)pub(g,p.name+' was not the Imposter.','vote')}
 else pub(g,'No one received a decisive vote. Nobody loses a life.','vote');
 const d=t-m.start;if(CFG.meetingPausesTimers){if(g.attack)g.attack.end+=d;if(g.sab)g.sab.end+=d;g.sabCd+=d;S(g).forEach(p=>{p.scoutCd+=0;if(p.invisEnd)p.invisEnd+=d})}
 S(g).forEach(p=>p.invisUsed=false);g.meeting=null;check(g)}
function tick(g){const t=now();if(g.phase==='meeting_dummy')return;
 if(g.phase==='play'&&g.meeting){const m=g.meeting;const al=S(g).filter(p=>p.alive);
  if(t>=m.end||al.every(p=>m.votes[p.id]))resolveMeeting(g);return}
 if(g.phase!=='play')return;
 const a=g.attack;if(a&&t>=a.end){g.attack=null;const v=g.players[a.target],im=imp(g);
  if(v.alive){if(v.guard>t){msg(g,g.players[v.guardBy],'Your protection blocked a life-drain!','good');if(CFG.guardBlockConsumesAttack)im.atkCd=t+CFG.attackCooldown*1000}
   else{lose(g,v);im.atkCd=t+CFG.attackCooldown*1000}}}
 S(g).forEach(p=>{if(p.invisEnd&&t>=p.invisEnd){p.invisEnd=0;S(g).filter(q=>q.room===p.room&&q.id!==p.id&&q.alive).forEach(q=>msg(g,q,'The air shimmers and distorts nearby...','warn'))}
  if(p.obs&&t>=p.obs.end){msg(g,p,'Scout report ('+p.obs.room+'): '+(p.obs.log.join('; ')||'nobody came or went'),'scout');p.obs=null}
  if(p.doing&&t>=p.doing.end){const k=p.doing.task;p.doing=null;k.done=true;msg(g,p,'Task done: '+k.name,'good')}});
 const s=g.sab;if(s&&t>=s.end){if(s.type==='reactor')end(g,'Imposter','Reactor meltdown');else g.sab=null}
 if(g.sab&&g.sab.type==='reactor'){const h=g.sab.hands;const ok=Object.keys(h).filter(i=>t-h[i]<5000&&g.players[i].room==='Reactor'&&g.players[i].alive);if(ok.length>=CFG.reactorRepairers){g.sab=null;pub(g,'Reactor repaired!','good')}}
 check(g)}
function act(g,p,d){const t=now();if(g.phase==='lobby')return;if(g.phase==='over')return;
 const A=d.a,tg=g.players[d.target];
 if(A==='dir'){const x=+d.dx||0,y=+d.dy||0,l=Math.max(1,Math.hypot(x,y));p.dx=x/l;p.dy=y/l;return}
 if(A==='meeting'){if(!p.alive||g.meeting||p.meetings>=CFG.meetingsPerPlayer)return;p.meetings++;g.meeting={caller:p.id,start:t,end:t+CFG.meetingTime*1000,votes:{}};S(g).forEach(q=>{q.doing=null});pub(g,p.name+' called a meeting!','meeting');return}
 if(g.meeting){if(A==='vote'&&p.alive&&!g.meeting.votes[p.id]&&(d.target==='skip'||(tg&&tg.alive)))g.meeting.votes[p.id]=d.target;return}
 if(!p.alive)return;
 const sab=g.sab,im=p.team==='imp';
 switch(A){
 case'vent':{if(!(im||p.role==='Engineer')||!VENTS.includes(p.room)||!VENTS.includes(d.room)||d.room===p.room)return;if(t<(p.ventCd||0))return;p.ventCd=t+CFG.ventCooldown*1000;[p.x,p.y]=ctr(d.room);go(g,p,d.room);break}
 case'task':{const k=p.tasks.find(x=>x.id===d.task);if(!k||k.done||p.room!==k.room||p.doing)return;
  if(im){k.done=true;k.fake=true;return msg(g,p,'(Fake) pretended: '+k.name,'info')}
  p.doing={task:k,end:t+k.dur*1000};break}
 case'attack':{if(!im||sab&&0||g.attack||!tg||!tg.alive||tg.id===p.id||t<p.atkCd||p.invisEnd)return;
  if(CFG.attackRequiresSameRoom&&tg.room!==p.room)return msg(g,p,'Target must be in your room','warn');
  g.attack={target:tg.id,end:t+setAtkTimer(g,tg)};msg(g,p,'Draining '+tg.name+'...','info');break}
 case'invis':{if(p.role!=='Phantom'||p.invisUsed||p.invisEnd)return;p.invisUsed=true;p.invisEnd=t+rnd(...CFG.invis)*1000;break}
 case'sabotage':{if(!im||sab||t<g.sabCd)return;const ty=d.type;if(!['lights','comms','doors','reactor'].includes(ty))return;
  const dur={lights:CFG.lightsDur,comms:CFG.commsDur,doors:CFG.doorsDur,reactor:CFG.reactorTime}[ty];
  g.sab={type:ty,end:t+dur*1000,hands:{},room:ty==='doors'?Object.keys(ROOMS)[(rnd(1,7))|0]:null};g.sabCd=t+CFG.sabCd*1000;
  pub(g,{lights:'Lights are out! Fix at Electrical.',comms:'Comms down! Fix at Admin.',doors:'Doors locked: '+g.sab.room+' sealed temporarily.',reactor:'REACTOR MELTDOWN! Repair at Reactor!'}[ty],'sab');break}
 case'repair':{if(im||!sab)return;const need={lights:'Electrical',comms:'Admin',reactor:'Reactor'}[sab.type];if(!need||p.room!==need)return;
  if(sab.type==='reactor'){sab.hands[p.id]=t;msg(g,p,'Holding reactor panel... '+CFG.reactorRepairers+' needed together','info')}else{g.sab=null;pub(g,'Repaired.','good')}break}
 case'scout':{if(p.role!=='Scout'||t<p.scoutCd||!ROOMS[d.room])return;if(sab&&sab.type==='comms')return msg(g,p,'Comms are down!','warn');
  p.scoutCd=t+CFG.scoutCd*1000;p.obs={room:d.room,end:t+CFG.scoutObserve*1000,log:[]};break}
 case'protect':{if(p.role!=='Guardian Angel'||t<p.guardCd||!tg||!tg.alive||tg.id===p.id)return;p.guardCd=t+CFG.guardCd*1000;tg.guard=t+CFG.guardDur*1000;tg.guardBy=p.id;msg(g,p,'Protecting '+tg.name,'good');break}
 case'heal':{if(p.role!=='Medic'||p.healUsed||!tg||!tg.alive||(tg.id===p.id&&!CFG.medicCanSelf))return;
  if(CFG.medicCapAtMax&&tg.lives>=CFG.lives)return msg(g,p,'Target is already at max lives','warn');p.healUsed=true;tg.lives++;msg(g,tg,'You gained a life!','good');msg(g,p,'Healed '+tg.name,'good');break}}
 check(g)}
function go(g,p,room){const old=p.room;p.doing=null;p.room=room;
 if(!p.invisEnd)S(g).forEach(o=>{if(o.obs){if(o.obs.room===old)o.obs.log.push(p.name+' left');if(o.obs.room===room)o.obs.log.push(p.name+' entered')}})}
function view(g,p){const t=now(),dead=!p.alive,im=p.team==='imp',dark=g.sab&&g.sab.type==='lights'&&!im&&!dead;
 const V=dark?90:260,dist=q=>Math.hypot(q.x-p.x,q.y-p.y);
 const occ=S(g).filter(q=>q.id!==p.id&&q.alive&&(dead||!q.invisEnd&&dist(q)<V&&(q.room===p.room||dist(q)<110))).map(q=>({id:q.id,name:dark?'???':q.name,x:q.x,y:q.y,c:q.c,room:dead?q.room:undefined}));
 const T=S(g).filter(q=>q.team==='crew').flatMap(q=>q.tasks);
 const v={now:t,phase:g.phase,code:g.code,host:g.host===p.id,players:S(g).map(q=>({id:q.id,name:q.name,alive:q.alive})),
  progress:[T.filter(x=>x.done).length,T.length],sab:g.sab&&{type:g.sab.type,end:g.sab.end,room:g.sab.room,need:CFG.reactorRepairers},
  meeting:g.meeting&&{end:g.meeting.end,voted:Object.keys(g.meeting.votes).length,mine:g.meeting.votes[p.id]||null},
  msgs:p.msgs,winner:g.winner,why:g.why,cfg:{map:{ROOMS,HALLS},ventRooms:VENTS,min:CFG.minP,rooms:Object.keys(ROOMS)}};
 if(g.phase!=='lobby'){v.me={id:p.id,name:p.name,role:p.role,team:p.team,lives:p.lives,alive:p.alive,room:p.room,x:p.x,y:p.y,c:p.c,vis:V,tasks:p.tasks.map(k=>({id:k.id,name:k.name,room:k.room,kind:k.kind,done:k.done})),
   doing:p.doing&&p.doing.end,invis:p.invisEnd,invisUsed:p.invisUsed,healUsed:p.healUsed,atkCd:p.atkCd,scoutCd:p.scoutCd,guardCd:p.guardCd,sabCd:g.sabCd,
   attacking:im&&g.attack?g.attack.end:0,guarded:p.guard};v.occ=occ;
  if(g.phase==='over')v.roles=S(g).map(q=>[q.name,q.role,q.lives])}
 else v.me={id:p.id,name:p.name};return v}
function push(g){for(const p of S(g))if(p.res)p.res.write('data: '+JSON.stringify(view(g,p))+'\n\n')}
let lt=now();setInterval(()=>{const t=now(),dt=Math.min(.2,(t-lt)/1000);lt=t;for(const g of Object.values(G)){try{step(g,dt);tick(g);push(g)}catch(e){console.error(e)}}},100);
const body=r=>new Promise(res=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b||'{}'))}catch{res({})}})});
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x');
 if(req.method==='GET'&&u.pathname==='/events'){const g=G[u.searchParams.get('g')],p=g&&g.players[u.searchParams.get('p')];if(!p)return res.end();
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});p.res=res;res.write('data: '+JSON.stringify(view(g,p))+'\n\n');req.on('close',()=>{p.res=null});return}
 if(req.method==='POST'){const d=await body(req);let out={};
  if(d.op==='create'||d.op==='join'){let g=d.op==='create'?(G[d.code=Math.random().toString(36).slice(2,6).toUpperCase()]={code:d.code,players:{},phase:'lobby'}):G[(d.code||'').toUpperCase()];
   if(!g||g.phase!=='lobby'||S(g).length>=CFG.maxP)out={error:'Cannot join that game'};
   else{const p={id:id(),name:String(d.name||'Player').slice(0,12),msgs:[]};g.players[p.id]=p;if(d.op==='create')g.host=p.id;out={g:g.code,p:p.id};push(g)}}
  else{const g=G[d.g],p=g&&g.players[d.p];if(!p)out={error:'bad session'};
   else if(d.op==='start'){if(g.host===p.id&&g.phase==='lobby'&&S(g).length>=CFG.minP)start(g)}
   else if(d.op==='act')act(g,p,d);if(g)push(g)}
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(out))}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(__dirname,'index.html')))}).listen(process.env.PORT||3000,()=>console.log('http://localhost:3000'));
