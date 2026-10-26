// Run: node server.js  (no npm install needed) -> http://localhost:3000
const http=require('http'),fs=require('fs'),path=require('path');
// ---- CONFIG: every unresolved rule from the spec lives here ----
const CFG={minP:3,maxP:8,lives:3,
 attackRanges:{3:[45,75],2:[20,45],1:[10,20]},attackCooldown:15,votePenalty:30,
 actionRange:60,buttonRange:100,taskTime:2,healDelay:[45,60],healRefundIfInvalid:true,cancelAttackIfTargetInvalid:true,
 invis:[5,7],scoutObserve:5,scoutCd:45,guardDur:20,guardCd:45,
 guardBlockConsumesAttack:true,medicCanSelf:false,medicCapAtMax:true,ventCooldown:0,
 sabCd:30,reactorTime:45,reactorRepairers:2,reactorHoldTime:3,lightsDur:40,commsDur:40,doorsDur:15,
 meetingTime:75,endMeetingWhenAllVoted:true,meetingsPerPlayer:1,meetingPausesTimers:true,revealImposterOnVote:false,
 roleAssignment:'random',revealTime:7,drainLeash:0};
// revealTime = seconds everyone is frozen while the role-reveal screen plays.
// drainLeash = max px between imposter and target before a drain breaks (0 = off: you can walk away freely while it charges).
// ---- MAP (pixel coords of map.jpg, 1254x1254) ----
const ROOMS={Reactor:[30,50,310,325],Weapons:[905,35,235,230],Cafeteria:[435,255,365,310],Navigation:[997,345,240,325],Electrical:[235,570,260,295],Shields:[55,940,240,250],Engines:[360,930,470,220],Communication:[880,800,350,340]};
const WALK=[[45,70,285,310],[325,130,600,50],[915,50,220,205],[910,248,40,142],[785,355,225,50],[1005,360,215,295],[450,270,340,280],[325,355,135,50],[598,545,45,415],[250,590,230,260],[470,712,355,45],[775,622,235,45],[778,625,47,385],[375,945,445,195],[815,960,80,50],[890,815,325,315],[1025,650,42,175],[155,375,45,590],[70,955,215,220],[280,1022,105,52]];
const SH=14,BLOCK=[[130,55,115,225],[38,60,45,300],[497,325,95,80],[651,325,95,80],[497,430,95,80],[651,430,95,80],[1030,420,135,150],[250,640,150,100],[470,990,215,90],[980,895,130,130],[128,1018,100,100],[965,105,105,105]].map(([x,y,w,h])=>[x+SH,y+SH,Math.max(8,w-2*SH),Math.max(8,h-2*SH)]);
const HALLS=[1,3,4,7,8,10,11,12,14,16,17,19].map(i=>WALK[i]),ovl=(a,b)=>a[0]<b[0]+b[2]&&a[0]+a[2]>b[0]&&a[1]<b[1]+b[3]&&a[1]+a[3]>b[1];
// block the empty corners of each octagonal room (the art has diagonal cut corners)
for(const k in ROOMS){const[x,y,w,h]=ROOMS[k];for(const[sx,sy]of[[0,0],[1,0],[0,1],[1,1]])for(const[u0,u1,v0,v1]of[[0,15,0,31],[15,30,0,16]]){const r=[sx?x+w-u1:x+u0,sy?y+h-v1:y+v0,u1-u0,v1-v0];if(!HALLS.some(q=>ovl(r,[q[0]-30,q[1]-30,q[2]+60,q[3]+60])))BLOCK.push(r)}}
const STAT={Reactor:[150,330],Weapons:[990,235],Cafeteria:[560,535],Navigation:[1040,620],Electrical:[300,800],Shields:[120,1145],Engines:[450,1110],Communication:[980,1090]};
const REP={Electrical:[400,800],Communication:[930,950],Reactor:[290,250]};
const VENT={Reactor:[265,330],Weapons:[1085,230],Cafeteria:[525,530],Navigation:[1135,625],Electrical:[335,820],Shields:[265,1120],Engines:[740,1105],Communication:[925,1060]};
const VENTS=Object.keys(VENT),BTN=[621,276]; // emergency button on the Cafeteria back wall
const inR=(r,x,y)=>x>=r[0]&&x<=r[0]+r[2]&&y>=r[1]&&y<=r[1]+r[3];
const walk=(x,y)=>WALK.some(r=>inR(r,x,y))&&!BLOCK.some(r=>inR(r,x,y));
const roomAt=(x,y)=>{for(const k in ROOMS)if(inR(ROOMS[k],x,y))return k;return'Hallway'};
const SPEED=190,dst=(p,x,y)=>Math.hypot(p.x-x,p.y-y);
const stOf=k=>ST[TASKS[k.key].steps[k.step].st],inRange=(p,k)=>{const q=stOf(k);return dst(p,q[1],q[2])<=q[3]+40};
const repPos=k=>REP[k],ventPos=k=>VENT[k];
const nearest=(g,p)=>{let b=null,bd=CFG.actionRange;for(const q of S(g))if(q.id!==p.id&&q.alive){const d=dst(p,q.x,q.y);if(d<bd){bd=d;b=q}}return b};
// ST: station = [room, x, y, radius] on the art; you can interact within radius+40 px
const ST={eConsole:['Engines',770,1040,34],engine:['Engines',575,1030,90],rPanel:['Reactor',312,140,32],eBoxes:['Electrical',335,690,75],ePanel:['Electrical',460,685,30],
 nConsole:['Navigation',1100,495,75],nTop:['Navigation',1065,375,30],turret:['Weapons',1017,157,60],wPanel:['Weapons',1115,150,30],dish:['Communication',1045,955,85],pad:['Shields',178,1068,60],table:['Cafeteria',545,468,55],
 rCore:['Reactor',105,345,32],wBay:['Weapons',940,230,32],cCoffee:['Cafeteria',460,360,32],nChart:['Navigation',1172,380,32],eSwitch:['Electrical',270,775,32],sGen:['Shields',90,975,32],eValve:['Engines',465,1115,32],cRelay:['Communication',915,835,32],cArray:['Communication',1025,1105,32],
 sabEl:['Electrical',400,800,20],sabCo:['Communication',930,950,20],sabRe:['Reactor',290,250,20]};
