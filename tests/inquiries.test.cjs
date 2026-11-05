const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers.cjs');

async function grant(call,name,permissions){
 const d=(await call('/api/admin/roles','AevonEcho')).data,u=d.users.find(x=>x.username===name);
 assert.equal((await call('/api/admin/users/'+name+'/permissions','AevonEcho',{userId:u.userId,version:u.permissionsVersion,permissions})).status,200);
}

test('pre-claim inquiries are account-private, free, and only the winning thread joins order chat',()=>fixture(async({call,task,act})=>{
 const m=await task('Alice',{text:'Inquiry isolation'}),endpoint='/api/tasks/'+m.id+'/inquiries';
 const bobBefore=(await call('/api/my/points','Bob')).data.points,carolBefore=(await call('/api/my/points','Carol')).data.points;
 const bob=(await call(endpoint,'Bob',{text:'Bob question'})).data,carol=(await call(endpoint,'Carol',{text:'Carol question'})).data;
 assert.equal(bob.inquiry,true);assert.equal(bob.user,'Bob');assert.equal(bob.userId,undefined);assert.equal(bob.inquiryUserId,undefined);
 assert.notEqual(bob.inquiryId,carol.inquiryId);assert.equal((await call(endpoint+'?inquiryId='+bob.inquiryId,'Carol')).status,403);
 assert.equal((await call(endpoint+'?inquiryId='+carol.inquiryId,'Bob')).status,403);
 assert.equal((await call('/api/tasks/'+m.id+'/chat','Bob')).status,403);
 assert.equal((await call('/api/my/points','Bob')).data.points,bobBefore);assert.equal((await call('/api/my/points','Carol')).data.points,carolBefore);
 const reply=await call(endpoint,'Alice',{inquiryId:bob.inquiryId,text:'Seller reply'});assert.equal(reply.status,200);
 const inbox=(await call(endpoint,'Alice')).data;assert.equal(inbox.threads.length,2);assert.ok(inbox.threads.some(x=>x.user==='Bob'&&x.unread===0));
 assert.equal((await call('/api/my/tasks','Alice')).data.posted.find(x=>x.id===m.id).inquiryCount,2);
 await act(m,'Bob','claim');assert.equal((await call('/api/my/points','Bob')).data.points,bobBefore-1);
 const order=(await call('/api/tasks/'+m.id+'/chat','Bob')).data.messages;
 assert.deepEqual(order.filter(x=>x.inquiry).map(x=>x.text),['Bob question','Seller reply']);
 assert.ok(order.every(x=>x.userId===undefined&&x.claimerId===undefined&&x.inquiryUserId===undefined));
 assert.equal((await call(endpoint+'?inquiryId='+carol.inquiryId,'Carol')).data.task.canWrite,false);
 assert.equal((await call(endpoint,'Carol',{text:'late'})).status,409);
 assert.equal((await call(endpoint,'Bob',{inquiryId:bob.inquiryId,text:'switch to order chat'})).status,409);
}));

test('inquiry images require thread membership and reject pre-claim payment QR codes',()=>fixture(async({call,task,act,base})=>{
 const m=await task('Alice'),root='/api/tasks/'+m.id,upload=root+'/chat/image?inquiry=1',png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhXcAAAAASUVORK5CYII=';
 const sent=await call(upload,'Bob',{data:png});assert.equal(sent.status,200);assert.equal(sent.data.inquiry,true);assert.match(sent.data.image,/inquiry=1&inquiryId=/);
 assert.equal((await call(root+'/chat/image?inquiry=1','Bob',{data:png,kind:'payqr'})).status,400);
 const read=async(user)=>fetch(base+sent.data.image,{headers:{Authorization:'Bearer '+user}});
 const bob=await read('Bob'),alice=await read('Alice'),carol=await read('Carol');
 assert.equal(bob.status,200);assert.match(bob.headers.get('content-type'),/image\/png/);assert.equal(alice.status,200);assert.equal(carol.status,404);
 await act(m,'Bob','claim');assert.equal((await read('Bob')).status,200);
}));

test('admin viewChats is read-only and joinChats permits a marked inquiry reply',()=>fixture(async({call,task})=>{
 const m=await task('Alice'),endpoint='/api/tasks/'+m.id+'/inquiries',msg=await call(endpoint,'Carol',{text:'Question for the seller'});
 await grant(call,'Bob',['viewChats']);
 const viewed=await call(endpoint+'?inquiryId='+msg.data.inquiryId,'Bob');assert.equal(viewed.status,200);assert.equal(viewed.data.task.canWrite,false);
 assert.equal((await call(endpoint,'Bob',{inquiryId:msg.data.inquiryId,text:'read only'})).status,403);
 await grant(call,'Bob',['joinChats']);
 const sent=await call(endpoint,'Bob',{inquiryId:msg.data.inquiryId,text:'Moderator reply'});assert.equal(sent.status,200);assert.equal(sent.data.moderator,true);
 assert.ok((await call(endpoint+'?inquiryId='+msg.data.inquiryId,'Carol')).data.messages.some(x=>x.text==='Moderator reply'&&x.moderator));
}));

test('simultaneous messages share one inquiry thread and a deleted username cannot read its prior thread',()=>fixture(async({call,task})=>{
 const m=await task('Alice'),endpoint='/api/tasks/'+m.id+'/inquiries';
 const sent=await Promise.all(Array.from({length:6},(_,i)=>call(endpoint,'Bob',{text:'Concurrent '+i})));
 assert.ok(sent.every(x=>x.status===200));assert.equal(new Set(sent.map(x=>x.data.inquiryId)).size,1);
 const id=sent[0].data.inquiryId;assert.equal((await call(endpoint,'Alice')).data.threads.length,1);
 assert.equal((await call('/api/admin/users/Bob/delete','AevonEcho',{})).status,200);
 const reg=await call('/api/register','',{username:'Bob',password:'newpass12',password2:'newpass12'});assert.equal(reg.status,200);
 const clean=(await call(endpoint,reg.data.token)).data;assert.deepEqual(clean.messages,[]);assert.equal(clean.inquiryId,undefined);
 assert.equal((await call(endpoint+'?inquiryId='+id,reg.data.token)).status,403);
}));
