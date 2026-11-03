const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http');
const {fixture,seed,sleep}=require('./helpers.cjs');

const START=Date.parse('2026-11-01T17:00:00.000Z'),DAY=86400000,KEY='2026-11-02'; // Monday 01:00 in Shanghai.
const PNG=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
function addUser(data,name){data.users[name]={...data.users.Bob,id:'account-'+name};data.sessions[name]={user:name,exp:START+60*DAY}}
function clockSeed(now){const data=seed();for(const u of Object.values(data.users))u.created=now-60*DAY;for(const s of Object.values(data.sessions))s.exp=now+60*DAY;return data}
function done(id,user,at,extra={}){return {id,task:true,user:'AevonEcho',claimedBy:user,claimedById:'account-'+user,text:'Completed reward task '+id,time:new Date(at-1000).toISOString(),done:true,doneAt:new Date(at).toISOString(),...extra}}
function period(start=START-7*DAY,rows=[]){return {key:new Date(start+8*3600000).toISOString().slice(0,10),startAt:new Date(start).toISOString(),endAt:new Date(start+6*DAY).toISOString(),createdAt:new Date(start+6*DAY).toISOString(),pointsSent:false,rows}}
const prize=(name='Bob',rank=1,count=20)=>({username:name,userId:'account-'+name,count,rank,cash:rank<=3?[10,5,3][rank-1]:0,points:rank>=4?5:0,eligible:rank<=3&&count>=20,status:rank<=3&&count>=20?'waiting_qr':rank>=4?'points_pending':'not_eligible'});
async function upload(base,key,token='Bob',bytes=PNG){const r=await fetch(base+'/api/my/weekly-reward/qr'+(key==null?'':'?period='+encodeURIComponent(key)),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'image/png'},body:bytes});return {status:r.status,data:await r.json()}}
function pendingUpload(base,key,token='Bob'){let yes,no;const response=new Promise((resolve,reject)=>{yes=resolve;no=reject});const req=http.request(base+'/api/my/weekly-reward/qr?period='+key,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'image/png','Content-Length':PNG.length}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{yes({status:res.statusCode,data:JSON.parse(text)})}catch(e){no(e)}})});req.on('error',no);req.write(PNG.subarray(0,8));return {req,response}}
function largePng(size){const type=Buffer.from('tEXt'),data=Buffer.alloc(size,97);Buffer.from('Comment\0').copy(data);const crcBytes=Buffer.concat([type,data]);let crc=0xffffffff;for(const byte of crcBytes){crc^=byte;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}const chunk=Buffer.alloc(size+12);chunk.writeUInt32BE(size);type.copy(chunk,4);data.copy(chunk,8);chunk.writeUInt32BE((crc^0xffffffff)>>>0,size+8);return Buffer.concat([PNG.subarray(0,-12),chunk,PNG.subarray(-12)])}

test('Shanghai rounds start Monday 01:00 and lock Sunday 01:00, with a one-day break',async t=>{
 let now=START-1;t.mock.method(Date,'now',()=>now);const data=clockSeed(now);
 await fixture(async({call,advanceTime})=>{
  assert.equal((await call('/api/leaderboard','')).data.live,null);
  now=START;await advanceTime(1);let d=(await call('/api/leaderboard','')).data;assert.equal(d.timezone,'Asia/Shanghai');assert.equal(d.live.startAt,new Date(START).toISOString());assert.equal(d.live.endAt,new Date(START+6*DAY).toISOString());
  now=START+6*DAY-1;await advanceTime(6*DAY-1);assert.equal((await call('/api/leaderboard','')).data.live.key,KEY);
  now++;await advanceTime(1);d=(await call('/api/leaderboard','')).data;assert.equal(d.live,null);assert.equal(d.locked.key,KEY);
  now=START+7*DAY-1;await advanceTime(DAY-1);assert.equal((await call('/api/leaderboard','')).data.live,null);
  now++;await advanceTime(1);d=(await call('/api/leaderboard','')).data;assert.equal(d.live.key,'2026-11-09');assert.equal(d.live.startAt,new Date(START+7*DAY).toISOString());
 },data,{clock:true});
});