// type: timed (server finishes it) | wires, fill (mini-games; server enforces proximity + minimum time)
const T1=(st,type,dur,label)=>({st,type,dur,label});
// types: wires, code, order, fill, aim, switches, clean, mash, dial (all interactive; server enforces proximity + a minimum time)
const TASKS={
 // Common: everyone gets the same one each game
 wires:{name:'Fix wires',kind:'Common',steps:[T1('eBoxes','wires',4,'Match the wires')]},
 dish:{name:'Calibrate dish',kind:'Common',steps:[T1('dish','code',4,'Enter the calibration code')]},
 breakers:{name:'Reset breakers',kind:'Common',steps:[T1('eSwitch','switches',2,'Flip every breaker on'),T1('ePanel','order',2,'Confirm the reset in order')]},
 // Long: 2-3 parts, spread across the ship
 fuel:{name:'Fuel engines',kind:'Long',steps:[T1('rPanel','fill',5,'Fill the canister'),T1('engine','dial',2,'Steady the flow')]},
 data:{name:'Download data',kind:'Long',steps:[T1('ePanel','mash',3,'Tap to download'),T1('nConsole','dial',2,'Align the uplink')]},
 coolant:{name:'Cool the reactor',kind:'Long',steps:[T1('rCore','fill',4,'Fill the coolant tank'),T1('eSwitch','switches',2,'Open the coolant valves'),T1('rPanel','dial',2,'Stabilize the pressure')]},
 course:{name:'Chart a course',kind:'Long',steps:[T1('nConsole','order',2,'Plot the waypoints in order'),T1('nChart','code',3,'Enter the coordinates'),T1('wPanel','switches',2,'Arm the turret ring')]},
 // Short, one part
 shields:{name:'Charge shields',kind:'Short',steps:[T1('pad','code',4,'Route power in order')]},
 table:{name:'Wipe table',kind:'Short',steps:[T1('table','clean',2,'Wipe every stain')]},
 scan:{name:'Scan ID',kind:'Short',steps:[T1('nTop','dial',2,'Lock the scanner on target')]},
 turret:{name:'Clean turret',kind:'Short',steps:[T1('turret','aim',4,'Shoot the debris')]},
 filter:{name:'Clear the filter',kind:'Short',steps:[T1('eValve','order',2,'Open the valves in order')]},
 trash:{name:'Empty the trash',kind:'Short',steps:[T1('cCoffee','clean',2,'Clean up the mess')]},
 antenna:{name:'Boost antenna',kind:'Short',steps:[T1('cArray','mash',3,'Tap to boost the signal')]},
 // Short, two parts
 power:{name:'Divert power',kind:'Short',steps:[T1('ePanel','switches',2,'Flip the breakers'),T1('wPanel','dial',2,'Route the power')]},
 life:{name:'Life support',kind:'Short',steps:[T1('table','clean',2,'Clear the vents'),T1('sGen','switches',2,'Restart the generators')]},
 uplink:{name:'Sync uplink',kind:'Short',steps:[T1('cRelay','mash',3,'Tap to send the data'),T1('nChart','order',2,'Confirm the sync in order')]},
 purge:{name:'Purge exhaust',kind:'Short',steps:[T1('eConsole','mash',3,'Tap to pump out the exhaust'),T1('eValve','switches',2,'Seal the valves')]},
 // Sabotage repairs: never assigned, opened with the Use button next to the repair panel
 _lights:{name:'Restore lights',kind:'Sabotage',steps:[T1('sabEl','switches',1,'Flip every breaker back on')]},
 _comms:{name:'Restore comms',kind:'Sabotage',steps:[T1('sabCo','dial',1,'Tune the signal')]},
 _reactor:{name:'Stabilize reactor',kind:'Sabotage',steps:[T1('sabRe','hold2',0,'Hold the stabilizer')]}};
