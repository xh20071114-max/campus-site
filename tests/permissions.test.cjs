const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,seed,password,pendingRequest,sleep}=require('./helpers.cjs');
const ch='/api/channels/'+encodeURIComponent('校园跑')+'/messages';
async function grant(call,name,permissions){const d=await call('/api/admin/roles','AevonEcho');assert.equal(d.status,200);const u=d.data.users.find(x=>x.username===name);return call('/api/admin/users/'+encodeURIComponent(name)+'/permissions','AevonEcho',{permissions,userId:u.userId,version:u.permissionsVersion})}

test('only the exact super administrator can grant permissions; role editing is versioned and bound to account ID',()=>fixture(async({call,restart})=>{
 const {data:d}=await call('/api/admin/roles','AevonEcho'),u=d.users.find(x=>x.username==='Bob'),body={permissions:['viewUsers'],userId:u.userId,version:0};
 assert.equal(d.catalog.length,17);assert.equal((await call('/api/admin/roles','Alice')).status,403);
 assert.equal((await call('/api/admin/users/Bob/permissions','Bob',body)).status,403);
 assert.equal((await call('/api/admin/users/Bob/permissions','AevonEcho',{...body,permissions:['grantAdmin']})).status,400);
 assert.equal((await call('/api/admin/users/Bob/permissions','AevonEcho',{...body,permissions:['viewUsers','viewUsers']})).status,400);
 assert.equal((await call('/api/admin/users/Bob/permissions','AevonEcho',{...body,userId:'wrong'})).status,409);
 assert.equal((await call('/api/admin/users/Bob/permissions','AevonEcho',body)).status,200);
 assert.equal((await call('/api/admin/users/Bob/permissions','AevonEcho',body)).status,409);
 assert.equal((await call('/api/admin/users/AevonEcho/permissions','AevonEcho',{})).status,403);
 await restart();const me=(await call('/api/me','Bob')).data;assert.equal(me.admin,true);assert.equal(me.superAdmin,false);assert.deepEqual(me.permissions,['viewUsers']);
 assert.equal((await call('/api/admin/roles','Bob')).status,403);assert.equal((await call('/api/admin/backup','Bob')).status,403);
 assert.equal((await call('/api/admin/overview','Bob')).status,403);assert.deepEqual((await call('/api/admin/overview?summary=1','Bob')).data,{});
 assert.equal((await call('/api/admin/messages','Bob')).status,403);
 assert.equal((await grant(call,'Bob',[])).status,200);assert.equal((await call('/api/me','Bob')).data.admin,false);assert.equal((await call('/api/admin/users','Bob')).status,403);
}));

const cases={
 viewUsers:async c=>assert.equal((await c.call('/api/admin/users','Bob')).status,200),
 banUsers:async c=>{assert.equal((await c.call('/api/admin/users/Carol/ban','Bob',{})).status,200);assert.equal((await c.call('/api/admin/users/Carol/unban','Bob',{})).status,200)},
 deleteUsers:async c=>assert.equal((await c.call('/api/admin/users/Carol/delete','Bob',{})).status,200),
 managePoints:async c=>assert.equal((await c.call('/api/admin/users/Carol/points','Bob',{delta:2})).status,200),
 viewMessages:async c=>assert.equal((await c.call('/api/admin/messages','Bob')).status,200),
 deleteMessages:async c=>assert.equal((await c.act(c.m,'Bob','delete')).status,200),
 viewChats:async c=>{assert.equal((await c.call('/api/admin/chats','Bob')).status,200);assert.ok((await c.call('/api/tasks/'+c.m.id+'/chat','Bob')).data.messages.some(x=>x.text==='private evidence'))},
 joinChats:async c=>{assert.equal((await c.call('/api/admin/chats','Bob')).status,200);assert.equal((await c.call('/api/tasks/'+c.m.id+'/chat','Bob',{text:'moderator joins'})).data.moderator,true)},
 manageAnnouncements:async c=>assert.equal((await c.call('/api/announcements','Bob',{title:'notice'})).status,200),
 manageRecharges:async c=>{const r=await c.call('/api/recharge','Alice',{amount:1,method:'wechat'});assert.equal((await c.call('/api/admin/recharges/'+r.data.id+'/approve','Bob',{points:2})).status,200)},
 manageSettings:async c=>assert.equal((await c.call('/api/admin/settings','Bob',{postCost:2})).status,200),
 publishBonus:async c=>assert.equal((await c.call(ch,'Bob',{text:'bonus',task:true,bonusPoints:2})).status,200),
 manageFeedback:async c=>assert.equal((await c.call('/api/admin/feedback','Bob')).status,200),
 manageReports:async c=>assert.equal((await c.call('/api/admin/reports','Bob')).status,200),
 manageDisputes:async c=>{assert.equal((await c.call('/api/admin/disputes','Bob')).status,200);assert.equal((await c.call('/api/tasks/'+c.m.id+'/chat','Bob')).status,403);assert.equal((await c.call('/api/admin/tasks/'+c.m.id+'/force','Bob',{action:'done',reason:'verified'})).status,200)},
 postOfficial:async c=>{const r=await c.call(ch,'Bob',{text:'official notice'});assert.equal(r.status,200);assert.equal(r.data.official,true)},
 freeTasks:async c=>{assert.equal((await c.call(ch,'Bob',{text:'free task',task:true})).status,200);const m=await c.task('Alice');assert.equal((await c.act(m,'Bob','claim')).status,200);assert.equal((await c.call('/api/me','Bob')).data.points,100)}
};
for(const [key,check] of Object.entries(cases))test('delegated permission works without inheriting other privileges: '+key,()=>fixture(async c=>{
 c.m=await c.task('Alice');await c.act(c.m,'Carol','claim');await c.call('/api/tasks/'+c.m.id+'/chat','Alice',{text:'private evidence'});
 assert.equal((await grant(c.call,'Bob',[key])).status,200);await check(c);
 assert.equal((await c.call('/api/admin/roles','Bob')).status,403);assert.equal((await c.call('/api/admin/backup','Bob')).status,403);
 assert.equal((await c.call('/api/admin/overview','Bob')).status,403);
 if(!['viewChats','joinChats'].includes(key))assert.equal((await c.call('/api/admin/chats','Bob')).status,403);
 if(!['viewMessages','deleteMessages'].includes(key))assert.equal((await c.call('/api/admin/messages','Bob')).status,403);
 if(key!=='manageSettings')assert.equal((await c.call('/api/admin/settings','Bob',{signupBonus:999})).status,403);
 if(key!=='publishBonus')assert.equal((await c.call(ch,'Bob',{text:'forged bonus',task:true,bonusPoints:500})).status,403);
 if(key!=='postOfficial')assert.equal((await c.call(ch,'Bob',{text:'forged official'})).status,403);
 if(key!=='deleteMessages'){const m=await c.task('Alice');assert.equal((await c.act(m,'Bob','delete')).status,403)}
}));