test('the leaderboard counts only distinct completed tasks in the period and does not inherit a reused account',async t=>{
 const now=START+6*DAY-1;t.mock.method(Date,'now',()=>now);const data=clockSeed(now);
 data.messages={'校园跑':[done(101,'Bob',START-1),done(102,'Bob',START),done(103,'Bob',START+DAY),done(104,'Bob',START+6*DAY-1),done(105,'Bob',START+6*DAY),done(106,'Bob',START+DAY,{done:false}),done(107,'Bob',START+DAY,{claimedById:'old-Bob'}),done(108,'Bob',START+DAY,{cancelled:true}),done(109,'Bob',START+DAY,{closed:true}),done(110,'Bob',START+DAY,{deleted:true}),done(111,'Bob',START+DAY,{claimerDeleted:true}),done(112,'Bob',START+DAY,{doneAt:'invalid'})], '校园配送':[done(103,'Bob',START+DAY)]};
 await fixture(async({call})=>{const d=(await call('/api/leaderboard','Bob')).data;assert.deepEqual(d.live.rows.map(x=>[x.username,x.count,x.mine]),[['Bob',3,true]]);assert.equal(d.live.rows[0].eligible,false);assert.equal(JSON.stringify(d).includes('account-Bob'),false)},data,{clock:true});
});

test('the leaderboard caps at ten and a tie ranks the person who reached the count first',async t=>{
 const now=START+2*DAY;t.mock.method(Date,'now',()=>now);const data=clockSeed(now);data.messages={'校园跑':[]};let id=200;
 for(let i=0;i<12;i++){const name='Runner'+String(i).padStart(2,'0');addUser(data,name);for(let j=0;j<20-i;j++)data.messages['校园跑'].push(done(id++,name,START+1000+j))}
 // Runner01 has 19 tasks. Bob has the same count but completed the nineteenth later.
 for(let j=0;j<19;j++)data.messages['校园跑'].push(done(id++,'Bob',START+5000+j));
 await fixture(async({call})=>{const rows=(await call('/api/leaderboard','')).data.live.rows;assert.equal(rows.length,10);assert.deepEqual(rows.slice(0,3).map(r=>r.username),['Runner00','Runner01','Bob']);assert.deepEqual(rows.map(x=>x.rank),[1,2,3,4,5,6,7,8,9,10]);assert.equal(rows[0].eligible,true);assert.equal(rows[1].eligible,false);assert.equal(rows[2].eligible,false)},data,{clock:true});
});

test('Sunday locks prizes, Monday credits ranks 4-10 once, and restarting does not pay twice',async t=>{
 let now=START+6*DAY-1;t.mock.method(Date,'now',()=>now);const data=clockSeed(now);addUser(data,'Runner4');data.messages={'校园跑':[]};let id=400;
 for(const [name,count] of [['Bob',22],['Carol',21],['Alice',19],['Runner4',2]])for(let i=0;i<count;i++)data.messages['校园跑'].push(done(id++,name,START+DAY+i));
 await fixture(async({call,advanceTime,restart})=>{
  now++;await advanceTime(1);let board=(await call('/api/leaderboard','Bob')).data;assert.equal(board.locked.key,KEY);assert.equal(board.live,null);assert.deepEqual(board.locked.rows.map(r=>[r.rank,r.cash,r.eligible,r.points]),[[1,10,true,0],[2,5,true,0],[3,3,false,0],[4,0,false,5]]);assert.equal((await call('/api/my/points','Runner4')).data.points,100);
  now=START+7*DAY;await advanceTime(DAY);let periods=(await call('/api/admin/weekly-rewards','AevonEcho')).data;assert.equal(periods.find(p=>p.key===KEY).pointsSent,true);let points=(await call('/api/my/points','Runner4')).data;assert.equal(points.points,105);assert.equal(points.log.filter(x=>x.type==='weekly_reward').length,1);
  await restart();await call('/api/leaderboard','');points=(await call('/api/my/points','Runner4')).data;assert.equal(points.points,105);assert.equal(points.log.filter(x=>x.type==='weekly_reward').length,1);assert.equal((await call('/api/my/points','Alice')).data.points,100);
 },data,{clock:true});
});

