const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),vm=require('node:vm');
const {fixture,seed,password,pendingRequest,sleep,root}=require('./helpers.cjs');
const ch='/api/channels/'+encodeURIComponent('校园跑')+'/messages';

test('ordinary users cannot read admin data; admin name is case sensitive',()=>fixture(async({call})=>{
 assert.equal((await call('/api/admin/overview','Alice')).status,403);
 assert.equal((await call('/api/register','',{username:'aevonecho',password})).status,409);
 assert.equal((await call('/api/me','AevonEcho')).data.admin,true);
}));
test('same-name registration cannot inherit any old offer history or summary',()=>fixture(async({call,task,act})=>{
 const m=await task();const o=await act(m,'Bob','offer',{price:15,note:'private old account note'});assert.equal(o.status,200);
 await call('/api/admin/users/Bob/delete','AevonEcho',{});
 assert.equal((await call('/api/me','Bob')).status,401);
 const registration=await call('/api/register','',{username:'Bob',password:'differentpass'});assert.equal(registration.status,200);const token=registration.data.token;
 assert.deepEqual((await call(ch+'/'+m.id+'/offers',token)).data.offers,[]);
 const messages=(await call(ch+'?rev=0',token)).data;assert.equal(messages.find(x=>x.id===m.id).myOffer,undefined);
 assert.equal((await call(ch+'/'+m.id+'/offers/'+o.data.offer.id+'/withdraw',token,{})).status,403);
 const admin=(await call(ch+'/'+m.id+'/offers','AevonEcho')).data.offers;assert.equal(admin.length,1);assert.equal(admin[0].rounds[0].note,'private old account note');
}));
test('legacy offer migration isolates records older than the current account',async()=>{
 const data=seed(),id=1234567890123456;data.messages['校园跑']=[{id,user:'Alice',text:'old task',task:true,time:new Date(Date.now()-172800000).toISOString()}];
 data.offers={[id]:[{id:id+1,user:'Bob',status:'withdrawn',price:8,turn:'poster',time:new Date(Date.now()-172800000).toISOString(),updated:new Date().toISOString(),rounds:[{by:'claimer',price:8,note:'old',time:new Date().toISOString()}]}]};
 await fixture(async({call})=>{assert.deepEqual((await call(ch+'/'+id+'/offers','Bob')).data.offers,[]);assert.equal((await call(ch+'/'+id+'/offers','AevonEcho')).data.offers.length,1)},data);
});
test('existing active offers migrate and remain actionable',async()=>{
 const data=seed(),id=1234567890123456;data.messages['校园跑']=[{id,user:'Alice',text:'old task',task:true,time:new Date().toISOString()}];
 data.offers={[id]:[{id:id+1,user:'Bob',status:'pending',price:8,turn:'poster',time:new Date().toISOString(),updated:new Date().toISOString(),rounds:[{by:'claimer',price:8,note:'valid',time:new Date().toISOString()}]}]};
 await fixture(async({call})=>{assert.equal((await call(ch+'/'+id+'/offers','Bob')).data.offers.length,1);assert.equal((await call(ch+'/'+id+'/offers/'+(id+1)+'/accept','Alice',{})).data.task.claimedBy,'Bob')},data);
});
test('sub-cent offers cannot round into a free claim',()=>fixture(async({task,act})=>{
 const m=await task();for(const price of [0.001,0.009,0,-1,'',null,100001])assert.equal((await act(m,'Bob','offer',{price})).status,400,String(price));
 const valid=await act(m,'Bob','offer',{price:0.01});assert.equal(valid.status,200);assert.equal(valid.data.offer.price,0.01);
}));
test('former claimer cannot freeze a replacement order using a slow dispute body',()=>fixture(async({base,task,act,call})=>{
 const m=await task();await act(m,'Bob','claim');const pending=pendingRequest(base,ch+'/'+m.id+'/dispute','Bob','{"reason":"');
 try{await sleep(70);await act(m,'Alice','release');await act(m,'Carol','claim');pending.req.end('stale dispute"}');const result=await pending.response;assert.equal(result.status,403);
 const current=(await call('/api/admin/messages','AevonEcho')).data.find(x=>x.id===m.id);assert.equal(current.status,'claimed');assert.equal(current.dispute,undefined);
 }finally{pending.req.destroy()}
}));
test('slow task submission cannot outlive logout or a ban',()=>fixture(async({base,call})=>{
 for(const mode of ['logout','ban']){const n=mode==='logout'?'Bob':'Carol',pending=pendingRequest(base,ch,n,'{"task":true,"text":"');
  try{await sleep(50);if(mode==='logout')await call('/api/logout',n,{});else await call('/api/admin/users/'+n+'/ban','AevonEcho',{reason:'test'});pending.req.end('must not publish"}');assert.equal((await pending.response).status,mode==='logout'?401:403)}finally{pending.req.destroy()}
 }
 assert.equal((await call(ch+'?rev=0')).data.length,0);
}));
test('in-flight password verification cannot log into a replacement account',()=>fixture(async({call,waitForCrypto,releaseCrypto})=>{
 const login=call('/api/login','',{username:'Bob',password});await waitForCrypto();await call('/api/admin/users/Bob/delete','AevonEcho',{});
 const registration=await call('/api/register','',{username:'Bob',password:'replacementpass'});assert.equal(registration.status,200);await releaseCrypto();assert.equal((await login).status,401);
 assert.equal((await call('/api/login','',{username:'Bob',password:'replacementpass'})).status,200);
},seed(),{gateScryptCall:1}));
for(const gateScryptCall of [1,2])test('in-flight password change cannot overwrite replacement account at crypto step '+gateScryptCall,()=>fixture(async({call,waitForCrypto,releaseCrypto})=>{
 const change=call('/api/password','Bob',{oldPassword:password,newPassword:'attackerpass'});await waitForCrypto();await call('/api/admin/users/Bob/delete','AevonEcho',{});
 assert.equal((await call('/api/register','',{username:'Bob',password:'replacementpass'})).status,200);await releaseCrypto();assert.equal((await change).status,401);
 assert.equal((await call('/api/login','',{username:'Bob',password:'replacementpass'})).status,200);assert.equal((await call('/api/login','',{username:'Bob',password:'attackerpass'})).status,401);
},seed(),{gateScryptCall}));
test('image upload rechecks logout and ban after reading its body',()=>fixture(async({base,call,task,act})=>{
 for(const mode of ['logout','ban']){const n=mode==='logout'?'Bob':'Carol',m=await task();await act(m,n,'claim');const pending=pendingRequest(base,'/api/tasks/'+m.id+'/chat/image',n,'{"data":"');
  try{await sleep(50);if(mode==='logout')await call('/api/logout',n,{});else await call('/api/admin/users/'+n+'/ban','AevonEcho',{reason:'test'});pending.req.end('iVBORw0KGgo="}');assert.equal((await pending.response).status,mode==='logout'?401:403)}finally{pending.req.destroy()}
  assert.ok(!(await call('/api/tasks/'+m.id+'/chat','AevonEcho')).data.messages.some(x=>x.image));
 }
}));
test('slow admin force request cannot modify an already deleted task',()=>fixture(async({base,call,task,act})=>{
 const m=await task();await act(m,'Bob','claim');const pending=pendingRequest(base,'/api/admin/tasks/'+m.id+'/force','AevonEcho','{"action":"');
 try{await sleep(50);await act(m,'AevonEcho','delete');pending.req.end('done"}');assert.equal((await pending.response).status,404)}finally{pending.req.destroy()}
}));
test('admin participant sees all former claimer chats and images; replacement does not',()=>fixture(async({base,task,act,call})=>{
 const m=await task('AevonEcho');await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat','Bob',{text:'former private evidence'});
 const image=await call('/api/tasks/'+m.id+'/chat/image','Bob',{data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII='});assert.equal(image.status,200);
 await act(m,'Bob','unclaim');await act(m,'Carol','claim');await call('/api/tasks/'+m.id+'/chat','Carol',{text:'current evidence'});
 const admin=(await call('/api/tasks/'+m.id+'/chat','AevonEcho')).data.messages;assert.ok(admin.some(x=>x.text==='former private evidence'));assert.ok(admin.some(x=>x.image));
 const replacement=(await call('/api/tasks/'+m.id+'/chat','Carol')).data.messages;assert.ok(!replacement.some(x=>x.text==='former private evidence'||x.image));
 const adminImage=await fetch(base+'/api/tasks/'+m.id+'/chat/image/'+image.data.id,{headers:{Authorization:'Bearer AevonEcho'}});assert.equal(adminImage.status,200);assert.equal(adminImage.headers.get('content-type'),'image/png');assert.ok((await adminImage.arrayBuffer()).byteLength>8);
 const r=await call('/api/tasks/'+m.id+'/chat/image/'+image.data.id,'Carol');assert.equal(r.status,404);
}));
for(const mode of ['unclaim','release','delete-account'])test('negotiated reward resets on '+mode,()=>fixture(async({call,task,act})=>{
 const m=await task(),o=(await act(m,'Bob','offer',{price:25})).data.offer;
 assert.equal((await call(ch+'/'+m.id+'/offers/'+o.id+'/accept','Alice',{})).status,200);
 if(mode==='delete-account')await call('/api/admin/users/Bob/delete','AevonEcho',{});else await act(m,mode==='unclaim'?'Bob':'Alice',mode);
 const r=await act(m,'Carol','claim');assert.equal(r.status,200);assert.equal(r.data.reward,'10元');assert.equal(r.data.negotiated,undefined);assert.equal(r.data.offerId,undefined);
 const history=(await call(ch+'/'+m.id+'/offers','AevonEcho')).data.offers;assert.equal(history[0].price,25);assert.equal(history[0].status,'accepted');
}));
test('cancellation refunds once and insufficient points return 402',()=>fixture(async({call,task,act})=>{
 const m=await task();assert.equal((await call('/api/my/points')).data.points,99);assert.equal((await act(m,'Alice','cancel')).status,200);assert.equal((await act(m,'Alice','cancel')).status,409);assert.equal((await call('/api/my/points')).data.points,100);
 await call('/api/admin/users/Bob/points','AevonEcho',{delta:-100});assert.equal((await call(ch,'Bob',{text:'no funds',task:true})).status,402);
}));
test('bonus tasks require the poster and reward only once; recharge approves once',()=>fixture(async({call,task,act})=>{
 const m=await task('AevonEcho',{bonusPoints:7});await act(m,'Bob','claim');assert.equal((await act(m,'Bob','complete')).status,403);assert.equal((await act(m,'AevonEcho','complete')).status,200);assert.equal((await act(m,'AevonEcho','complete')).status,409);assert.equal((await call('/api/my/points','Bob')).data.points,106);
 const recharge=(await call('/api/recharge','Bob',{amount:3,method:'alipay'})).data;
 assert.equal((await call('/api/admin/recharges/'+recharge.id+'/approve','AevonEcho',{points:3})).status,200);assert.equal((await call('/api/admin/recharges/'+recharge.id+'/approve','AevonEcho',{points:3})).status,409);assert.equal((await call('/api/my/points','Bob')).data.points,109);
}));
test('IDs exceed all legacy records and stay increasing across restart and clock rollback',async()=>{
 const data=seed(),future=Date.now()*1000+86400000000;data.feedback=[{id:String(future),user:'Alice',text:'seed',time:new Date().toISOString()}];
 await fixture(async({task,restart})=>{let last=future;for(let i=0;i<5;i++){const m=await task();assert.ok(m.id>last);last=m.id}await restart();assert.ok((await task()).id>last)},data);
});
test('successful mutations are on disk before acknowledgement and survive restart',()=>fixture(async({call,task,tmp,restart})=>{
 const m=await task(),saved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8'));
 assert.equal(saved.users.Alice.points,99);assert.ok(saved.messages['校园跑'].some(x=>x.id===m.id));assert.ok(saved.lastId>=m.id);
 const recharge=(await call('/api/recharge','Bob',{amount:3,method:'wechat'})).data;
 assert.equal((await call('/api/admin/recharges/'+recharge.id+'/approve','AevonEcho',{points:3})).status,200);
 const approved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8'));assert.equal(approved.users.Bob.points,103);assert.equal(approved.recharges.find(x=>x.id===recharge.id).status,'approved');
 await restart();assert.equal((await call('/api/my/points','Bob')).data.points,103);
}));
test('storage failure returns 503 and stops trading without overwriting the saved database',()=>fixture(async({call,task,tmp,restart})=>{
 assert.equal((await call('/api/health')).status,200);await fs.mkdir(path.join(tmp,'data.json.tmp'));
 const result=await call(ch,'Alice',{text:'must not acknowledge',task:true});assert.equal(result.status,503);
 const saved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8'));assert.equal(saved.users.Alice.points,100);assert.equal(saved.messages['校园跑'].length,0);
 await sleep(150);await fs.rmdir(path.join(tmp,'data.json.tmp'));await restart();assert.equal((await call('/api/my/points')).data.points,100);await task();
}));
test('already-running authentication cannot acknowledge success after storage fails',()=>fixture(async({call,tmp,waitForCrypto,releaseCrypto})=>{
 await call('/api/health');const login=call('/api/login','',{username:'Bob',password});await waitForCrypto();await fs.mkdir(path.join(tmp,'data.json.tmp'));
 assert.equal((await call(ch,'Alice',{text:'storage fault',task:true})).status,503);await releaseCrypto();assert.equal((await login).status,503);
 const saved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8'));assert.equal(Object.keys(saved.sessions).length,4);
},seed(),{gateScryptCall:1}));
test('UTF-8 split across network chunks stays intact; invalid JSON and oversized bodies return 4xx',()=>fixture(async({base,call})=>{
 const data=Buffer.from(JSON.stringify({text:'中文内容',task:true})),split=data.indexOf(Buffer.from('中'))+1;
 const pending=pendingRequest(base,ch,'Alice',data.subarray(0,split));await sleep(30);pending.req.end(data.subarray(split));const r=await pending.response;assert.equal(r.status,200);assert.equal(r.data.text,'中文内容');
 for(const [payload,status] of [['{',400],['[]',400],['null',400],['{"text":"'+'a'.repeat(100001)+'"}',413]]){const response=await fetch(base+ch,{method:'POST',headers:{Authorization:'Bearer Alice','Content-Type':'application/json'},body:payload});assert.equal(response.status,status)}
 assert.equal((await call('/api/health')).status,200);
}));
test('static resource allowlist blocks source, operational files, tests and Windows separators',()=>fixture(async({base})=>{
 for(const p of ['/server.js','/data.json','/backups/data-test.json','/.git/config','/tests/regression.test.cjs','/foo%5c..%5cserver.js','/README.md'])assert.equal((await fetch(base+p)).status,403,p);
 for(const p of ['/','/index.html','/chat.html','/admin.html','/sw.js','/manifest.json','/icon-192.png'])assert.equal((await fetch(base+p)).status,200,p);
 assert.equal((await fetch(base+'/index.html',{method:'POST'})).status,405);
}));
test('login redirects stay on explicitly allowed local pages',async()=>{
 const html=await fs.readFile(path.join(root,'login.html'),'utf8'),script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(x=>x[1]).join('\n');
 for(const [input,expected] of [['https://evil.example/','index.html'],['//evil.example/','index.html'],['javascript:alert(1)','index.html'],['data:text/html,test','index.html'],['/server.js','index.html'],['chat.html#校园跑','/chat.html#%E6%A0%A1%E5%9B%AD%E8%B7%91'],['/me.html?tab=tasks','/me.html?tab=tasks']]){
  const ctx={URL,URLSearchParams,window:{API_BASE:''},location:{href:'https://campus.example/login.html',origin:'https://campus.example',search:'?next='+encodeURIComponent(input)},localStorage:{setItem(){}},fetch:async()=>({ok:true,json:async()=>({token:'test',username:'Alice'})})};
  for(const id of ['tL','tR','f','u','p','p2','err','go','tip'])ctx[id]={value:id==='u'?'Alice':password};vm.createContext(ctx);vm.runInContext(script,ctx);await ctx.f.onsubmit({preventDefault(){}});assert.equal(ctx.location.href,expected,input);
 }
});
test('frontend unban polling clears the disabled state',async()=>{
 const html=await fs.readFile(path.join(root,'chat.html'),'utf8'),fn=html.match(/function loadMe\(\)[\s\S]*?(?=\nfunction loadCost)/)[0];let resolve;
 const rendered=new Promise(r=>resolve=r),ctx={token:'valid',roleFingerprint:null,isAdmin:false,isBanned:true,localStorage:{setItem(){},getItem(){return 'valid'}},api:async()=>({ok:true,status:200,json:async()=>({admin:false,banned:false})}),setBanned(v){ctx.isBanned=v},renderPts(){},renderMsgs(){resolve()},setBell(){}};
 vm.createContext(ctx);vm.runInContext(fn+';loadMe()',ctx);await rendered;assert.equal(ctx.isBanned,false);
});
test('all standalone and inline JavaScript parses',async()=>{
 for(const f of await fs.readdir(root)){const source=await fs.readFile(path.join(root,f),'utf8').catch(()=>null);if(source===null)continue;if(f.endsWith('.js'))new vm.Script(source,{filename:f});if(f.endsWith('.html'))for(const m of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(m[1],{filename:f})}
});
test('compact admin overview preserves counters without transferring users or messages',async t=>{
 const data=seed(),now=Date.now();data.rev=1200;data.messages['校园跑']=Array.from({length:1200},(_,i)=>({id:now*1000+i,user:'Alice',text:'x'.repeat(1000),task:true,time:new Date(now).toISOString(),rev:i+1,...(i===0?{stage:'disputed',claimedBy:'Bob'}:{})}));
 data.feedback=[{id:1,user:'Alice',text:'pending',read:false},{id:2,user:'Alice',text:'done',read:true}];data.reports=[{id:3,resolved:false},{id:4,resolved:true}];
 await fixture(async({call})=>{const small=await call('/api/admin/overview?summary=1','AevonEcho'),full=await call('/api/admin/overview','AevonEcho');assert.equal(small.status,200);assert.equal(small.data.channels,undefined);assert.equal(small.data.users,undefined);
  for(const key of ['disputes','unreadFeedback','unreadReports'])assert.equal(small.data[key],full.data[key]);assert.equal(small.data.disputes,1);
  const compactBytes=Buffer.byteLength(JSON.stringify(small.data)),fullBytes=Buffer.byteLength(JSON.stringify(full.data));assert.ok(fullBytes>compactBytes*100);t.diagnostic('1200 tasks: full overview '+fullBytes+' bytes; compact summary '+compactBytes+' bytes');
  assert.equal((await call('/api/admin/overview?summary=1','Alice')).status,403);assert.equal((await call('/api/admin/users','AevonEcho')).data.find(x=>x.username==='Alice').messages,1200);
 },data);
});
test('prototype-like usernames have numeric session and message counts',()=>fixture(async({call})=>{
 for(const username of ['__proto__','constructor','toString']){const registration=await call('/api/register','',{username,password});assert.equal(registration.status,200);assert.equal((await call(ch,registration.data.token,{task:true,text:'valid task'})).status,200)}
 const users=(await call('/api/admin/users','AevonEcho')).data;
 for(const n of ['__proto__','constructor','toString']){const user=users.find(x=>x.username===n);assert.equal(user.activeSessions,1);assert.equal(user.messages,1)}
}));
test('structurally invalid primary data recovers from the last valid backup',async()=>{
 const data=seed();data.users.Alice.points=321;
 await fixture(async({call,tmp})=>{assert.equal((await call('/api/my/points')).data.points,321);const bad=(await fs.readdir(tmp)).find(x=>x.startsWith('data.corrupt-'));assert.ok(bad);assert.equal(await fs.readFile(path.join(tmp,bad),'utf8'),'{}')},seed(),{prepare:async tmp=>{await fs.writeFile(path.join(tmp,'data.json'),'{}');await fs.mkdir(path.join(tmp,'backups'));await fs.writeFile(path.join(tmp,'backups','data-2020-01-01.json'),JSON.stringify(data));await fs.writeFile(path.join(tmp,'backups','data-2026-01-01.json'),'{}')}});
});
test('missing primary with unusable backups refuses to create an empty site',async()=>{
 let preserved=false;
 await assert.rejects(fixture(()=>assert.fail('must not serve an empty database'),seed(),{prepare:async tmp=>{await fs.unlink(path.join(tmp,'data.json'));await fs.mkdir(path.join(tmp,'backups'));await fs.writeFile(path.join(tmp,'backups','data-2026-01-01.json'),'{broken')},onStartFailure:async tmp=>{assert.equal(await fs.readFile(path.join(tmp,'backups','data-2026-01-01.json'),'utf8'),'{broken');await assert.rejects(fs.access(path.join(tmp,'data.json')));preserved=true}}),/Server failed to start/);assert.equal(preserved,true);
});
test('invalid collection shapes are not silently replaced with empty arrays',async()=>{
 for(const corrupt of [{users:[],messages:{}},{users:{},messages:{校园跑:{}}},{users:{},messages:{},ledger:{}},{users:{Alice:{pw:'test',created:'invalid'}},messages:{}}]){
  await assert.rejects(fixture(()=>assert.fail('invalid database started'),corrupt),/Server failed to start/);
 }
});
test('daily backup skips invalid recent files and keeps seven valid snapshots',()=>fixture(async({call,tmp})=>{
 await call('/api/health');const files=await fs.readdir(path.join(tmp,'backups')),valid=[];
 for(const f of files.filter(x=>x.endsWith('.json'))){const d=JSON.parse(await fs.readFile(path.join(tmp,'backups',f),'utf8'));if(d.users&&d.messages)valid.push(f)}
 assert.equal(valid.length,7);assert.ok(valid.some(x=>!x.startsWith('data-2000-')));assert.equal(await fs.readFile(path.join(tmp,'backups','data-2099-bad.json'),'utf8'),'{}');
},seed(),{prepare:async tmp=>{const bak=path.join(tmp,'backups');await fs.mkdir(bak);for(let i=1;i<=8;i++){const f=path.join(bak,'data-2000-01-0'+i+'.json');await fs.writeFile(f,JSON.stringify(seed()));await fs.utimes(f,new Date('2000-01-01'),new Date('2000-01-01'))}await fs.writeFile(path.join(bak,'data-2099-bad.json'),'{}')}}));
test('failed image deletion retains quota and retries pending cleanup after restart',()=>fixture(async({call,task,act,tmp,restart})=>{
 const m=await task();await act(m,'Bob','claim');const image=await call('/api/tasks/'+m.id+'/chat/image','Bob',{data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII='});assert.equal(image.status,200);
 const file=path.join(tmp,'uploads',String(m.id),image.data.id+'.png'),bytes=(await fs.stat(file)).size;await act(m,'AevonEcho','delete');assert.equal((await fs.stat(file)).size,bytes);
 const pending=(await call('/api/tasks/'+m.id+'/chat','AevonEcho')).data.messages.find(x=>x.id===image.data.id);assert.equal(pending.imageCleanupPending,true);assert.ok(pending.image);
 assert.equal((await call('/api/admin/overview?summary=1','AevonEcho')).data.disk.uploads,bytes);
 await restart();await assert.rejects(fs.access(file));const removed=(await call('/api/tasks/'+m.id+'/chat','AevonEcho')).data.messages.find(x=>x.id===image.data.id);assert.equal(removed.imageRemoved,true);assert.equal(removed.image,undefined);assert.equal((await call('/api/admin/overview?summary=1','AevonEcho')).data.disk.uploads,0);
},seed(),{blockImageDeletion:true}));
test('admin message pagination covers all rows, searches deleted originals and validates filters',async()=>{
 const data=seed(),id=Date.now()*1000;data.messages['校园跑']=Array.from({length:121},(_,i)=>({id:id+i,user:'Alice',text:i===0?'':'message '+i,task:true,time:new Date().toISOString(),...(i===0?{deleted:true}:{})}));data.deletedTexts={[id]:'deleted unique original'};
 await fixture(async({call})=>{const collected=[];for(let page=1;page<=5;page++){const result=await call('/api/admin/messages?page='+page+'&limit=25','AevonEcho');assert.equal(result.status,200);assert.equal(result.data.page,page);assert.equal(result.data.total,121);assert.equal(result.data.pages,5);collected.push(...result.data.messages.map(x=>x.id))}assert.equal(new Set(collected).size,121);assert.equal(collected.at(-1),id);
  const search=await call('/api/admin/messages?page=999&limit=25&q=deleted%20unique&filter=gone','AevonEcho');assert.equal(search.data.page,1);assert.equal(search.data.messages[0].originalText,'deleted unique original');
  assert.equal((await call('/api/admin/messages?page=1','Alice')).status,403);
  for(const q of ['page=0','page=1.2','limit=101','filter=unknown','channel=unknown'])assert.equal((await call('/api/admin/messages?page=1&'+q,'AevonEcho')).status,400,q);
  assert.ok(Array.isArray((await call('/api/admin/messages','AevonEcho')).data));
 },data);
});
test('backup write failure preserves every previous valid snapshot',()=>fixture(async({call,tmp})=>{
 assert.equal((await call('/api/health')).status,200);const files=(await fs.readdir(path.join(tmp,'backups'))).filter(f=>f.endsWith('.json'));assert.equal(files.length,8);for(const f of files)assert.ok(f.startsWith('data-2000-'));
},seed(),{blockBackupWrite:true,prepare:async tmp=>{const bak=path.join(tmp,'backups');await fs.mkdir(bak);for(let i=1;i<=8;i++){const f=path.join(bak,'data-2000-01-0'+i+'.json');await fs.writeFile(f,JSON.stringify(seed()));await fs.utimes(f,new Date('2000-01-01'),new Date('2000-01-01'))}}}));
test('downloaded backup restores accounts, tasks, chats and points without restoring sessions',()=>fixture(async({call,task,act})=>{
 const registered=await call('/api/register','',{username:'__proto__',password});assert.equal(registered.status,200);
 const m=await task();await act(m,'Bob','claim');await call('/api/tasks/'+m.id+'/chat','Bob',{text:'restored conversation'});await call('/api/login','',{username:'Bob',password});
 const exported=(await call('/api/admin/backup','AevonEcho')).data;assert.equal(exported.sessions,undefined);assert.ok(Object.hasOwn(exported.users,'__proto__'));assert.ok(Object.values(exported.users).every(x=>x.ips===undefined));
 await fixture(async({call:restored})=>{assert.equal((await restored('/api/me','Alice')).status,401);const login=await restored('/api/login','',{username:'Alice',password});assert.equal(login.status,200);assert.equal((await restored('/api/my/points',login.data.token)).data.points,99);assert.equal((await restored('/api/my/tasks',login.data.token)).data.posted[0].id,m.id);assert.ok((await restored('/api/tasks/'+m.id+'/chat',login.data.token)).data.messages.some(x=>x.text==='restored conversation'));assert.equal((await restored('/api/login','',{username:'__proto__',password})).status,200)},exported);
}));
test('a genuinely new data directory still permits normal first registration',()=>fixture(async({call})=>{
 assert.equal((await call('/api/health','')).status,200);const admin=await call('/api/register','',{username:'AevonEcho',password});assert.equal(admin.status,200);assert.equal(admin.data.admin,true);
 const user=await call('/api/register','',{username:'Alice',password});assert.equal(user.status,200);assert.equal((await call('/api/my/points',user.data.token)).data.points,10);
},seed(),{prepare:tmp=>fs.unlink(path.join(tmp,'data.json'))}));
test('historical temporary data prevents accidental empty-site initialization',async()=>{
 await assert.rejects(fixture(()=>assert.fail('must preserve historical data'),seed(),{prepare:async tmp=>{await fs.rename(path.join(tmp,'data.json'),path.join(tmp,'data.json.tmp'))},onStartFailure:async tmp=>{assert.ok(JSON.parse(await fs.readFile(path.join(tmp,'data.json.tmp'),'utf8')).users.Alice);await assert.rejects(fs.access(path.join(tmp,'data.json')))}}),/Server failed to start/);
});
test('concurrent login failures reserve the account/IP allowance before password verification',()=>fixture(async({call,tmp,waitForCrypto,releaseCrypto})=>{
 const attempts=Array.from({length:12},()=>call('/api/login','',{username:'Bob',password:'incorrectpass'}));await waitForCrypto();await sleep(100);await releaseCrypto();const result=await Promise.all(attempts);
 assert.equal(result.filter(x=>x.status===401).length,10);assert.equal(result.filter(x=>x.status===429).length,2);assert.equal(Number(await fs.readFile(path.join(tmp,'crypto-started'),'utf8')),10);
},seed(),{gateAllScrypt:true}));
test('password work has a bounded concurrent and waiting queue',()=>fixture(async({call,tmp,waitForCrypto,releaseCrypto})=>{
 const attempts=Array.from({length:12},(_,i)=>call('/api/register','',{username:'QueueUser'+i,password}));await waitForCrypto();await sleep(100);const active=Number(await fs.readFile(path.join(tmp,'crypto-started'),'utf8'));await releaseCrypto();const result=await Promise.all(attempts);assert.equal(active,2);assert.equal(result.filter(x=>x.status===200).length,10);assert.equal(result.filter(x=>x.status===503).length,2);
},seed(),{gateAllScrypt:true}));
test('task state actions are rate limited without changing a rejected order',()=>fixture(async({call,task,act,advanceTime})=>{
 const m=await task();for(let i=0;i<60;i++)assert.equal((await act(m,'Bob',i%2?'unclaim':'claim')).status,200);
 const before=(await call('/api/my/points','Bob')).data.points;assert.equal((await act(m,'Bob','claim')).status,429);assert.equal((await call('/api/my/points','Bob')).data.points,before);
 await advanceTime(60001);assert.equal((await act(m,'Bob','claim')).status,200);
},seed(),{clock:true}));
test('chunked persistence preserves JSON values and handles short filesystem writes',async()=>{
 const data=seed();data.extra={array:[null,true,false,0,1.25,{text:'换行\n"引号" \\路径 😀\ud800'},[]],map:JSON.parse('{"__proto__":{"value":1},"constructor":"kept"}')};
 await fixture(async({call,task,tmp,restart})=>{await task('Alice',{text:'换行\n"引号" \\路径 😀\ud800'});let saved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8'));assert.deepEqual(saved.extra,data.extra);assert.equal(saved.messages['校园跑'][0].text,'换行\n"引号" \\路径 😀\ud800');await restart();assert.equal((await call('/api/my/points')).data.points,99);saved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8'));assert.deepEqual(saved.extra,data.extra)},data,{shortWrites:true});
});
test('failure midway through a chunked snapshot never replaces the committed database',async()=>{
 const data=seed(),id=Date.now()*1000;data.messages['校园跑']=Array.from({length:300},(_,i)=>({id:id+i,user:'Alice',text:'x'.repeat(500),task:true,time:new Date().toISOString()}));
 await fixture(async({call,tmp})=>{await call('/api/health');const before=await fs.readFile(path.join(tmp,'data.json'));await fs.writeFile(path.join(tmp,'fail-write'),'fail');assert.equal((await call(ch,'Alice',{task:true,text:'must not commit'})).status,503);assert.deepEqual(await fs.readFile(path.join(tmp,'data.json')),before);assert.ok((await fs.stat(path.join(tmp,'data.json.tmp'))).size>0)},data,{blockSnapshotWrite:true});
});
test('sessions expire exactly at expiry and bind to the original account identity',async()=>{
 const data=seed();data.sessions.Bob.userId='replaced-account';data.sessions.Legacy='Alice';
 await fixture(async({call,tmp,advanceTime})=>{assert.equal((await call('/api/me','Bob')).status,401);assert.equal((await call('/api/me','Legacy')).status,401);assert.equal((await call('/api/me','Alice')).status,200);
  const login=await call('/api/login','',{username:'Alice',password});assert.equal(login.status,200);const saved=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8')),session=saved.sessions[login.data.token];assert.equal(session.userId,saved.users.Alice.id);
  const now=Number(await fs.readFile(path.join(tmp,'clock'),'utf8'));await advanceTime(session.exp-now);assert.equal((await call('/api/me',login.data.token)).status,401);
 },data,{clock:true});
});
test('full task history blocks new claims but still allows withdrawal and refund',async()=>{
 const data=seed(),id=Date.now()*1000;data.messages['校园跑']=[{id,user:'Alice',text:'full-history task',task:true,cost:1,time:new Date().toISOString()}];data.taskChats={[id]:Array.from({length:2000},(_,i)=>({id:id+i+1,user:'Bob',text:'history',claimer:'Bob',time:new Date().toISOString()}))};data.offers={[id]:[{id:id+3000,user:'Bob',userId:'account-Bob',status:'pending',price:15,turn:'poster',rounds:[{by:'claimer',price:15,note:'old pending offer',time:new Date().toISOString()}],time:new Date().toISOString(),updated:new Date().toISOString()}]};
 await fixture(async({call,act})=>{assert.equal((await act({id},'Bob','claim')).status,409);assert.equal((await call(ch+'/'+id+'/offers/'+(id+3000)+'/accept','Alice',{})).status,409);assert.equal((await call('/api/my/points','Bob')).data.points,100);assert.equal((await act({id},'Alice','cancel')).status,200);assert.equal((await call('/api/my/points','Alice')).data.points,101);assert.ok((await call('/api/tasks/'+id+'/chat','AevonEcho')).data.messages.length>=2000)},data);
});
test('task selection preserves state, ordering, channel and personalized fields',async()=>{
 const data=seed(),id=Date.now()*1000,now=Date.now(),time=new Date(now).toISOString(),task=(n,extra)=>({id:id+n,user:'Alice',text:'task '+n,task:true,time,...extra});
 data.messages['校园跑']=[task(1,{reward:'1元',deadline:new Date(now-1000).toISOString()}),task(2,{reward:'3元',place:'北门',deadline:new Date(now+3600000).toISOString()}),task(3,{reward:'20元',claimedBy:'Bob'}),task(4,{reward:'99元',claimedBy:'Bob',done:true}),task(5,{reward:'100元',cancelled:true}),task(6,{deleted:true})];data.messages['代取快递']=[task(7,{reward:'15元'}),{id:id+8,user:'Alice',text:'plain',task:false,time}];
 data.taskChats={[id+3]:[{id:id+100,user:'Alice',text:'unread',claimer:'Bob',time}]};data.offers={[id+2]:[{id:id+200,user:'Bob',userId:'account-Bob',status:'pending',price:4,turn:'poster',rounds:[{by:'claimer',price:4,note:'',time}],time,updated:time}]};
 await fixture(async({call})=>{const open=(await call('/api/tasks?limit=8','Bob')).data;assert.deepEqual(open.map(x=>x.id),[id+7,id+2]);assert.equal(open[0].channel,'代取快递');const search=(await call('/api/tasks?q='+encodeURIComponent('北门'),'Bob')).data;assert.equal(search[0].myOffer.price,4);assert.equal((await call('/api/tasks?status=claimed','Bob')).data[0].chatUnread,1);assert.equal((await call('/api/tasks?status=claimed','')).data[0].chatUnread,undefined);assert.deepEqual((await call('/api/tasks?status=all&sort=reward&limit=2','Bob')).data.map(x=>x.id),[id+4,id+3])},data);
});
test('banned login and /api/me return ban reason and admin contact configured in settings',()=>fixture(async({call})=>{
 assert.equal((await call('/api/admin/settings','AevonEcho',{contactInfo:'邮箱 admin@example.com / QQ 123456'})).status,200);
 const pub=await call('/api/settings','');assert.equal(pub.data.contactInfo,'邮箱 admin@example.com / QQ 123456');
 assert.equal((await call('/api/admin/users/Carol/ban','AevonEcho',{reason:'广告刷屏'})).status,200);
 const login=await call('/api/login','',{username:'Carol',password});assert.equal(login.status,403);assert.equal(login.data.banned,true);assert.equal(login.data.banReason,'广告刷屏');assert.equal(login.data.contact,'邮箱 admin@example.com / QQ 123456');
 const me=await call('/api/me','Carol');assert.equal(me.data.banned,true);assert.equal(me.data.banReason,'广告刷屏');assert.equal(me.data.contact,'邮箱 admin@example.com / QQ 123456');
 assert.equal((await call('/api/password','Carol',{oldPassword:password,newPassword:'newpass123'})).status,403);
 assert.equal((await call('/api/tasks?status=bogus','')).status,400);
 assert.equal((await call('/api/tasks?status=open','')).status,200);
}));
