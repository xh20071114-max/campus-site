const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers.cjs');
const taskChannel='/api/channels/'+encodeURIComponent('任务大厅')+'/messages';
const chatChannel='/api/channels/'+encodeURIComponent('校园聊天')+'/messages';
async function grantPin(call){const d=(await call('/api/admin/roles','AevonEcho')).data,u=d.users.find(x=>x.username==='Bob');const r=await call('/api/admin/users/Bob/permissions','AevonEcho',{permissions:['pinMessages'],userId:u.userId,version:u.permissionsVersion});assert.equal(r.status,200)}

test('delegated pin permission is channel-scoped, capped, idempotent, and cleared on delete',()=>fixture(async({call})=>{
 await grantPin(call);
 const made=[];
 for(let i=0;i<4;i++){const r=await call(taskChannel,'Alice',{text:'Public task '+i,task:true});assert.equal(r.status,200);made.push(r.data)}
 const base=id=>taskChannel+'/'+id;
 assert.equal((await call(base(made[0].id)+'/pin','Alice',{})).status,403);
 for(const m of made.slice(0,3))assert.equal((await call(base(m.id)+'/pin','Bob',{})).status,200);
 assert.equal((await call(base(made[0].id)+'/pin','Bob',{})).status,200,'pinning twice is idempotent');
 assert.equal((await call(base(made[3].id)+'/pin','Bob',{})).status,409);
 const publicTask=(await call(taskChannel+'?rev=0','')).data.find(x=>x.id===made[0].id);
 assert.equal(publicTask.pinned,true);assert.equal('pinnedBy' in publicTask,false);assert.equal('pinnedAt' in publicTask,false);
 assert.equal((await call('/api/channels/'+encodeURIComponent('任务大厅')+'/pins','')).data.length,3);
 assert.equal((await call(base(made[1].id)+'/unpin','Bob',{})).status,200);
 assert.equal((await call(base(made[3].id)+'/pin','Bob',{})).status,200);
 const chat=await call(chatChannel,'Alice',{text:'Public chat line'});assert.equal(chat.status,200);
 assert.equal((await call(chatChannel+'/'+chat.data.id+'/pin','Bob',{})).status,200);
 assert.equal((await call('/api/channels/'+encodeURIComponent('校园聊天')+'/pins','')).data.length,1);
 assert.equal((await call('/api/channels/'+encodeURIComponent('任务大厅')+'/pins','')).data.length,3);
 assert.equal((await call(base(made[0].id)+'/delete','AevonEcho',{})).status,200);
 assert.equal((await call('/api/channels/'+encodeURIComponent('任务大厅')+'/pins','')).data.length,2);
}));