test('completing an actual task adds one completion and repeated confirmations do not add another',()=>fixture(async({call,task,act})=>{
 const m=await task('Alice',{text:'Count once'});await act(m,'Bob','claim');await act(m,'Bob','finish');await act(m,'Alice','paid');assert.equal((await act(m,'Bob','received')).status,200);assert.equal((await act(m,'Bob','received')).status,409);const board=(await call('/api/leaderboard','Bob')).data;if(board.live)assert.equal(board.live.rows.find(r=>r.mine).count,1);else assert.equal(board.live,null);
}));

test('cash QR uploads are private, bound to the chosen period, preserve original bytes and use versioned payout records',async()=>{
 const data=seed(),old=period(START-14*DAY,[prize()]),recent=period(START-7*DAY,[prize()]);data.weeklyRewards=[old,recent];data.users.Carol.adminPermissions=['manageRecharges'];
 await fixture(async({call,base,tmp})=>{
  assert.equal((await upload(base,old.key,'')).status,401);assert.equal((await upload(base,old.key,'Carol')).status,403);assert.equal((await upload(base,null)).status,400);assert.equal((await upload(base,'2099-01-01')).status,403);assert.equal((await upload(base,old.key,'Bob',Buffer.from('<svg></svg>'))).status,400);assert.equal((await upload(base,old.key,'Bob',Buffer.alloc(2*1024*1024+1))).status,413);
  const original=largePng(350*1024);assert.ok(original.length>300*1024);assert.equal((await upload(base,old.key,'Bob',original)).status,200);
  let periods=(await call('/api/admin/weekly-rewards','AevonEcho')).data,record=periods.find(x=>x.key===old.key).rows[0];assert.equal(record.hasQr,true);assert.equal(periods.find(x=>x.key===recent.key).rows[0].hasQr,false);assert.ok(record.qrVersion);const endpoint='/api/admin/weekly-rewards/'+old.key+'/account-Bob';
  assert.equal((await call('/api/admin/weekly-rewards','Bob')).status,403);assert.equal((await call(endpoint+'/qr','Bob')).status,403);assert.equal((await call(endpoint+'/qr','Carol')).status,403);const image=await fetch(base+endpoint+'/qr',{headers:{Authorization:'Bearer AevonEcho'}});assert.equal(image.status,200);assert.equal(image.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await image.arrayBuffer()),original);
  const publicBoard=(await call('/api/leaderboard','')).data;assert.equal(JSON.stringify(publicBoard).includes('qrFile'),false);assert.equal(JSON.stringify(publicBoard).includes('account-Bob'),false);assert.equal(publicBoard.myRewards.length,0);
  const file=(await fs.readdir(path.join(tmp,'weekly-reward-qr')))[0];assert.equal((await fetch(base+'/weekly-reward-qr/'+file)).status,403);
  assert.equal((await call(endpoint+'/paid','AevonEcho',{})).status,409);const stale=record.qrVersion;assert.equal((await upload(base,old.key)).status,200);record=(await call('/api/admin/weekly-rewards','AevonEcho')).data.find(x=>x.key===old.key).rows[0];assert.notEqual(record.qrVersion,stale);assert.equal((await call(endpoint+'/paid','AevonEcho',{qrVersion:stale})).status,409);assert.equal((await call(endpoint+'/paid','AevonEcho',{qrVersion:record.qrVersion})).status,200);assert.equal((await call(endpoint+'/paid','AevonEcho',{qrVersion:record.qrVersion})).status,409);assert.equal((await upload(base,old.key)).status,403);
  const stored=JSON.parse(await fs.readFile(path.join(tmp,'data.json'),'utf8')).weeklyRewards.find(x=>x.key===old.key).rows[0];assert.equal(stored.paidBy,'AevonEcho');assert.equal(stored.status,'paid');
 },data);
});