test('administrators cannot manage other administrators or the super administrator',()=>fixture(async({call})=>{
 const all=(await call('/api/admin/roles','AevonEcho')).data.catalog.map(x=>x.key);await grant(call,'Bob',all);await grant(call,'Carol',['viewUsers']);
 for(const name of ['AevonEcho','Carol','Bob'])for(const [action,body] of [['ban',{}],['delete',{}],['points',{delta:10}]])assert.equal((await call('/api/admin/users/'+name+'/'+action,'Bob',body)).status,403,name+'/'+action);
 assert.equal((await call('/api/admin/users/Carol/ban','AevonEcho',{})).status,200);assert.equal((await call('/api/admin/users','Carol')).status,403);
 assert.equal((await grant(call,'Carol',['viewUsers'])).status,400);assert.equal((await grant(call,'Carol',[])).status,200);
}));

test('revocation blocks slow admin actions and direct private images; deleted usernames cannot inherit a grant',()=>fixture(async({call,task,act,base})=>{
 const m=await task();await act(m,'Carol','claim');const image=await call('/api/tasks/'+m.id+'/chat/image','Alice',{data:'iVBORw0KGgo='});assert.equal(image.status,200);
 await grant(call,'Bob',['managePoints','viewChats']);const imageResponse=await fetch(base+'/api/tasks/'+m.id+'/chat/image/'+image.data.id,{headers:{Authorization:'Bearer Bob'}});assert.equal(imageResponse.status,200);assert.equal(imageResponse.headers.get('cache-control'),'no-store');assert.equal((await imageResponse.arrayBuffer()).byteLength,8);
 const pending=pendingRequest(base,'/api/admin/users/Carol/points','Bob','{"delta":');try{await sleep(30);await grant(call,'Bob',[]);pending.req.end('500}');assert.equal((await pending.response).status,403)}finally{pending.req.destroy()}
 assert.equal((await call('/api/tasks/'+m.id+'/chat/image/'+image.data.id,'Bob')).status,403);assert.equal((await call('/api/me','Carol')).data.points,99);
 await grant(call,'Bob',['viewUsers']);const old=(await call('/api/admin/roles','AevonEcho')).data.users.find(x=>x.username==='Bob');
 await call('/api/admin/users/Bob/delete','AevonEcho',{});const fresh=await call('/api/register','',{username:'Bob',password,adminPermissions:['managePoints']});assert.equal(fresh.status,200);
 assert.equal((await call('/api/me',fresh.data.token)).data.admin,false);assert.equal((await call('/api/admin/users/Bob/permissions','AevonEcho',{userId:old.userId,version:old.permissionsVersion,permissions:['viewUsers']})).status,409);
}));

test('only super administrator can use the complete backup even with every delegated permission',()=>fixture(async({call,restart})=>{
 const all=(await call('/api/admin/roles','AevonEcho')).data.catalog.map(x=>x.key);await grant(call,'Bob',all);const backup=await call('/api/admin/backup','AevonEcho');assert.equal(backup.status,200);assert.deepEqual(backup.data.users.Bob.adminPermissions,all);await restart();assert.equal((await call('/api/admin/backup','Bob')).status,403);
}));