const LONG=['fuel','data','coolant','course'],COMMON=['wires','dish','breakers'],SHORT=['shields','table','scan','turret','filter','trash','antenna'],SHORT2=['power','life','uplink','purge'];
function fixSab(g,ty){if(g.sab&&g.sab.type===ty){g.sab=null;pub(g,{lights:'Lights restored!',comms:'Comms restored!',reactor:'Reactor stabilized!'}[ty],'good')}}
const CREW=['Engineer','Scout','Guardian Angel','Medic'],IMPS=['Regular Imposter','Phantom'];
const ROLE_ASSIGNERS={random:(n)=>{const r=[];const pool=sh([...CREW]);for(let i=0;i<n-1;i++)r.push(pool[i%4]);return{imp:IMPS[rnd(0,2)|0],crew:sh(r)}}};
function step(g,dt){if((g.phase!=='play'&&g.phase!=='lobby')||g.meeting||now()<(g.revealEnd||0))return;
 for(const p of S(g)){if(!p.alive||!(p.dx||p.dy))continue;
  const ok=(x,y)=>[[0,0],[5,0],[-5,0],[0,5],[0,-5]].every(([a,b])=>walk(x+a,y+b))&&(g.phase!=='lobby'||roomAt(x,y)==='Cafeteria')&&!(g.sab&&g.sab.type==='doors'&&roomAt(x,y)===g.sab.room&&p.room!==g.sab.room);
  const nx=p.x+p.dx*SPEED*dt,ny=p.y+p.dy*SPEED*dt;if(ok(nx,p.y))p.x=nx;if(ok(p.x,ny))p.y=ny;
  const r=roomAt(p.x,p.y);if(r&&r!==p.room)go(g,p,r);if(p.doing&&!inRange(p,p.doing.task))p.doing=null}}
const sh=a=>a.sort(()=>Math.random()-.5),rnd=(a,b)=>a+Math.random()*(b-a),now=()=>Date.now(),id=()=>Math.random().toString(36).slice(2,10);
const G={};
const S=(g)=>Object.values(g.players),imp=g=>g.players[g.imp];
function msg(g,p,text,kind){if(p){p.msgs.push({t:now(),text,kind});p.msgs=p.msgs.slice(-12)}}
function pub(g,text,kind){S(g).forEach(p=>msg(g,p,text,kind))}
function end(g,winner,why){if(g.phase==='over')return;g.phase='over';g.winner=winner;g.why=why;g.attack=null;g.sab=null;g.meeting=null}
function check(g){if(g.phase==='over'||g.phase==='lobby')return;
 const im=imp(g),crew=S(g).filter(p=>p.team==='crew');
 if(!im.alive)return end(g,'Crewmates',im.left?'The Imposter left the game':'The Imposter lost all lives');
 if(!crew.some(p=>p.alive))return end(g,'Imposter','All Crewmates eliminated');
 const T=crew.filter(p=>!p.left).flatMap(p=>p.tasks);if(T.every(t=>t.done))end(g,'Crewmates','All tasks completed')}
function advance(g,p,k){k.step++;const n=TASKS[k.key].steps.length;if(k.step>=n){k.done=true;msg(g,p,'Task complete: '+k.name,'good')}else msg(g,p,k.name+': part '+k.step+' of '+n+' done. Next: '+TASKS[k.key].steps[k.step].label,'good')}
const NCOL=12;
function setProf(g,p,color,hat){if(Number.isInteger(hat)&&hat>=0&&hat<8)p.hat=hat;else if(p.hat==null)p.hat=0;
 const taken=new Set(S(g).filter(q=>q!==p).map(q=>q.c));
 if(Number.isInteger(color)&&color>=0&&color<NCOL&&!taken.has(color))p.c=color;else if(p.c==null||taken.has(p.c))p.c=[...Array(NCOL).keys()].find(i=>!taken.has(i))}
function lose(g,p,nb){p.lives--;msg(g,p,'ALARM: you lost a life!','alarm');
 if(p.lives<=0){p.alive=false;p.doing=null;if(!nb)(g.bodies=g.bodies||[]).push({name:p.name,c:p.c,hat:p.hat,x:p.x,y:p.y});pub(g,p.name+' was eliminated.','elim');if(g.attack&&g.attack.target===p.id&&CFG.cancelAttackIfTargetInvalid)g.attack=null}}