for(const action of ['logout','ban','recreate'])test('a QR upload is rejected if the original account changes during upload: '+action,async()=>{
 const data=seed(),p=period(START-7*DAY,[prize()]);data.weeklyRewards=[p];await fixture(async({call,base,tmp})=>{
  const pending=pendingUpload(base,p.key);try{await sleep(40);if(action==='logout')await call('/api/logout','Bob',{});else if(action==='ban')await call('/api/admin/users/Bob/ban','AevonEcho',{reason:'Regression'});else{await call('/api/admin/users/Bob/delete','AevonEcho',{});assert.equal((await call('/api/register','',{username:'Bob',password:'password123'})).status,200)}pending.req.end(PNG.subarray(8));const result=await pending.response;assert.ok([401,403].includes(result.status),JSON.stringify(result));const files=await fs.readdir(path.join(tmp,'weekly-reward-qr')).catch(e=>e.code==='ENOENT'?[]:Promise.reject(e));assert.equal(files.length,0)}finally{pending.req.destroy()}
 },data);
});

test('a recreated winner account cannot submit a QR or inherit payout ownership',async()=>{
 const data=seed(),p=period(START-7*DAY,[prize()]);data.weeklyRewards=[p];await fixture(async({call,base})=>{
  assert.equal((await upload(base,p.key)).status,200);let row=(await call('/api/admin/weekly-rewards','AevonEcho')).data.find(x=>x.key===p.key).rows[0];assert.equal((await call('/api/admin/users/Bob/delete','AevonEcho',{})).status,200);const reg=await call('/api/register','',{username:'Bob',password:'password123'});assert.equal(reg.status,200);assert.equal((await upload(base,p.key,reg.data.token)).status,403);assert.notEqual((await call('/api/admin/weekly-rewards/'+p.key+'/account-Bob/paid','AevonEcho',{qrVersion:row.qrVersion})).status,200);const board=(await call('/api/leaderboard',reg.data.token)).data;assert.equal(board.myRewards.length,0);assert.ok(!board.locked?.rows.some(r=>r.mine));
 },data);
});

test('nineteen completions and points-only ranks cannot submit cash QR codes, and banned winners cannot be paid',async()=>{
 const data=seed(),p=period(START-7*DAY,[prize('Bob',1,19),prize('Carol',2,20),prize('Alice',4,5)]);data.weeklyRewards=[p];
 await fixture(async({call,base})=>{
  assert.equal((await upload(base,p.key,'Bob')).status,403);assert.equal((await upload(base,p.key,'Alice')).status,403);assert.equal((await upload(base,p.key,'Carol')).status,200);
  const before=(await call('/api/admin/weekly-rewards','AevonEcho')).data.find(x=>x.key===p.key).rows.find(x=>x.username==='Carol');assert.equal((await call('/api/admin/users/Carol/ban','AevonEcho',{reason:'Regression hold'})).status,200);
  assert.equal((await upload(base,p.key,'Carol')).status,403);const after=(await call('/api/admin/weekly-rewards','AevonEcho')).data.find(x=>x.key===p.key).rows.find(x=>x.username==='Carol');assert.equal(after.userBanned,true);assert.equal((await call('/api/admin/weekly-rewards/'+p.key+'/account-Carol/paid','AevonEcho',{qrVersion:before.qrVersion})).status,409);
 },data);
});


test('first activation does not back-pay already ended rounds or skip a legacy account signup grant',async t=>{
 const now=START+6*DAY+3600000;t.mock.method(Date,'now',()=>now);const data=clockSeed(now);delete data.users.Bob.points;data.messages={'校园跑':Array.from({length:20},(_,i)=>done(2000+i,'Bob',START+DAY+i))};
 await fixture(async({call})=>{const board=(await call('/api/leaderboard','Bob')).data;assert.equal(board.live,null);assert.equal(board.locked,null);assert.equal(board.myRewards.length,0);assert.deepEqual((await call('/api/admin/weekly-rewards','AevonEcho')).data,[]);const points=(await call('/api/my/points','Bob')).data;assert.equal(points.points,10);assert.equal(points.log.filter(x=>x.type==='weekly_reward').length,0)},data,{clock:true});
});
