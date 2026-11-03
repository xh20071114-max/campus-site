const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,password}=require('./helpers.cjs');const ch='/api/channels/'+encodeURIComponent('校园跑')+'/messages';
test('banned user verifies password for an appeal-only credential and receives a private admin reply',()=>fixture(async({call})=>{
 await call('/api/admin/users/Bob/ban','AevonEcho',{reason:'review required'});
 const wrong=await call('/api/login','',{username:'Bob',password:'wrong'});assert.equal(wrong.status,401);assert.equal(wrong.data.appealToken,undefined);
 const login=await call('/api/login','',{username:'Bob',password});assert.equal(login.status,403);assert.equal(login.data.reason,'review required');const token=login.data.appealToken;assert.ok(token);
 for(const p of ['/api/me','/api/my/tasks','/api/admin/roles'])assert.equal((await call(p,token)).status,401);
 assert.equal((await call(ch,token,{task:true,text:'bypass ban'})).status,401);
 assert.equal((await call('/api/feedback','Bob',{text:'still blocked'})).status,403);
 const sent=await call('/api/support',token,{text:'appeal <script>unsafe</script>',contact:'example'});assert.equal(sent.status,200);
 assert.equal((await call('/api/support','Carol')).data.length,0);
 assert.equal((await call('/api/admin/feedback/'+sent.data.id+'/reply','Carol',{text:'forged admin'})).status,403);
 assert.equal((await call('/api/admin/feedback/'+sent.data.id+'/reply','AevonEcho',{text:'we are reviewing'})).status,200);
 const history=(await call('/api/support',token)).data;assert.equal(history.length,1);assert.equal(history[0].replies[0].text,'we are reviewing');assert.equal(history[0].read,true);
 assert.equal((await call('/api/support',token+'x')).status,401);
}));
test('appeal credentials expire and are invalid after unban, reban or account recreation',()=>fixture(async({call,advanceTime})=>{
 await call('/api/admin/users/Bob/ban','AevonEcho',{});const t=(await call('/api/login','',{username:'Bob',password})).data.appealToken;
 await call('/api/admin/users/Bob/unban','AevonEcho',{});assert.equal((await call('/api/support',t)).status,401);
 await call('/api/admin/users/Bob/ban','AevonEcho',{});assert.equal((await call('/api/support',t)).status,401,'same-time reban must invalidate old credential');
 const fresh=(await call('/api/login','',{username:'Bob',password})).data.appealToken;await advanceTime(15*60e3);assert.equal((await call('/api/support',fresh)).status,401);
 const last=(await call('/api/login','',{username:'Bob',password})).data.appealToken;const sent=await call('/api/support',last,{text:'old identity appeal'});assert.equal(sent.status,200);
 await call('/api/admin/users/Bob/delete','AevonEcho',{});const r=await call('/api/register','',{username:'Bob',password});assert.equal(r.status,200);
 assert.equal((await call('/api/support',last)).status,401);assert.deepEqual((await call('/api/support',r.data.token)).data,[]);
 assert.equal((await call('/api/admin/feedback/'+sent.data.id+'/reply','AevonEcho',{text:'cannot send to replacement'})).status,409);
},undefined,{clock:true}));
test('support validates input and limits spam without blocking normal browsing or task ban enforcement',()=>fixture(async({call,advanceTime})=>{
 assert.equal((await call('/api/support','')).status,401);assert.equal((await call('/api/support','Bob',{text:' '})).status,400);assert.equal((await call('/api/support','Bob',{text:'hello',contact:{}})).status,400);
 for(let i=0;i<3;i++)assert.equal((await call('/api/support','Bob',{text:'message '+i})).status,200);
 assert.equal((await call('/api/support','Bob',{text:'too frequent'})).status,429);await advanceTime(60001);assert.equal((await call('/api/support','Bob',{text:'after pause'})).status,200);
 assert.equal((await call('/api/admin/feedback','Bob')).status,403);
 const roles=(await call('/api/admin/roles','AevonEcho')).data,u=roles.users.find(x=>x.username==='Carol');await call('/api/admin/users/Carol/permissions','AevonEcho',{userId:u.userId,version:u.permissionsVersion,permissions:['manageFeedback']});
 const item=(await call('/api/support','Bob')).data[0];assert.equal((await call('/api/admin/feedback/'+item.id+'/reply','Carol',{text:'delegated reply'})).status,200);
 assert.equal((await call('/api/admin/users/Bob/unban','Carol',{})).status,403);assert.equal((await call('/api/support','Bob')).data[0].replies[0].text,'delegated reply');
},undefined,{clock:true}));