function start(g){const ids=Object.keys(g.players),n=ids.length;
 const a=ROLE_ASSIGNERS[CFG.roleAssignment](n);g.imp=ids[rnd(0,n)|0];let k=0;
 const common=COMMON[rnd(0,COMMON.length)|0];
 for(const i of ids){const p=g.players[i];p.lives=CFG.lives;p.alive=true;p.room='Cafeteria';p.x=621+(p.c-3.5)*20;p.y=318;p.dx=p.dy=0;p.msgs=[];p.invisUsed=false;p.healUsed=false;p.atkCd=0;p.scoutCd=0;p.guardCd=0;p.meetings=0;
  p.team=i===g.imp?'imp':'crew';p.role=i===g.imp?a.imp:a.crew[k++];
  const mk=key=>({id:id(),key,name:TASKS[key].name,kind:TASKS[key].kind,step:0,done:false,fake:p.team==='imp'});const L2=sh([...LONG]),S1=sh([...SHORT]),S2=sh([...SHORT2]);p.tasks=[mk(common),mk(L2[0]),mk(L2[1]),mk(S2[0]),mk(S1[0]),mk(S1[1])]}
 g.revealEnd=now()+CFG.revealTime*1000;g.phase='play';g.attack=null;g.sab=null;g.sabCd=g.revealEnd+CFG.sabCd*1000;g.meeting=null;g.winner=null}
function setAtkTimer(g,target){const r=CFG.attackRanges[target.lives];return rnd(r[0],r[1])*1000}
function resolveMeeting(g){const m=g.meeting,t=now(),tally={};let skip=0;
 for(const v of Object.values(m.votes))v==='skip'?skip++:tally[v]=(tally[v]||0)+1;
 const top=Math.max(0,...Object.values(tally)),w=Object.keys(tally).filter(k=>tally[k]===top);
 if(top>0&&w.length===1&&top>skip){const p=g.players[w[0]];pub(g,p.name+' received the most votes.','vote');
  lose(g,p,1);if(p.team==='imp'){imp(g).atkCd=Math.max(imp(g).atkCd,t)+CFG.votePenalty*1000;
   if(CFG.revealImposterOnVote)pub(g,p.name+' WAS the Imposter.','vote')}
  else if(CFG.revealImposterOnVote)pub(g,p.name+' was not the Imposter.','vote')}
 else pub(g,'No one received a decisive vote. Nobody loses a life.','vote');
 const d=t-m.start;if(CFG.meetingPausesTimers){if(g.attack){g.attack.end+=d;g.attack.start+=d}if(g.sab)g.sab.end+=d;g.sabCd+=d;S(g).forEach(p=>{if(p.heal)p.heal.end+=d;if(p.invisEnd)p.invisEnd+=d})}
 S(g).forEach(p=>p.invisUsed=false);g.meeting=null;check(g)}
function tick(g){const t=now();if(g.phase==='meeting_dummy')return;
 if(g.phase==='play'&&g.meeting){const m=g.meeting;const al=S(g).filter(p=>p.alive&&(p.res||t-(p.dropAt||0)<8000)); // dropped connections stop blocking the meeting after an 8s grace
  if(t>=m.end||(CFG.endMeetingWhenAllVoted&&al.every(p=>m.votes[p.id])))resolveMeeting(g);return}
 if(g.phase!=='play')return;
 if(g.attack&&CFG.drainLeash){const v0=g.players[g.attack.target];if(!v0||dst(imp(g),v0.x,v0.y)>CFG.drainLeash){msg(g,imp(g),'Target slipped away - drain broken','warn');g.attack=null}}
 const a=g.attack;if(a&&t>=a.end){g.attack=null;const v=g.players[a.target],im=imp(g);
  if(v.alive){if(v.guard>t){msg(g,g.players[v.guardBy],'Your protection blocked a life-drain!','good');if(CFG.guardBlockConsumesAttack)im.atkCd=t+CFG.attackCooldown*1000}
   else{lose(g,v);im.atkCd=t+CFG.attackCooldown*1000}}}
 S(g).forEach(p=>{if(p.invisEnd&&t>=p.invisEnd){p.invisEnd=0;S(g).filter(q=>q.room===p.room&&q.id!==p.id&&q.alive).forEach(q=>msg(g,q,'The air shimmers and distorts nearby...','warn'))}
  if(p.obs&&g.sab&&g.sab.type==='comms'){p.obs=null;msg(g,p,'The cameras went offline!','warn')}
  if(p.obs&&t>=p.obs.end){msg(g,p,'Scout report ('+p.obs.room+'): '+(p.obs.log.join('; ')||'nobody came or went'),'scout');p.obs=null}
  if(p.heal&&t>=p.heal.end){const v=g.players[p.heal.target];p.heal=null;if(v.alive){if(v.lives<CFG.lives||!CFG.medicCapAtMax){v.lives++;msg(g,v,'You gained a life!','good')}msg(g,p,'Your heal landed.','good')}else if(CFG.healRefundIfInvalid)p.healUsed=false}
  if(p.doing){const dg=p.doing;if(dg.type==='fill'){const dt=Math.min(.5,(t-dg.last)/1000);dg.last=t;dg.st.v=Math.max(0,Math.min(100,dg.st.v+(dg.st.hold?22/CFG.taskTime:-8)*dt));if(dg.st.v>=100)dg.solved=1}
   if((dg.type==='timed'&&t>=dg.end)||(dg.solved&&t>=dg.min)){const k=dg.task;p.doing=null;if(k.sab)fixSab(g,k.sab);else advance(g,p,k)}}});
 const s=g.sab;if(s&&t>=s.end){if(s.type==='reactor')end(g,'Imposter','Reactor meltdown');else g.sab=null}
 if(g.sab&&g.sab.type==='reactor'){const dt2=Math.min(.5,(t-(g.rlt||t))/1000);g.rlt=t;const hs=S(g).filter(q=>q.alive&&q.doing&&q.doing.type==='hold2'&&q.doing.st.hold).length;
  g.sab.prog=Math.max(0,Math.min(100,(g.sab.prog||0)+(hs>=CFG.reactorRepairers?100/CFG.reactorHoldTime:-35)*dt2));
  S(g).forEach(q=>{if(q.doing&&q.doing.type==='hold2')q.doing.st.v=g.sab.prog});if(g.sab.prog>=100)fixSab(g,'reactor')}else g.rlt=0;
 S(g).forEach(q=>{if(q.doing&&q.doing.task.sab&&!(g.sab&&g.sab.type===q.doing.task.sab))q.doing=null});
 check(g)}
