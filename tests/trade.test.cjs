const {test}=require('node:test'),assert=require('node:assert/strict');const {fixture,seed,pendingRequest,sleep}=require('./helpers.cjs');
const fs=require('node:fs/promises'),path=require('node:path');
async function grant(call,name,permissions){const u=(await call('/api/admin/roles','AevonEcho')).data.users.find(x=>x.username===name);assert.equal((await call('/api/admin/users/'+name+'/permissions','AevonEcho',{userId:u.userId,version:u.permissionsVersion,permissions})).status,200)}
test('unverified payment remains open after 48 hours and can be disputed',async()=>{
 const data=seed(),then=new Date(Date.now()-49*3600000).toISOString();data.messages={'校园跑':[{id:123,task:true,user:'Alice',claimedBy:'Bob',text:'Payment test',time:then,paidAt:then,stage:'paid',bonusPoints:5}]};
 await fixture(async({call,act,restart})=>{let m=(await call('/api/tasks/123','Bob')).data;assert.equal(m.status,'paid');assert.equal(m.done,undefined);assert.equal((await call('/api/my/points','Bob')).data.points,100);let chat=(await call('/api/tasks/123/chat','Bob')).data.messages;assert.equal(chat.filter(x=>x.text.includes('请接单人核实到账')).length,1);await restart();chat=(await call('/api/tasks/123/chat','Bob')).data.messages;assert.equal(chat.filter(x=>x.text.includes('请接单人核实到账')).length,1);const r=await act({id:123},'Bob','dispute',{reason:'尚未收到款项'});assert.equal(r.status,200);assert.equal(r.data.status,'disputed')},data);
});
test('super administrator and explicitly authorized moderators can chat without becoming a task party',()=>fixture(async({call,task,act})=>{
 const m=await task();await act(m,'Carol','claim');assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob',{text:'unauthorized'})).status,403);await grant(call,'Bob',['viewChats']);assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob')).data.task.canWrite,false);assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob',{text:'read only'})).status,403);
 await grant(call,'Bob',['joinChats']);const sent=await call('/api/tasks/'+m.id+'/chat','Bob',{text:'Let us confirm the details',user:'Alice',moderator:false});assert.equal(sent.status,200);assert.equal(sent.data.user,'Bob');assert.equal(sent.data.moderator,true);assert.equal((await call('/api/tasks/'+m.id+'/chat','Alice')).data.messages.at(-1).moderator,true);assert.equal((await call('/api/tasks/'+m.id+'/chat','Carol')).data.messages.at(-1).text,'Let us confirm the details');
 const image=await call('/api/tasks/'+m.id+'/chat/image','Bob',{data:'iVBORw0KGgo='});assert.equal(image.status,200);assert.equal(image.data.moderator,true);assert.equal((await call('/api/tasks/'+m.id+'/chat','AevonEcho',{text:'super admin'})).status,200);const data=(await call('/api/my/tasks','Alice')).data.posted[0];assert.equal(data.claimedBy,'Carol');assert.equal(data.user,'Alice');
 await act(m,'Alice','complete');await act(m,'Carol','acceptfree');assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob')).data.task.canWrite,false);assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob',{text:'closed order'})).status,409);
}));
test('free completion requires the current claimer consent for cash or mixed rewards',()=>fixture(async({call,task,act})=>{
 const m=await task('AevonEcho',{bonusPoints:7,reward:'10元'});await act(m,'Bob','claim');const proposed=await act(m,'AevonEcho','complete');assert.equal(proposed.data.status,'free_pending');assert.equal((await call('/api/my/points','Bob')).data.points,99);assert.equal((await act(m,'AevonEcho','acceptfree')).status,403);assert.equal((await act(m,'Carol','acceptfree')).status,403);assert.equal((await act(m,'Bob','finish')).status,409);assert.equal((await act(m,'Bob','declinefree')).data.status,'claimed');assert.equal((await act(m,'AevonEcho','complete')).data.status,'free_pending');assert.equal((await act(m,'AevonEcho','withdrawfree')).data.status,'claimed');assert.equal((await act(m,'AevonEcho','complete')).data.status,'free_pending');assert.equal((await act(m,'Bob','acceptfree')).data.status,'done');assert.equal((await call('/api/my/points','Bob')).data.points,106);assert.equal((await act(m,'Bob','acceptfree')).status,409);
}));
test('a pending free completion may be disputed',()=>fixture(async({task,act})=>{const m=await task();await act(m,'Bob','claim');await act(m,'Alice','complete');assert.equal((await act(m,'Bob','dispute',{reason:'尚未付款'})).data.status,'disputed')}));
test('revocation prevents late moderator text and image submissions',()=>fixture(async({call,task,act,base})=>{
 const m=await task();await act(m,'Carol','claim');for(const image of [false,true]){await grant(call,'Bob',['joinChats']);const pending=pendingRequest(base,'/api/tasks/'+m.id+'/chat'+(image?'/image':''),'Bob',image?'{"data":"':'{"text":"');try{await sleep(30);await grant(call,'Bob',[]);pending.req.end(image?'iVBORw0KGgo="}':'late unauthorized message"}');assert.notEqual((await pending.response).status,200)}finally{pending.req.destroy()}}
 assert.ok(!(await call('/api/tasks/'+m.id+'/chat','Alice')).data.messages.some(x=>x.user==='Bob'));
}));
test('order detail and opt-in history are private and deleted task text is not disclosed',()=>fixture(async({call,task,act})=>{
 const m=await task('Alice',{text:'history private task'});assert.equal((await call('/api/tasks/'+m.id,'Bob')).status,403);assert.equal((await call('/api/tasks/'+m.id,'')).status,401);assert.equal((await call('/api/tasks/'+m.id,'Alice')).data.channel,'校园跑');await act(m,'Alice','delete');assert.equal((await call('/api/my/tasks','Alice')).data.posted.length,0);const history=(await call('/api/my/tasks?includeHistory=1','Alice')).data.posted;assert.equal(history.length,1);assert.equal(history[0].deleted,true);assert.equal(history[0].text,'');assert.equal((await call('/api/my/tasks?includeHistory=1','Bob')).data.posted.length,0);
}));
test('former claim history is private, survives reassignment and is bound to the original account',()=>fixture(async({call,task,act})=>{
 const m=await task('Alice',{text:'Parcel history'});await act(m,'Bob','claim');await act(m,'Bob','unclaim');await act(m,'Carol','claim');
 let history=(await call('/api/my/tasks?includeHistory=1','Bob')).data.claimed;assert.equal(history.length,1);assert.equal(history[0].formerStatus,'unclaimed');assert.equal(history[0].claimedBy,'Bob');assert.equal(history[0].text,'Parcel history');assert.equal(history[0].formerClaims,undefined);assert.equal(JSON.stringify(history).includes('Carol'),false);
 assert.equal((await call('/api/my/tasks','Bob')).data.claimed.length,0);assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob')).status,403);
 await act(m,'Alice','release');assert.equal((await call('/api/my/tasks?includeHistory=1','Carol')).data.claimed[0].formerStatus,'released');
 await act(m,'Bob','claim');history=(await call('/api/my/tasks?includeHistory=1','Bob')).data.claimed;assert.equal(history.length,1);assert.notEqual(history[0].formerClaim,true);
 await act(m,'Bob','unclaim');await call('/api/admin/users/Bob/delete','AevonEcho',{});const reg=await call('/api/register','',{username:'Bob',password:'password123'});assert.equal(reg.status,200);assert.equal((await call('/api/my/tasks?includeHistory=1',reg.data.token)).data.claimed.length,0);
}));
test('reassigned negotiated claims persist the current account identity without publishing it',()=>fixture(async({call,task,act,tmp,restart})=>{
 const m=await task();await act(m,'Bob','claim');await act(m,'Bob','unclaim');
 const readTask=async()=>JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8')).messages['校园跑'].find(x=>x.id===m.id);
 assert.equal((await readTask()).claimedById,undefined);
 const offer=(await act(m,'Carol','offer',{price:12})).data.offer;
 const accepted=await call('/api/channels/'+encodeURIComponent('校园跑')+'/messages/'+m.id+'/offers/'+offer.id+'/accept','Alice',{});
 assert.equal(accepted.status,200);assert.equal(accepted.data.task.claimedBy,'Carol');assert.equal(accepted.data.task.claimedById,undefined);
 assert.equal((await readTask()).claimedById,'account-Carol');await restart();assert.equal((await readTask()).claimedById,'account-Carol');
 const publicTask=(await call('/api/tasks?status=claimed','')).data.find(x=>x.id===m.id);assert.equal(publicTask.claimedBy,'Carol');assert.equal(publicTask.claimedById,undefined);
}));

test('deleted unclaimed task can be restored only by its owner and the post fee is restored too',()=>fixture(async({call,task,act})=>{
 const m=await task('Alice',{text:'Restore this order'});assert.equal((await call('/api/my/points','Alice')).data.points,99);await act(m,'Alice','delete');assert.equal((await call('/api/my/points','Alice')).data.points,100);assert.equal((await act(m,'Bob','restore')).status,403);const restored=await act(m,'Alice','restore');assert.equal(restored.status,200);assert.equal(restored.data.text,'Restore this order');assert.equal(restored.data.deleted,false);assert.equal((await call('/api/my/points','Alice')).data.points,99);assert.equal((await act(m,'Alice','restore')).status,409);
 await act(m,'Alice','delete');await call('/api/admin/users/Alice/points','AevonEcho',{delta:-100,reason:'test'});assert.equal((await act(m,'Alice','restore')).status,402);await call('/api/admin/users/Alice/points','AevonEcho',{delta:1,reason:'test'});assert.equal((await act(m,'Alice','restore')).status,200);
}));