const R2=()=>20+(rnd(0,60)|0);
function startDoing(g,p,k,t){const sp=TASKS[k.key].steps[k.step],T=sp.type,R=()=>20+(rnd(0,60)|0),N=(a,b)=>a+(rnd(0,b-a+1)|0);
 const st=T==='wires'?{right:sh([0,1,2,3]),done:[0,0,0,0]}:T==='fill'||T==='hold2'?{v:0,hold:0}:T==='aim'?{n:0,x:R(),y:R()}:T==='code'?{seq:[0,0,0,0,0,0].map(()=>rnd(0,9)|0),i:0}
  :T==='switches'?{on:sh([0,0,0,1,0])}:T==='clean'?{sp:Array.from({length:6},()=>[N(8,72),N(8,66)]),gone:[0,0,0,0,0,0]}:T==='mash'?{n:0,need:N(18,24)}
  :T==='dial'?{n:0,need:3,miss:0,t:R(),w:11}:T==='order'?{grid:sh([1,2,3,4,5,6,7,8,9]),i:0}:null;
 const D=sp.dur*CFG.taskTime*1000;p.doing={task:k,type:T,start:t,min:t+D,end:T==='timed'?t+D:0,step:k.step,st,last:t}}
function act(g,p,d){const t=now();
 if(g.phase==='lobby'){if(d.a==='dir'){const x=+d.dx||0,y=+d.dy||0,l=Math.max(1,Math.hypot(x,y));p.dx=x/l;p.dy=y/l}else if(d.a==='chat'){const x=String(d.text||'').trim().slice(0,120);if(x&&t-(p.lastChat||0)>600){p.lastChat=t;g.lchat.push({n:p.name,c:p.c,x});g.lchat=g.lchat.slice(-60)}}return}
 if(g.phase==='over')return;
 const A=d.a,tg=g.players[d.target];
 if(A==='dir'){const x=+d.dx||0,y=+d.dy||0,l=Math.max(1,Math.hypot(x,y));p.dx=x/l;p.dy=y/l;return}
 if(g.revealEnd>t)return; // everyone is frozen during the role reveal
 if(A==='report'){const b=(g.bodies||[]).find(b=>dst(p,b.x,b.y)<=CFG.buttonRange);if(!p.alive||g.meeting||!b)return;g.meeting={caller:p.id,start:t,end:t+CFG.meetingTime*1000,votes:{},chat:[]};S(g).forEach(q=>{q.doing=null;q.dx=q.dy=0});g.bodies=[];pub(g,p.name+' reported '+b.name+"'s body!",'meeting');return}
 if(A==='meeting'){if(!p.alive||g.meeting||p.meetings>=CFG.meetingsPerPlayer||dst(p,BTN[0],BTN[1])>CFG.buttonRange)return;p.meetings++;g.bodies=[];g.meeting={caller:p.id,start:t,end:t+CFG.meetingTime*1000,votes:{},chat:[]};S(g).forEach(q=>{q.doing=null;q.dx=q.dy=0});pub(g,p.name+' called a meeting!','meeting');return}
 if(g.meeting){if(A==='chat'&&p.alive){const x=String(d.text||'').trim().slice(0,120);if(x&&t-(p.lastChat||0)>600){p.lastChat=t;g.meeting.chat.push({n:p.name,c:p.c,x});g.meeting.chat=g.meeting.chat.slice(-60)}}if(A==='vote'&&p.alive&&!g.meeting.votes[p.id]&&(d.target==='skip'||(tg&&tg.alive)))g.meeting.votes[p.id]=d.target;return}
 if(!p.alive)return;
 const sab=g.sab,im=p.team==='imp';
 switch(A){
 case'vent':{if(!(im||p.role==='Engineer')||!VENTS.includes(p.room)||!VENTS.includes(d.room)||d.room===p.room||dst(p,...ventPos(p.room))>CFG.actionRange)return;if(t<(p.ventCd||0))return;p.ventCd=t+CFG.ventCooldown*1000;[p.x,p.y]=ventPos(d.room);go(g,p,d.room);break}
 case'task':{const k=p.tasks.find(x=>x.id===d.task);if(!k||k.done||p.doing||!inRange(p,k))return;startDoing(g,p,k,t);break}
 case'wire':{const dg=p.doing;if(!dg||dg.type!=='wires'||!inRange(p,dg.task))return;const l=+d.l,r=+d.r;if(l>=0&&l<4&&r>=0&&r<4&&dg.st.right[r]===l&&!dg.st.done[l]){dg.st.done[l]=1;if(dg.st.done.every(x=>x))dg.solved=1}break}
 case'hold':{const dg=p.doing;if(dg&&(dg.type==='fill'||dg.type==='hold2')&&inRange(p,dg.task))dg.st.hold=d.on?1:0;break}
 case'aim':{const dg=p.doing;if(!dg||dg.type!=='aim'||!inRange(p,dg.task))return;if(Math.hypot((+d.x)-dg.st.x,(+d.y)-dg.st.y)<=10){dg.st.n++;if(dg.st.n>=5)dg.solved=1;else{dg.st.x=R2();dg.st.y=R2()}}break}
 case'tap':{const dg=p.doing;if(!dg||dg.type!=='code'||!inRange(p,dg.task))return;if(dg.st.seq[dg.st.i]===+d.k)dg.st.i++;else dg.st.i=0;if(dg.st.i>=dg.st.seq.length)dg.solved=1;break}
 case'sw':{const dg=p.doing;if(!dg||dg.type!=='switches'||!inRange(p,dg.task))return;const i=+d.i;if(i>=0&&i<dg.st.on.length){dg.st.on[i]=dg.st.on[i]?0:1;if(dg.st.on.every(x=>x))dg.solved=1}break}
 case'clean':{const dg=p.doing;if(!dg||dg.type!=='clean'||!inRange(p,dg.task))return;const i=+d.i;if(dg.st.sp[i]&&!dg.st.gone[i]){dg.st.gone[i]=1;if(dg.st.gone.every(x=>x))dg.solved=1}break}
 case'mash':{const dg=p.doing;if(!dg||dg.type!=='mash'||!inRange(p,dg.task))return;dg.st.n=Math.min(dg.st.need,dg.st.n+1);if(dg.st.n>=dg.st.need)dg.solved=1;break}
 case'dial':{const dg=p.doing;if(!dg||dg.type!=='dial'||!inRange(p,dg.task))return;if(Math.abs((+d.v)-dg.st.t)<=dg.st.w){dg.st.n++;dg.st.t=R2();dg.st.w=Math.max(7,dg.st.w-2);if(dg.st.n>=dg.st.need)dg.solved=1}else dg.st.miss++;break}
 case'ord':{const dg=p.doing;if(!dg||dg.type!=='order'||!inRange(p,dg.task))return;if(+d.k===dg.st.i+1){dg.st.i++;if(dg.st.i>=9)dg.solved=1}else dg.st.i=0;break}
 case'cancel':{p.doing=null;break}
 case'attack':{const t2=nearest(g,p);if(!im||g.attack||!t2||t<p.atkCd||p.invisEnd)return;const len=setAtkTimer(g,t2);g.attack={target:t2.id,start:t,end:t+len};msg(g,p,'Draining '+t2.name+'...','info');break}
 case'invis':{if(p.role!=='Phantom'||p.invisUsed||p.invisEnd)return;p.invisUsed=true;p.invisEnd=t+rnd(...CFG.invis)*1000;break}
 case'sabotage':{if(!im||sab||t<g.sabCd)return;const ty=d.type;if(!['lights','comms','doors','reactor'].includes(ty))return;
  const dur={lights:CFG.lightsDur,comms:CFG.commsDur,doors:CFG.doorsDur,reactor:CFG.reactorTime}[ty];
  g.sab={type:ty,end:t+dur*1000,hands:{},room:ty==='doors'?Object.keys(ROOMS)[(rnd(1,7))|0]:null};g.sabCd=t+CFG.sabCd*1000;
  pub(g,{lights:'Lights are out! Fix at Electrical.',comms:'Comms down! Fix at Communication.',doors:'Doors locked: '+g.sab.room+' sealed temporarily.',reactor:'REACTOR MELTDOWN! Repair at Reactor!'}[ty],'sab');break}
 case'repair':{if(!sab||p.doing||im)return;const need={lights:'Electrical',comms:'Communication',reactor:'Reactor'}[sab.type];if(!need||p.room!==need||dst(p,...repPos(need))>CFG.actionRange)return;
  const key='_'+sab.type;startDoing(g,p,{id:'sab',key,name:TASKS[key].name,kind:'Sabotage',step:0,done:false,sab:sab.type},t);break}
 case'scout':{if(p.role!=='Scout'||t<p.scoutCd||!ROOMS[d.room])return;if(sab&&sab.type==='comms')return msg(g,p,'Comms are down!','warn');
  p.scoutCd=t+CFG.scoutCd*1000;p.obs={room:d.room,end:t+CFG.scoutObserve*1000,log:[]};break}
 case'protect':{const g2=nearest(g,p);if(p.role!=='Guardian Angel'||t<p.guardCd||!g2)return;p.guardCd=t+CFG.guardCd*1000;g2.guard=t+CFG.guardDur*1000;g2.guardBy=p.id;msg(g,p,'Protecting '+g2.name,'good');break}
 case'heal':{const h2=nearest(g,p);if(p.role!=='Medic'||p.healUsed||p.heal||!h2)return;if(CFG.medicCapAtMax&&h2.lives>=CFG.lives)return msg(g,p,'Target is already at max lives','warn');p.healUsed=true;p.heal={target:h2.id,end:t+rnd(...CFG.healDelay)*1000};msg(g,p,'Healing '+h2.name+'... stay patient','good');break}}
 check(g)}
function leaveGame(g,p){if(p.res){try{p.res.end()}catch{}p.res=null}
 if(g.phase==='lobby'){delete g.players[p.id];if(g.host===p.id)g.host=Object.keys(g.players)[0];if(!S(g).length)delete G[g.code];return}
 if(p.left)return;p.left=true;if(p.alive){p.alive=false;p.lives=0;p.doing=null;p.dx=p.dy=0}
 if(g.attack&&g.attack.target===p.id)g.attack=null;
 if(S(g).every(q=>q.left)){delete G[g.code];return}
 if(g.phase==='play')pub(g,p.name+' left the game.','info');check(g)}
function go(g,p,room){const old=p.room;p.doing=null;p.room=room;
 if(!p.invisEnd)S(g).forEach(o=>{if(o.obs){if(o.obs.room===old)o.obs.log.push(p.name+' left');if(o.obs.room===room)o.obs.log.push(p.name+' entered')}})}
function view(g,p){const t=now(),dead=!p.alive,im=p.team==='imp',dark=g.sab&&g.sab.type==='lights'&&!im&&!dead;
 const V=g.phase==='lobby'?99999:dark?90:260,dist=q=>Math.hypot(q.x-p.x,q.y-p.y);
 const occ=S(g).filter(q=>q.id!==p.id&&q.alive&&(dead||!q.invisEnd&&dist(q)<V&&(q.room===p.room||dist(q)<110))).map(q=>({id:q.id,name:dark?'???':q.name,x:Math.round(q.x),y:Math.round(q.y),c:q.c,h:q.hat,room:dead?q.room:undefined}));
 const T=S(g).filter(q=>q.team==='crew'&&!q.left).flatMap(q=>q.tasks);
 const v={now:t,phase:g.phase,code:g.code,host:g.host===p.id,players:S(g).map(q=>({id:q.id,name:q.name,alive:q.alive,c:q.c,h:q.hat})),
  progress:[T.reduce((a,x)=>a+x.step,0),T.reduce((a,x)=>a+TASKS[x.key].steps.length,0)],sab:g.sab&&{type:g.sab.type,end:g.sab.end,room:g.sab.room,need:CFG.reactorRepairers,prog:Math.round(g.sab.prog||0)},
  meeting:g.meeting&&{chat:g.meeting.chat,end:g.meeting.end,voted:Object.keys(g.meeting.votes).length,mine:g.meeting.votes[p.id]||null},
  msgs:p.msgs,reveal:g.revealEnd||0,winner:g.winner,why:g.why,cfg:p.cfgSent?undefined:{map:{ROOMS,st:ST,rep:REP,btn:BTN,halls:HALLS,vent:VENT,walk:WALK,block:BLOCK},speed:SPEED,ventRooms:VENTS,min:CFG.minP,rooms:Object.keys(ROOMS)}};
 if(g.phase!=='lobby'){const nt=nearest(g,p),ni=p.tasks.findIndex(k=>!k.done&&inRange(p,k)),rp=g.sab&&{lights:'Electrical',comms:'Communication',reactor:'Reactor'}[g.sab.type];
  v.me={cam:p.obs&&{room:p.obs.room,end:p.obs.end,list:S(g).filter(q=>q.alive&&!q.invisEnd&&roomAt(q.x,q.y)===p.obs.room).map(q=>({x:q.x,y:q.y,c:q.c,h:q.hat})),bodies:(g.bodies||[]).filter(b=>roomAt(b.x,b.y)===p.obs.room).map(b=>({x:b.x,y:b.y,c:b.c,h:b.hat}))},hat:p.hat,healing:p.heal&&p.heal.end,near:{body:p.alive&&!g.meeting&&(g.bodies||[]).some(b=>dst(p,b.x,b.y)<=CFG.buttonRange)?1:0,btn:p.alive&&!g.meeting&&p.meetings<CFG.meetingsPerPlayer&&dst(p,BTN[0],BTN[1])<=CFG.buttonRange,tgt:nt&&nt.name,task:ni>=0?p.tasks[ni].id:null,vent:(im||p.role==='Engineer')&&VENTS.includes(p.room)&&dst(p,...ventPos(p.room))<=CFG.actionRange,repair:!im&&!!rp&&p.room===rp&&dst(p,...repPos(rp))<=CFG.actionRange},id:p.id,name:p.name,role:p.role,team:p.team,lives:p.lives,alive:p.alive,room:p.room,x:Math.round(p.x),y:Math.round(p.y),c:p.c,vis:V,tasks:p.tasks.map(k=>{const sp=!k.done&&TASKS[k.key].steps[k.step];return{id:k.id,name:k.name,kind:k.kind,done:k.done,step:k.step,steps:TASKS[k.key].steps.length,label:sp&&sp.label,type:sp&&sp.type,room:sp&&ST[sp.st][0],st:sp&&sp.st}}),
   doing:p.doing&&p.doing.end,dg:p.doing&&{id:p.doing.task.id,type:p.doing.type,min:p.doing.min,start:p.doing.start,end:p.doing.end,state:p.doing.st,name:p.doing.task.name,key:p.doing.task.key,stp:p.doing.step,label:TASKS[p.doing.task.key].steps[p.doing.step].label},invis:p.invisEnd,invisUsed:p.invisUsed,healUsed:p.healUsed,atkCd:p.atkCd,scoutCd:p.scoutCd,guardCd:p.guardCd,sabCd:g.sabCd,
   attacking:im&&g.attack?g.attack.end:0,atkTgt:im&&g.attack?g.attack.target:null,atkLen:im&&g.attack?g.attack.end-g.attack.start:0,guarded:p.guard};v.occ=occ;v.bodies=(g.bodies||[]).filter(b=>dead||dist(b)<V).map(b=>({x:b.x,y:b.y,c:b.c,h:b.hat}));
  if(g.phase==='over')v.roles=S(g).map(q=>[q.name,q.role,q.lives])}
 else{v.me={id:p.id,name:p.name,x:p.x,y:p.y,c:p.c,hat:p.hat,vis:99999,near:{},tasks:[],alive:true};v.occ=occ;v.lchat=g.lchat}return v}
function push(g){for(const p of S(g))if(p.res){p.res.write('data: '+JSON.stringify(view(g,p))+'\n\n');p.cfgSent=true}}
let lt=now();setInterval(()=>{const t=now(),dt=Math.min(.2,(t-lt)/1000);lt=t;for(const g of Object.values(G)){try{step(g,dt);tick(g);push(g)}catch(e){console.error(e)}}},50);
const body=r=>new Promise(res=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>{try{res(JSON.parse(b||'{}'))}catch{res({})}})});
const srv=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x');
 if(req.method==='GET'&&u.pathname==='/events'){const g=G[u.searchParams.get('g')],p=g&&g.players[u.searchParams.get('p')];if(!p)return res.end();
  res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});p.res=res;p.cfgSent=false;res.write('data: '+JSON.stringify(view(g,p))+'\n\n');p.cfgSent=true;req.on('close',()=>{if(p.res===res){p.res=null;p.dropAt=now()}});return}
 if(req.method==='POST'){const d=await body(req);let out={};
  if(d.op==='create'||d.op==='join'){let g;if(d.op==='create'){let c;do{c=String(1000+(Math.random()*9000|0))}while(G[c]);g=G[c]={code:c,players:{},phase:'lobby',lchat:[],bodies:[]}}else g=G[String(d.code||'').replace(/\D/g,'')];
   if(!g||g.phase!=='lobby'||S(g).length>=CFG.maxP)out={error:'Cannot join that game'};
   else{const p={id:id(),name:String(d.name||'Player').replace(/[<>&"'`]/g,'').slice(0,12)||'Player',msgs:[],alive:true,lives:CFG.lives,room:'Cafeteria',x:621+(Math.random()*140-70),y:300+Math.random()*22,dx:0,dy:0};setProf(g,p,d.color,d.hat);g.players[p.id]=p;if(d.op==='create')g.host=p.id;out={g:g.code,p:p.id};push(g)}}
  else{const g=G[d.g],p=g&&g.players[d.p];if(!p)out={error:'bad session'};
   else if(d.op==='profile'){if(g.phase==='lobby')setProf(g,p,d.color,d.hat)}
   else if(d.op==='start'){if(g.host===p.id&&g.phase==='lobby'&&S(g).length>=CFG.minP)start(g)}
   else if(d.op==='leave')leaveGame(g,p);else if(d.op==='act')act(g,p,d);if(g)push(g)}
  res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(out))}
 if(u.pathname==='/map'){const f=['map.jpg','map.png'].map(n=>path.join(__dirname,n)).find(fs.existsSync);if(f){res.writeHead(200,{'Content-Type':f.endsWith('jpg')?'image/jpeg':'image/png','Cache-Control':'max-age=3600'});return res.end(fs.readFileSync(f))}}
 res.writeHead(200,{'Content-Type':'text/html'});res.end(fs.readFileSync(path.join(__dirname,'index.html')))});srv.on('connection',s=>s.setNoDelay(true));srv.listen(process.env.PORT||3000,()=>console.log('http://localhost:3000'));
