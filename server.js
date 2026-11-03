// Aevon校园交流网 后端：静态文件 + 登录 + 频道消息 + 公告（数据存 data.json，每日备份到 backups/）
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const PORT=process.env.PORT||3000,BIND_HOST=process.env.BIND_HOST||'0.0.0.0', ROOT=__dirname, DATA_DIR=path.resolve(process.env.DATA_DIR||ROOT), DB=path.join(DATA_DIR,'data.json'), BAK=path.join(DATA_DIR,'backups');
try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch{}
const CHANNELS=['校园跑','食堂配送','代取快递','代课','代做作业'];
// 权限键由服务端统一维护；授予权限和完整备份始终仅限总管理员。
const PERMISSIONS=[
  ['viewUsers','用户管理','查看用户','查看账号、状态和积分'],
  ['banUsers','用户管理','封禁与解封','含查看用户；仅操作普通用户'],
  ['deleteUsers','用户管理','删除用户','含查看用户；仅删除普通用户，删除不可恢复'],
  ['managePoints','用户管理','调整用户积分','含查看用户；仅调整普通用户积分'],
  ['viewMessages','内容管理','查看消息与议价','查看全部频道消息、已删除原文和议价历史'],
  ['deleteMessages','内容管理','删除消息与任务','含查看消息；可选择退还任务积分'],
  ['viewChats','内容管理','查看任务私聊','只读查看全部任务私聊、议价历史及图片'],
  ['joinChats','内容管理','参与任务私聊','含查看私聊；可用管理员身份在进行中的订单发言及发送图片'],
  ['manageAnnouncements','内容管理','管理全站公告','发布与删除全站公告'],
  ['manageRecharges','积分与审核','审核充值','查看充值记录，核对后通过或拒绝并发放积分'],
  ['manageSettings','积分与审核','修改积分规则','设置注册送分、发布与接单消耗'],
  ['publishBonus','积分与审核','发布积分奖励任务','设置完成任务后发放的奖励积分'],
  ['manageFeedback','平台事务','处理建议与联系','查看、回复联系留言和封禁申诉，标记已读或删除'],
  ['manageReports','平台事务','处理举报','查看、处理及删除举报'],
  ['manageDisputes','平台事务','处理任务纠纷','查看纠纷、任务详情和议价，强制完成或关闭并选择退分；私聊需另授权'],
  ['postOfficial','其他权限','发布频道通知','在频道发布非任务通知并使用官方标记'],
  ['freeTasks','其他权限','免任务手续费','发布任务和接单不消耗积分']
].map(([key,group,label,description])=>({key,group,label,description}));
const PERMISSION_KEYS=new Set(PERMISSIONS.map(x=>x.key));
// 读数据：data.json 坏了绝不用空库覆盖。先把坏文件改名，再从最近一份能解析的备份恢复；都不行就拒绝启动
const parseDB=t=>{const d=JSON.parse(t),object=x=>!!x&&typeof x==='object'&&!Array.isArray(x),check=(ok,field)=>{if(!ok)throw new Error('数据结构无效：'+field)};
  check(object(d),'根对象');for(const k of ['users','messages'])check(Object.hasOwn(d,k)&&object(d[k]),k);
  for(const k of ['sessions','deletedTexts','settings','taskChats','chatRead','events','offers','imgDaily'])if(Object.hasOwn(d,k))check(object(d[k]),k);
  for(const k of ['ledger','recharges','feedback','reports','announcements'])if(Object.hasOwn(d,k))check(Array.isArray(d[k])&&d[k].every(object),k);
  for(const k of ['messages','taskChats','events','offers'])for(const l of Object.values(d[k]||{}))check(Array.isArray(l)&&l.every(x=>object(x)&&/^[0-9]+$/.test(String(x.id))&&Number.isSafeInteger(Number(x.id))&&Number(x.id)>0),k);
  for(const k of ['taskChats','chatRead','offers'])for(const id of Object.keys(d[k]||{}))check(/^[0-9]+$/.test(id)&&Number.isSafeInteger(Number(id))&&Number(id)>0,k+' 任务 ID');
  for(const l of Object.values(d.taskChats||{}))for(const x of l)if(x.image)check(['jpg','png'].includes(x.imageExt),'taskChats 图片类型');
  for(const u of Object.values(d.users)){check(object(u)&&typeof u.pw==='string'&&u.pw.length>0&&(typeof u.created==='number'||typeof u.created==='string')&&Number.isFinite(new Date(u.created).getTime())&&(!Object.hasOwn(u,'points')||(Number.isSafeInteger(u.points)&&u.points>=0)),'users 记录');
    if(Object.hasOwn(u,'adminPermissions'))check(Array.isArray(u.adminPermissions)&&u.adminPermissions.every(k=>PERMISSION_KEYS.has(k)),'users 管理权限');}
  for(const x of Object.values(d.sessions||{}))check((typeof x==='string'&&x.length>0)||(object(x)&&typeof x.user==='string'&&Number.isFinite(x.exp)),'sessions 记录');
  for(const x of Object.values(d.chatRead||{}))check(object(x),'chatRead 记录');
  for(const k of ['postCost','claimCost','signupBonus'])if(d.settings&&Object.hasOwn(d.settings,k))check(Number.isSafeInteger(d.settings[k])&&d.settings[k]>=0&&d.settings[k]<=1000000,'settings.'+k);
  return d};
function loadDB(){
  const fromBackup=why=>{let files=[];try{files=fs.readdirSync(BAK).filter(f=>/^data-.*\.json$/.test(f)).sort().reverse()}catch{}
    for(const f of files){try{const d=parseDB(fs.readFileSync(path.join(BAK,f),'utf8'));console.error(why+'，已从备份恢复：'+f);return d}catch(e){console.error('备份也坏了，跳过：'+f,e.message)}}
    return null};
  if(!fs.existsSync(DB)){const d=fromBackup('data.json 不存在');if(d)return d; // 之前坏过（有 data.corrupt-*）又没有备份：不能当成全新站点用空库启动
    const old=fs.readdirSync(DATA_DIR).some(f=>/^data\.corrupt-.*\.json$/.test(f)||f==='data.json.tmp');
    const hasFiles=dir=>fs.existsSync(dir)&&fs.readdirSync(dir).length>0;
    if(old||hasFiles(BAK)||hasFiles(path.join(DATA_DIR,'uploads'))){console.error('发现历史数据，但主库缺失且没有能用的备份，拒绝用空库启动，请人工处理');process.exit(1)}
    return {users:{},sessions:{},messages:{}}}
  try{return parseDB(fs.readFileSync(DB,'utf8'))}catch(e){
    const bad=path.join(DATA_DIR,'data.corrupt-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');
    console.error('data.json 解析失败：'+e.message);
    try{fs.renameSync(DB,bad);console.error('坏文件已改名为 '+bad)}catch(e2){console.error('坏文件改名失败，拒绝启动',e2.message);process.exit(1)}
    const d=fromBackup('data.json 解析失败'); if(d) return d;
    console.error('没有能用的备份，拒绝启动。坏文件在 '+bad+'，请人工处理');process.exit(1)}}
let db=loadDB();
db.users=db.users||{};db.sessions=db.sessions||{};db.messages=db.messages||{};db.announcements=db.announcements||[];db.deletedTexts=db.deletedTexts||{};
// 用无原型对象，防止 __proto__、constructor 这类用户名或频道名命中内置属性
for(const k of ['users','sessions','messages','deletedTexts']) if(db[k]&&typeof db[k]==='object') db[k]=Object.assign(Object.create(null),db[k]);
CHANNELS.forEach(c=>db.messages[c]=db.messages[c]||[]);
// 保留旧记录 ID；新 ID 在同一毫秒和时钟回退时也严格递增，重启后不会复用。
let lastId=Number.isSafeInteger(db.lastId)?db.lastId:0;
const rememberId=x=>{const id=Number(x.id);if(Number.isSafeInteger(id)&&id>lastId)lastId=id};
for(const k of ['messages','taskChats','events','offers']) for(const l of Object.values(db[k]||{})) if(Array.isArray(l)) l.forEach(rememberId);
for(const k of ['ledger','recharges','feedback','reports','announcements']) if(Array.isArray(db[k])) db[k].forEach(rememberId);
db.lastId=lastId;
const newId=()=>{lastId=Math.max(Date.now()*1000,lastId+1);if(!Number.isSafeInteger(lastId))throw new Error('ID 超出安全整数范围');return db.lastId=lastId};
for(const u of Object.values(db.users)) if(!u.id)u.id=crypto.randomUUID();
// 临时文件写入并 fsync 后再替换主库。接口成功响应前会刷新待写数据。
// 写盘失败时停止接受操作并退出，避免在未保存的余额上继续交易。
let persistTimer=null,storageError=null;
const failStorage=e=>{if(storageError)return;storageError=e;console.error('数据保存失败，停止服务以保护已保存数据',e.message);setTimeout(()=>process.exit(1),100).unref()};
const atomicWrite=(file,source)=>{let fd;try{fd=fs.openSync(file+'.tmp','w');if(typeof source==='function')source(fd);else fs.writeFileSync(fd,source);fs.fsyncSync(fd)}finally{if(fd!==undefined)fs.closeSync(fd)}fs.renameSync(file+'.tmp',file)};
// 按集合中的记录分块序列化，避免整库字符串和 UTF-8 Buffer 同时驻留。
function* jsonChunks(value,depth=0){if(Array.isArray(value)){yield '[';for(let i=0;i<value.length;i++){if(i)yield ',';yield JSON.stringify(value[i])??'null'}yield ']'}
  else if(value&&typeof value==='object'&&depth<2&&typeof value.toJSON!=='function'){yield '{';let separator='';for(const [k,v] of Object.entries(value)){if(['undefined','function','symbol'].includes(typeof v))continue;yield separator+JSON.stringify(k)+':';separator=',';yield*jsonChunks(v,depth+1)}yield '}'}
  else yield JSON.stringify(value)}
const writeJSON=(fd,value)=>{let parts=[],size=0;const flush=()=>{if(!size)return;const b=Buffer.from(parts.join(''));for(let offset=0;offset<b.length;){const n=fs.writeSync(fd,b,offset,b.length-offset);if(!n)throw new Error('数据写入没有进展');offset+=n}parts=[];size=0};for(const chunk of jsonChunks(value)){parts.push(chunk);size+=chunk.length;if(size>=65536)flush()}flush()};
const persistNow=()=>{if(storageError)throw storageError;if(persistTimer){clearTimeout(persistTimer);persistTimer=null}atomicWrite(DB,fd=>writeJSON(fd,db))};
const persist=(ms=200)=>{if(!persistTimer&&!storageError)persistTimer=setTimeout(()=>{persistTimer=null;try{persistNow()}catch(e){failStorage(e)}},ms)};
process.on('exit',()=>{if(persistTimer)try{persistNow()}catch{}});
for(const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>{try{persistNow()}catch{}process.exit(0)});
// 唯一总管理员；普通管理员的权限绑定在不可复用的用户记录上。
const ADMIN=(process.env.ADMIN||(process.env.ADMINS||'').split(',')[0]||'AevonEcho').trim();
const ADMINS=ADMIN?[ADMIN]:[];
const banned=n=>!!(n&&db.users[n]&&db.users[n].banned);
const BANNED={error:'账号已被封禁',banned:true};
const isSuperAdmin=n=>!!n&&n===ADMIN;
const hasAdminRole=n=>!!n&&!!db.users[n]&&(isSuperAdmin(n)||(db.users[n].adminPermissions||[]).length>0);
const isAdmin=n=>hasAdminRole(n)&&!banned(n);
const can=(n,key)=>isAdmin(n)&&(isSuperAdmin(n)||(db.users[n].adminPermissions||[]).includes(key));
const canUsers=n=>['viewUsers','banUsers','deleteUsers','managePoints'].some(k=>can(n,k));
const canMessages=n=>can(n,'viewMessages')||can(n,'deleteMessages');
const canReadChat=n=>can(n,'viewChats')||can(n,'joinChats');
const canInspect=n=>canMessages(n)||canReadChat(n)||can(n,'manageDisputes');
const activeChat=m=>!!m.claimedBy&&!m.done&&!m.cancelled&&!m.closed&&!m.deleted;
const canWriteChat=(m,n)=>(isPoster(m,n)||isClaimer(m,n)||can(n,'joinChats')&&activeChat(m))&&!!m.claimedBy&&!m.cancelled&&!m.deleted&&!banned(n);
const roleInfo=n=>({admin:isAdmin(n),superAdmin:isSuperAdmin(n),permissions:isSuperAdmin(n)?[...PERMISSION_KEYS]:(db.users[n]?.adminPermissions||[]).slice()});
const protectedUser=(actor,target)=>isSuperAdmin(target)||(!isSuperAdmin(actor)&&hasAdminRole(target));
const legacy=p=>crypto.createHash("sha256").update("campus:"+p).digest("hex");
const hash=(p,salt=crypto.randomBytes(16).toString("hex"))=>"s1$"+salt+"$"+crypto.scryptSync(p,salt,32).toString("hex");
// 每次 scrypt 约占 16MB 原生内存，限制并发并为等待队列设上限。
let hashActive=0;const hashQueue=[],HASH_CONCURRENCY=2,HASH_WAIT_MAX=8;
const runHash=job=>{hashActive++;const done=(e,k)=>{hashActive--;if(hashQueue.length)runHash(hashQueue.shift());e?job.no(e):job.ok(k)};try{crypto.scrypt(job.p,job.salt,32,done)}catch(e){done(e)}};
const scryptA=(p,salt)=>new Promise((ok,no)=>{const job={p,salt,ok,no};if(hashActive<HASH_CONCURRENCY)runHash(job);else if(hashQueue.length<HASH_WAIT_MAX)hashQueue.push(job);else no(Object.assign(new Error('登录服务繁忙，请稍后重试'),{statusCode:503}))});
const hashA=async(p,salt=crypto.randomBytes(16).toString("hex"))=>"s1$"+salt+"$"+(await scryptA(p,salt)).toString("hex");
const verifyA=async(p,h)=>{if(!h)return false;if(!h.startsWith("s1$"))return h===legacy(p);const salt=h.split("$")[1];const x=Buffer.from(await hashA(p,salt)),y=Buffer.from(h);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const verify=(p,h)=>{if(!h)return false;if(!h.startsWith("s1$"))return h===legacy(p);const salt=h.split("$")[1];return crypto.timingSafeEqual(Buffer.from(hash(p,salt)),Buffer.from(h))};
const SESSION_MS=7*24*3600e3,hits=new Map(),RATE_KEYS_MAX=10000,FAIL_KEYS_MAX=20000;
let invalidSessions=0;for(const [t,s] of Object.entries(db.sessions)){const u=typeof s==='object'&&db.users[s.user];if(!u||Date.now()>=s.exp||(s.userId&&s.userId!==u.id)){delete db.sessions[t];invalidSessions++}else s.userId=u.id}
if(invalidSessions)console.log('已使旧版或无效登录失效：'+invalidSessions);
// 按账号限制登录失败：同一用户名 15 分钟内错 10 次就先锁住，不管请求从哪个 IP 来
const fails=new Map(),loginPending=new Map(),FAIL_MS=15*60e3,failKey=n=>String(n).toLowerCase();
const failCount=n=>{const k=failKey(n),a=(fails.get(k)||[]).filter(t=>Date.now()-t<FAIL_MS);if(fails.has(k))fails.set(k,a);return a.length};
const addFail=n=>{const k=failKey(n);fails.set(k,[...(fails.get(k)||[]),Date.now()].slice(-50))};
const limited=(key,max=20)=>{if(!hits.has(key)&&hits.size>=RATE_KEYS_MAX)return true;const now=Date.now(),a=(hits.get(key)||[]).filter(t=>now-t<60e3);a.push(now);hits.set(key,a.slice(-(max+1)));return a.length>max};
const nextRev=()=>db.rev=(db.rev||0)+1;
// ===== 积分 =====
db.settings=Object.assign({postCost:1,claimCost:1,signupBonus:10},db.settings||{}); db.ledger=db.ledger||[]; db.recharges=db.recharges||[]; db.feedback=db.feedback||[];
// 任务私聊：taskChats[任务id]=[{id,user,text,time,claimer}]；chatRead[任务id][用户]=读到的最后一条 id
db.taskChats=Object.assign(Object.create(null),db.taskChats||{}); db.chatRead=Object.assign(Object.create(null),db.chatRead||{}); for(const k in db.chatRead) db.chatRead[k]=Object.assign(Object.create(null),db.chatRead[k]);
const S=()=>db.settings, pts=n=>(db.users[n]&&db.users[n].points)||0;
const intIn=(v,min,max)=>{const x=typeof v==='string'&&v.trim()!==''?Number(v):v;return Number.isInteger(x)&&x>=min&&x<=max?x:null};
// 改积分必须走这里：同步完成「改余额+记流水」，中间没有 await，并发请求不会扣成负数
const addPoints=(n,delta,type,reason,ref)=>{const u=db.users[n];if(!u||!delta)return;u.points=(u.points||0)+delta;db.ledger.push({id:newId(),user:n,time:new Date().toISOString(),delta,balance:u.points,type,reason:reason||'',...(ref!=null?{ref:String(ref)}:{})})};
const noPoints=(n,need)=>({error:'积分不足：需要 '+need+' 积分，当前 '+pts(n)+' 积分，请先充值',points:pts(n),need});
for(const [k,u] of Object.entries(db.users)) if(u.points==null){u.points=0;if(!isAdmin(k))addPoints(k,S().signupBonus,'signup','老账号补发注册积分')}
// 任务私聊辅助：找任务、判断能不能读、算未读
// 按 id 的消息索引：IDX[id]={msg,ch}（消息只会标记删除，不会从数组里移除）
const IDX=new Map(); for(const c of CHANNELS) for(const m of db.messages[c]) IDX.set(String(m.id),{msg:m,ch:c});
const findTask=id=>{const t=IDX.get(String(id));return t&&t.msg.task?t:null};
const isPoster=(m,n)=>m.user===n&&!m.userDeleted, isClaimer=(m,n)=>!!m.claimedBy&&m.claimedBy===n&&!m.claimerDeleted;
const chatOf=(m,all)=>(db.taskChats[m.id]||[]).filter(x=>all||(m.claimedBy&&x.claimer===m.claimedBy&&(!x.claimerGone||m.claimerDeleted)));
// 私聊未读增量维护：UR[用户][任务id]=未读数，TU[任务id]=有未读的用户；任务的私聊或状态变了就只重算这一个任务
const UR=new Map(), TU=new Map();
const rawUnread=(m,n)=>{const last=(db.chatRead[m.id]&&db.chatRead[m.id][n])||0;return chatOf(m).filter(x=>x.id>last&&x.user!==n).length};
const recalc=m=>{const id=String(m.id); for(const n of TU.get(id)||[]){const a=UR.get(n); if(a){a.delete(id); if(!a.size)UR.delete(n)}} TU.delete(id);
  if(!m.task||m.deleted||!m.claimedBy) return; const st=new Set();
  for(const n of [m.user,m.claimedBy]) if(isPoster(m,n)||isClaimer(m,n)){const k=rawUnread(m,n); if(k){if(!UR.has(n))UR.set(n,new Map()); UR.get(n).set(id,k); st.add(n)}}
  if(st.size) TU.set(id,st)};
const rebuildUR=()=>{UR.clear();TU.clear();for(const c of CHANNELS)for(const m of db.messages[c])if(m.task&&!m.deleted&&m.claimedBy&&db.taskChats[m.id])recalc(m)};
const chatUnread=(m,n)=>{if(!(isPoster(m,n)||isClaimer(m,n)))return undefined; const a=UR.get(n); return (a&&a.get(String(m.id)))||0};
const withUnread=(x,n)=>{if(!n)return x;const c=chatUnread(x,n);return c===undefined?x:{...x,chatUnread:c}};
// 往私聊里写一条系统消息
const sysChat=(m,text)=>{const l=db.taskChats[m.id]=db.taskChats[m.id]||[];l.push({id:newId(),type:'system',user:'系统',text,time:new Date().toISOString(),claimer:m.claimedBy||null});recalc(m)};
const finishTask=(m,now)=>{m.done=true;m.doneAt=now;delete m.stage;if(m.bonusPoints&&!m.bonusPaid&&!m.claimerDeleted&&db.users[m.claimedBy]){addPoints(m.claimedBy,m.bonusPoints,'bonus','完成积分任务',m.id);m.bonusPaid=true}};
// 任务动态：events[用户]=[{id,type,taskId,channel,text,time,read}]，每人最多 200 条
db.events=Object.assign(Object.create(null),db.events||{}); db.reports=db.reports||[];
// 讨价：offers[任务id]=[{id,user,status:pending|accepted|rejected|withdrawn|expired,price,turn:poster|claimer,rounds:[{by,price,note,time}],time,updated,reason?}]
db.offers=Object.assign(Object.create(null),db.offers||{});
// 旧库议价按账号创建时间迁移；已注销账号的记录只保留给发布人和管理员。
for(const l of Object.values(db.offers)) for(const o of l){const u=db.users[o.user];
  if(!u||o.userDeleted||(o.userId?o.userId!==u.id:!(Date.parse(o.time)>=Number(u.created)))){o.userDeleted=true;if(o.status==='pending'){o.status='expired';o.reason='原账号已注销或身份无法确认';o.updated=new Date().toISOString()}}
  else o.userId=u.id}
const ownsOffer=(o,n)=>!o.userDeleted&&o.user===n&&!!db.users[n]&&o.userId===db.users[n].id;
const resetNegotiation=m=>{if(!m.negotiated)return;if(m.originalReward)m.reward=m.originalReward;else delete m.reward;delete m.originalReward;delete m.negotiated;delete m.offerId};
const OFFER_MAX_PENDING=10, OFFER_MAX_ROUNDS=6; // 来回 3 轮 = 最多 6 次出价（讨价 1 次 + 还价最多 5 次）
const pendingOffers=m=>(db.offers[m.id]||[]).filter(o=>o.status==='pending');
const offerPrice=v=>{const x=typeof v==='string'&&v.trim()!==''?Number(v.trim()):v; return typeof x==='number'&&isFinite(x)&&x>=0.01&&x<=100000?Math.round(x*100)/100:null};
// 让任务上所有进行中的讨价失效，并给讨价人发动态（actor 是触发的人，不给他自己发）
// 给前端的 offer：额外带 note（最新留言）、round（第几轮，1-3）、counter（发布人最新还价）、history、canCounter；有还价且没结束时 status 显示 countered，原状态在 rawStatus
const offerView=(o,m,v)=>{const last=o.rounds[o.rounds.length-1], pc=[...o.rounds].reverse().find(x=>x.by==='poster'), myTurn=!!v&&(v===m.user?o.turn==='poster':v===o.user?o.turn==='claimer':false);
  return {...o,task:m.id,rawStatus:o.status,status:o.status==='pending'&&o.rounds.length>1?'countered':o.status,note:last?last.note:'',round:Math.ceil(o.rounds.length/2),maxRound:3,counter:pc?pc.price:null,myTurn,canCounter:o.status==='pending'&&myTurn&&o.rounds.length<OFFER_MAX_ROUNDS,
    history:o.rounds.map((x,i)=>({by:x.by,action:i===0?'offer':'counter',price:x.price,note:x.note,time:x.time})).concat(o.status!=='pending'?[{by:o.status==='rejected'?'poster':o.status==='withdrawn'?'claimer':o.status==='accepted'?(o.turn==='poster'?'poster':'claimer'):'system',action:o.status==='accepted'?'accept':o.status==='rejected'?'reject':o.status==='withdrawn'?'withdraw':'expire',price:o.price,note:o.reason||'',time:o.updated}]:[])}};
const expireOffers=(m,why,actor)=>{let k=0; for(const o of pendingOffers(m)){o.status='expired';o.reason=why;o.updated=new Date().toISOString();k++; if(ownsOffer(o,o.user))ev(o.user,'offer_expire',m,'你的讨价已失效：'+why,actor)} return k};
const ev=(u,type,m,text,actor)=>{if(!u||u===actor||!db.users[u])return; if(u===m.user&&m.userDeleted)return; if(u===m.claimedBy&&m.claimerDeleted&&u!==m.user)return;
  const l=db.events[u]=db.events[u]||[]; l.push({id:newId(),type,taskId:m.id,channel:chOf(m),task:String(m.text||db.deletedTexts[m.id]||'').slice(0,40),text,time:new Date().toISOString(),read:false}); if(l.length>200) l.splice(0,l.length-200)};
const chOf=m=>{const t=IDX.get(String(m.id));return t?t.ch:null};
const totalChatUnread=n=>{let t=0;const a=UR.get(n);if(a)for(const v of a.values())t+=v;return t};
rebuildUR();
// 排序：new 最新在前；reward 按悬赏里的数字从高到低（加上奖励积分）；deadline 截止时间最近的在前，没写截止时间的排最后
const rewardNum=x=>{const v=parseFloat(String(x.reward||'').replace(/[^\d.]/g,''));return (isNaN(v)?0:v)+(x.bonusPoints||0)};
const taskComparator=so=>so==='reward'?(a,b)=>rewardNum(b)-rewardNum(a)||b.id-a.id:so==='deadline'?(a,b)=>(a.deadline?Date.parse(a.deadline):Infinity)-(b.deadline?Date.parse(b.deadline):Infinity)||b.id-a.id:(a,b)=>b.id-a.id;
const sortTasks=(l,so)=>l.slice().sort(taskComparator(so));
const send=(res,code,obj)=>{if(code>=200&&code<300){try{if(storageError)throw storageError;if(persistTimer)persistNow()}catch(e){failStorage(e);code=503;obj={error:'数据保存失败，服务暂时不可用，请稍后重试'}}}res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
// 请求体只读一次，用字节限额并在拼接后解码，避免中文跨网络分片损坏。
const body=req=>req.jsonBody||(req.jsonBody=new Promise((resolve,reject)=>{const chunks=[];let size=0,ended=false;
  const fail=(statusCode,message)=>{if(ended)return;ended=true;chunks.length=0;reject(Object.assign(new Error(message),{statusCode}))};
  req.on('data',c=>{if(ended)return;size+=c.length;if(size>100000){fail(413,'请求内容过大');return}chunks.push(c)});
  req.on('end',()=>{if(ended)return;try{const d=Buffer.concat(chunks).toString('utf8'),v=JSON.parse(d||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw new Error();ended=true;resolve(v)}catch{fail(400,'请求内容必须是 JSON 对象')}});
  req.on('aborted',()=>fail(400,'请求已中断'));req.on('error',()=>fail(400,'请求读取失败'))}));
const IMG_MAX=300*1024, IMG_DAILY=20,TASK_CHAT_MAX=2000, UPLOAD_MAX=500*1024*1024, UPLOADS=path.join(DATA_DIR,'uploads');
db.imgDaily=Object.assign(Object.create(null),db.imgDaily||{});
let uploadBytes=0; const duSize=d=>{let t=0;try{for(const e of fs.readdirSync(d,{withFileTypes:true}))t+=e.isDirectory()?duSize(path.join(d,e.name)):fs.statSync(path.join(d,e.name)).size}catch{}return t}; uploadBytes=duSize(UPLOADS);
// 读原始请求体，超过 max 字节返回 null
const rawBody=(req,max)=>new Promise(r=>{const a=[];let n=0,over=false;req.on('data',c=>{if(over)return;n+=c.length;if(n>max){over=true;a.length=0;r(null);return}a.push(c)});req.on('end',()=>{if(!over)r(Buffer.concat(a))});req.on('error',()=>r(null))});
const tokenOf=req=>(req.headers.authorization||"").replace("Bearer ","");
const userOf=req=>{const t=tokenOf(req),x=db.sessions[t];if(!x)return null;const u=db.users[x.user];if(typeof x!=='object'||!u||x.userId!==u.id||Date.now()>=x.exp){delete db.sessions[t];persist();return null}return x.user};
// 封禁登录仅签发 15 分钟的申诉凭证，不能当普通登录令牌使用。
const supportSecret=crypto.randomBytes(32);
const supportSignature=(payload,account)=>crypto.createHmac('sha256',supportSecret).update(payload+'.'+account.pw).digest('base64url');
const supportToken=n=>{const a=db.users[n],payload=Buffer.from(JSON.stringify({user:n,id:a.id,ban:a.bannedAt,version:a.banVersion||0,exp:Date.now()+15*60e3})).toString('base64url');return payload+'.'+supportSignature(payload,a)};
const supportUser=req=>{const normal=userOf(req);if(normal)return normal;try{const t=tokenOf(req);if(t.length>2000)return null;const [payload,signature,...extra]=t.split('.');if(extra.length||!payload||!signature)return null;const p=JSON.parse(Buffer.from(payload,'base64url').toString()),a=db.users[p.user];if(!a||a.id!==p.id||!a.banned||a.bannedAt!==p.ban||(a.banVersion||0)!==p.version||!Number.isFinite(p.exp)||Date.now()>=p.exp)return null;const expected=Buffer.from(supportSignature(payload,a)),given=Buffer.from(signature);return expected.length===given.length&&crypto.timingSafeEqual(expected,given)?p.user:null}catch{return null}};
const expired=x=>!!(x.deadline&&!x.claimedBy&&Date.parse(x.deadline)<Date.now());
// 返回给前端时附上计算字段 expired（截止时间已过且没人接）
// 已接单、没完成、超过截止时间 24 小时 = 超时，发布人可以撤销
const overdue=x=>!!(x.task&&x.deadline&&x.claimedBy&&!x.done&&!x.cancelled&&!x.stage&&Date.parse(x.deadline)+24*3600e3<Date.now());
// 任务状态：open 待接单 → claimed 已接单 → finished 接单人已完成 → paid 发布人已付款 → done 已完成；cancelled 已撤回，closed 管理员关闭
const status=x=>!x.task?undefined:x.closed?'closed':x.cancelled?'cancelled':x.done?'done':x.stage?x.stage:x.claimedBy?'claimed':'open';
const pubRatings=rs=>{if(!rs)return rs;const o={};for(const k in rs){const {ipOverlap,...v}=rs[k];o[k]=v}return o};
// v：查看人。true=管理员接口；纠纷原因、发起人、关闭原因只给管理员和双方，其他人只知道「有过纠纷」
const out=(x,c,v)=>{const full=v===true||(!!v&&(canInspect(v)||isPoster(x,v)||isClaimer(x,v))), oc=x.task&&db.offers[x.id]?pendingOffers(x).length:0, ot=x.task&&(v===true||canInspect(v))&&db.offers[x.id]?db.offers[x.id].length:0, mo=x.task&&typeof v==='string'&&db.offers[x.id]?[...db.offers[x.id]].reverse().find(y=>ownsOffer(y,v)):null, o={...x,...(oc?{offerCount:oc}:{}),...(ot?{offerTotal:ot}:{}),...(mo?{myOffer:(({id,price,counter,status,round,myTurn,canCounter})=>({id,price,counter,status,round,myTurn,canCounter}))(offerView(mo,x,v))}:{}),...(x.ratings?{ratings:pubRatings(x.ratings)}:{}),status:status(x),...(c?{channel:c}:{}),expired:expired(x),overdue:overdue(x)};
  if(x.dispute){if(full) Object.assign(o,{disputeReason:x.dispute.reason,disputeBy:x.dispute.by||'系统',disputedAt:x.dispute.time}); else {const {from,time,resolution,resolvedAt}=x.dispute; o.dispute={from,time,...(resolution?{resolution,resolvedAt}:{})}}}
  if(!full){delete o.closeReason;delete o.closeRefund;delete o.deleteRefund}
  return o};
const alive=x=>!x.deleted&&!x.cancelled;
const MIME={'.webmanifest':'application/manifest+json','.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.jpg':'image/jpeg','.webp':'image/webp'};
// 只提供明确公开的资源；新增测试、备份或运维文件不会自动暴露到公网。
const PUBLIC_FILES=new Set(['index.html','login.html','chat.html','me.html','recharge.html','admin.html','config.js','session.js','orders.js','feedback.js','pwa.js','sw.js','manifest.json','favicon.svg','og.png','pay-alipay.png','pay-wechat.png','icon-192.png','icon-512.png','icon-maskable-512.png']);
// 真实客户端 IP：部署在网关后面时（默认 TRUST_PROXY=1）读 X-Forwarded-For 里最右边那个，也就是网关自己追加的、伪造不了的那个；直连部署时设 TRUST_PROXY=0
const clientIp=req=>{if(process.env.TRUST_PROXY!=='0'){const x=String(req.headers['x-forwarded-for']||'').split(',').map(v=>v.trim()).filter(Boolean);if(x.length)return x[x.length-1];const r=req.headers['x-real-ip'];if(r)return String(r).trim()}return req.socket.remoteAddress||''};
const str=(v,max)=>v==null?'':String(v).trim().slice(0,max);

// 图片：UB[用户]=占用字节，每人最多 20MB；rmImgs 删掉任务里符合条件的图片并更新占用
const USER_IMG_MAX=20*1024*1024, IMG_KEEP_MS=30*864e5, UB=new Map();
for(const l of Object.values(db.taskChats)) for(const x of l) if(x.image&&!x.userDeleted) UB.set(x.user,(UB.get(x.user)||0)+(x.imageSize||0));
const rmImgs=(tid,pred=()=>true)=>{const l=db.taskChats[tid]; if(!l) return 0; let k=0; const dir=path.join(UPLOADS,String(tid));
  for(const x of l) if(x.image&&pred(x)){const f=path.join(dir,x.id+'.'+x.imageExt); let sz=0; try{sz=fs.statSync(f).size;fs.unlinkSync(f)}catch(e){if(e.code!=='ENOENT'){x.imageCleanupPending=true;console.error('图片清理失败，将重试：'+f,e.message);continue}}
    uploadBytes=Math.max(0,uploadBytes-sz); if(!x.userDeleted){const v=(UB.get(x.user)||0)-(x.imageSize||0); v>0?UB.set(x.user,v):UB.delete(x.user)}
    delete x.image;delete x.imageCleanupPending; x.imageRemoved=true; k++}
  if(!l.some(x=>x.image)&&fs.existsSync(dir)){const rest=duSize(dir); try{fs.rmSync(dir,{recursive:true,force:true});uploadBytes=Math.max(0,uploadBytes-rest)}catch{}}
  return k};
// 任务结束（完成、撤回、关闭、删除）30 天后清理图片
function cleanImgs(){const now=Date.now();let k=0;
  for(const tid of Object.keys(db.taskChats)){const l=db.taskChats[tid]; if(!l.some(x=>x.image)) continue; const t=IDX.get(tid), m=t&&t.msg;
    k+=rmImgs(tid,x=>!!x.imageCleanupPending);
    if(m&&!m.deleted&&!m.done&&!m.cancelled) continue;
    const end=!m?0:Date.parse((m.deleted?m.deletedAt:m.done?m.doneAt:m.cancelledAt)||0)||0;
    if(now-end>IMG_KEEP_MS) k+=rmImgs(tid)}
  if(k){console.log('已清理过期图片',k,'张');persist()}}
// paid 状态超过 48 小时，系统自动确认收款（纠纷中的任务 stage 是 disputed，不会被自动确认）
const PAID_AUTO_MS=48*3600e3;
function expireDue(){let ch=false; for(const tid of Object.keys(db.offers)){const t=IDX.get(tid); if(!t) continue; const m=t.msg;
    if(pendingOffers(m).length&&(expired(m)||m.cancelled||m.deleted||m.claimedBy)){const k=expireOffers(m,m.claimedBy?'任务已被接走':expired(m)?'任务已过截止时间':'任务已撤回',null); if(k&&expired(m)) ev(m.user,'offer_expire',m,'任务已过截止时间，'+k+' 个讨价已失效',null); m.rev=nextRev(); ch=true}}
  if(ch) persist()}
function autoConfirm(){expireDue();const now=Date.now();let ch=false;
  for(const c of CHANNELS) for(const m of db.messages[c]) if(m.task&&m.stage==='paid'&&!m.done&&!m.cancelled&&!m.deleted&&Date.parse(m.paidAt||0)+PAID_AUTO_MS<now){
    finishTask(m,new Date().toISOString()); m.autoConfirmed=true; sysChat(m,'发布人付款已超过 48 小时，系统自动确认收款，任务完成');
    ev(m.user,'auto',m,'付款超过 48 小时，系统已自动确认收款，任务完成',null); ev(m.claimedBy,'auto',m,'付款超过 48 小时，系统已自动确认收款，任务完成',null); m.rev=nextRev(); ch=true}
  if(ch) persist()}
// 每日备份：启动时和之后每小时检查一次，距上次备份满 24 小时就备份，保留最近 7 份
function backup(){try{
  if(!fs.existsSync(DB))return;
  fs.mkdirSync(BAK,{recursive:true});
  const files=fs.readdirSync(BAK).filter(f=>/^data-.*\.json$/.test(f)).sort();
  const valid=[];let last=0;for(const f of files.slice().reverse()){try{parseDB(fs.readFileSync(path.join(BAK,f),'utf8'));valid.push(f);last=Math.max(last,fs.statSync(path.join(BAK,f)).mtimeMs);if(files.length<=7&&Date.now()-last<24*3600e3)return}catch(e){console.error('忽略无效备份，保留原文件：'+f,e.message)}}
  const text=fs.readFileSync(DB,'utf8');try{parseDB(text)}catch(e){console.error('data.json 解析失败，跳过这次备份',e.message);return}
  if(Date.now()-last>=24*3600e3){const name='data-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';atomicWrite(path.join(BAK,name),text);valid.push(name);valid.sort()}
  valid.sort().slice(0,Math.max(0,valid.length-7)).forEach(f=>fs.unlinkSync(path.join(BAK,f)));
}catch(e){console.error('备份失败',e.message)}}
// 设置了 ADMIN_PASSWORD 时，启动时直接建好管理员账号，避免部署后被别人抢先注册（已存在就不动）
if(ADMIN&&process.env.ADMIN_PASSWORD&&!db.users[ADMIN]){db.users[ADMIN]={id:crypto.randomUUID(),pw:hash(String(process.env.ADMIN_PASSWORD)),created:Date.now()};console.log('已创建管理员账号',ADMIN)}
persist();
backup();setInterval(backup,3600e3).unref();
function cleanup(){const now=Date.now();let ch=false;
  for(const [k,v] of Object.entries(db.sessions)) if(v&&typeof v==='object'&&now>=v.exp){delete db.sessions[k];ch=true}
  for(const [k,a] of hits) if(!a.some(t=>now-t<60e3)) hits.delete(k);
  for(const [k,a] of fails) if(!loginPending.has(k)&&!a.some(t=>now-t<FAIL_MS)) fails.delete(k);
  if(ch) persist()}
cleanup();setInterval(cleanup,60e3).unref();
cleanImgs();setInterval(cleanImgs,3600e3).unref(); autoConfirm();setInterval(autoConfirm,600e3).unref();
const diskInfo=()=>{let free=null,size=null;try{const st=fs.statfsSync(DATA_DIR);free=st.bavail*st.bsize;size=st.blocks*st.bsize}catch{}
  let data=0;try{data=fs.statSync(DB).size}catch{} return {uploads:uploadBytes,uploadsMax:UPLOAD_MAX,data,backups:duSize(BAK),free,size,uploadBytes,uploadLimit:UPLOAD_MAX,dataBytes:data}};

// 兜底：单个请求出错只记日志，不让整个进程退出
process.on('uncaughtException',e=>console.error('未捕获错误',e&&e.stack||e));process.on('unhandledRejection',e=>console.error('未处理的 Promise 错误',e&&e.stack||e));
let chCache=null; const gzCache=new Map();
const handle=async(req,res)=>{
  let u,p; try{u=new URL(req.url.replace(/^\/+/,'/'),'http://x'); p=decodeURIComponent(u.pathname)}catch{res.writeHead(400,{'Content-Type':'application/json; charset=utf-8'});return res.end('{"error":"请求地址格式不对"}')}
  // 允许 GitHub Pages 上的前端跨域调用接口（ALLOW_ORIGINS 可用逗号追加其他来源）
  const origin=req.headers.origin||"",allow=(process.env.ALLOW_ORIGINS||"https://plgslzlexpmy.sealoshzh.site").split(",");
  if(allow.includes(origin)){res.setHeader("Access-Control-Allow-Origin",origin);res.setHeader("Access-Control-Allow-Headers","Content-Type, Authorization");res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");res.setHeader("Access-Control-Expose-Headers","X-Rev")}
  if(req.method==="OPTIONS"){res.writeHead(204);return res.end()}
  if(p.startsWith('/api/')){
    if(storageError)return send(res,503,{error:'数据保存失败，服务暂时不可用，请稍后重试'});
    const POST=req.method==='POST', GET=req.method==='GET';
    // 先完整读取 JSON，再做身份和状态检查；慢速请求不能沿用换人/封禁/退出之前的授权。
    // 图片走自己的二进制限额，上传结束后单独复核会话与账号。
    if(POST&&!/^\/api\/tasks\/\d+\/chat\/image$/.test(p)) await body(req);
    if(p.startsWith('/api/admin/')){
      const n=userOf(req);if(!n)return send(res,401,{error:'请先登录'});if(!isAdmin(n))return send(res,403,{error:'没有管理权限'});
      const allowed=p==='/api/admin/roles'||/^\/api\/admin\/users\/[^/]+\/permissions$/.test(p)||p==='/api/admin/backup'?isSuperAdmin(n):
        p==='/api/admin/overview'?(u.searchParams.get('summary')==='1'||isSuperAdmin(n)):
        p==='/api/admin/users'?canUsers(n):p==='/api/admin/messages'?canMessages(n):
        /^\/api\/admin\/users\/[^/]+\/(ban|unban)$/.test(p)?can(n,'banUsers'):
        /^\/api\/admin\/users\/[^/]+\/delete$/.test(p)?can(n,'deleteUsers'):
        /^\/api\/admin\/users\/[^/]+\/points$/.test(p)?can(n,'managePoints'):
        p.startsWith('/api/admin/settings')?can(n,'manageSettings'):p.startsWith('/api/admin/recharges')?can(n,'manageRecharges'):
        p.startsWith('/api/admin/feedback')?can(n,'manageFeedback'):p.startsWith('/api/admin/reports')?can(n,'manageReports'):
        p==='/api/admin/disputes'||/^\/api\/admin\/tasks\/\d+\/force$/.test(p)?can(n,'manageDisputes'):
        p==='/api/admin/chats'?canReadChat(n):isSuperAdmin(n);
      if(!allowed)return send(res,403,{error:'未获授权，只有总管理员可分配管理权限'});
    }
    if(p==='/api/admin/roles'&&GET)return send(res,200,{catalog:PERMISSIONS,users:Object.entries(db.users).map(([username,v])=>({username,userId:v.id,...roleInfo(username),permissionsVersion:v.permissionsVersion||0,permissionsUpdatedAt:v.permissionsUpdatedAt||null,banned:!!v.banned}))});
    const roleMatch=p.match(/^\/api\/admin\/users\/([^/]+)\/permissions$/);
    if(roleMatch&&POST){
      const n=userOf(req),name=roleMatch[1],target=db.users[name],b=await body(req);
      if(isSuperAdmin(name))return send(res,403,{error:'总管理员身份与权限不可修改'});
      if(!target)return send(res,404,{error:'用户不存在'});
      if(b.userId!==target.id||b.version!==(target.permissionsVersion||0))return send(res,409,{error:'账号或权限已变化，请刷新后重新设置'});
      if(!Array.isArray(b.permissions)||b.permissions.length>PERMISSIONS.length||b.permissions.some(k=>typeof k!=='string'||!PERMISSION_KEYS.has(k))||new Set(b.permissions).size!==b.permissions.length)return send(res,400,{error:'权限列表无效'});
      if(target.banned&&b.permissions.length)return send(res,400,{error:'请先解封该账号，再授予管理权限'});
      target.adminPermissions=PERMISSIONS.filter(x=>b.permissions.includes(x.key)).map(x=>x.key);target.permissionsVersion=(target.permissionsVersion||0)+1;target.permissionsUpdatedAt=new Date().toISOString();target.permissionsUpdatedBy=n;
      nextRev();persist();return send(res,200,{username:name,...roleInfo(name),permissionsVersion:target.permissionsVersion});
    }
    // POST /api/register、/api/login {username,password} -> {token,username,admin}
    if(POST&&(p==='/api/register'||p==='/api/login')){
      const {username,password,password2}=await body(req);
      if(limited("auth:"+clientIp(req),60)) return send(res,429,{error:"操作太频繁，请一分钟后再试"});
      if(!username||!password) return send(res,400,{error:"用户名和密码不能为空"});
      if(typeof username!=="string"||!/^[\w\u4e00-\u9fa5]{2,16}$/.test(username)) return send(res,400,{error:"用户名需为 2-16 位中文、字母、数字或下划线"});
      if(p==="/api/register"&&String(password).length<6) return send(res,400,{error:"密码至少 6 位"});
      if(p==="/api/register"&&password2!==undefined&&String(password2)!==String(password)) return send(res,400,{error:"两次输入的密码不一致"});
      if(p==='/api/register'){
        if((ADMIN&&username!==ADMIN&&String(username).toLowerCase()===ADMIN.toLowerCase())||db.users[username]||Object.keys(db.users).some(k=>k.toLowerCase()===String(username).toLowerCase())) return send(res,409,{error:'用户名已存在'});
        const pw=await hashA(String(password)); if(db.users[username]||Object.keys(db.users).some(k=>k.toLowerCase()===String(username).toLowerCase())) return send(res,409,{error:'用户名已存在'});
        db.users[username]={id:crypto.randomUUID(),pw,created:Date.now(),points:0}; if(!isAdmin(username)) addPoints(username,S().signupBonus,'signup','注册赠送');
      } else { // 两层锁定：同账号同 IP 15 分钟错 10 次只锁这个 IP；同账号所有 IP 合计错 50 次锁整个账号（以前在这个 IP 成功登录过的本人除外）
        const ip=clientIp(req),known=!!(db.users[username]&&(db.users[username].ips||[]).includes(ip));
        const keys=[failKey(username),failKey(username+'@'+ip)],missing=keys.filter(k=>!fails.has(k));
        if(fails.size+missing.length>FAIL_KEYS_MAX)return send(res,429,{error:'登录请求过多，请稍后重试'});
        for(const k of missing)fails.set(k,[]);
        const attempts=k=>failCount(k)+(loginPending.get(k)||0);
        if(attempts(keys[1])>=10||(attempts(keys[0])>=50&&!known)) return send(res,429,{error:'密码错误次数太多，请 15 分钟后再试'});
        for(const k of keys)loginPending.set(k,(loginPending.get(k)||0)+1);
        try{
        const account=db.users[username], originalPw=account&&account.pw;
        if(!account||!(await verifyA(String(password),originalPw))||db.users[username]!==account||account.pw!==originalPw){addFail(username);addFail(username+'@'+ip);return send(res,401,{error:'用户名或密码错误'})}
        if(!originalPw.startsWith('s1$')){const h=await hashA(String(password));if(db.users[username]!==account||account.pw!==originalPw)return send(res,401,{error:'账号状态已变化，请重新登录'});account.pw=h}
        }finally{for(const k of keys){const n=(loginPending.get(k)||0)-1;if(n>0)loginPending.set(k,n);else loginPending.delete(k)}}
      }
      if(p==="/api/login"&&banned(username)) return send(res,403,{...BANNED,reason:db.users[username].banReason||'',banReason:db.users[username].banReason||'',contact:S().contactInfo||'',appealToken:supportToken(username)});
      {const uu=db.users[username],ip=clientIp(req); if(uu&&ip){uu.ips=[ip,...(uu.ips||[]).filter(x=>x!==ip)].slice(0,5)}}
      const token=crypto.randomBytes(16).toString('hex'); db.sessions[token]={user:username,userId:db.users[username].id,exp:Date.now()+SESSION_MS};
      {const mine=Object.entries(db.sessions).filter(([,v])=>v===username||(v&&v.user===username)); if(mine.length>10){mine.sort((a,b)=>(a[1].exp||0)-(b[1].exp||0)); for(const [k] of mine.slice(0,mine.length-10)) delete db.sessions[k]}} // 每人最多保留 10 个登录，挤掉最旧的
      persist();
      return send(res,200,{token,username,...roleInfo(username)});
    }
    if(p==="/api/logout"&&POST){delete db.sessions[tokenOf(req)];persist();return send(res,200,{ok:true})}
    if(p==='/api/me'){const n=userOf(req); return n?send(res,200,{username:n,...roleInfo(n),banned:banned(n),banReason:db.users[n].banReason||'',contact:S().contactInfo||'',points:pts(n),postCost:S().postCost,claimCost:S().claimCost,eventUnread:(db.events[n]||[]).filter(x=>!x.read).length,chatUnread:totalChatUnread(n)}):send(res,401,{error:'未登录'});}
    // POST /api/password {oldPassword,newPassword}  改密码，成功后其他设备的登录全部失效，当前 token 保留
    if(p==='/api/password'&&POST){
      if(banned(userOf(req)))return send(res,403,BANNED);
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      if(limited("auth:"+clientIp(req),60)) return send(res,429,{error:"操作太频繁，请一分钟后再试"});
      const {oldPassword,newPassword,newPassword2}=await body(req);
      if(newPassword2!==undefined&&String(newPassword2)!==String(newPassword||'')) return send(res,400,{error:'两次输入的密码不一致'});
      const account=db.users[n],originalPw=account.pw;
      if(!(await verifyA(String(oldPassword||''),originalPw))||db.users[n]!==account||account.pw!==originalPw||userOf(req)!==n) return send(res,401,{error:'原密码错误或登录状态已变化'});
      if(String(newPassword||'').length<6) return send(res,400,{error:'新密码至少 6 位'});
      {const h=await hashA(String(newPassword)); if(db.users[n]!==account||account.pw!==originalPw||userOf(req)!==n) return send(res,401,{error:'登录状态已变化，请重新登录'}); account.pw=h}
      const t=tokenOf(req); for(const [k,v] of Object.entries(db.sessions)) if(k!==t&&(v===n||v.user===n)) delete db.sessions[k];
      persist(); return send(res,200,{ok:true});
    }
    // 公告：GET /api/announcements（新的在前）；POST 同路径 {title,text}（仅管理员）；POST /api/announcements/:id/delete（仅管理员）
    if(p==='/api/announcements'){
      if(GET) return send(res,200,db.announcements.slice().sort((a,b)=>b.id-a.id));
      if(POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!can(n,'manageAnnouncements')) return send(res,403,{error:'没有公告管理权限'});
        const b=await body(req),title=str(b.title,60),text=str(b.text,2000); if(!title) return send(res,400,{error:'公告标题不能为空'});
        const a={id:newId(),title,text,user:n,time:new Date().toISOString()}; db.announcements.push(a); persist(); return send(res,200,a);}
    }
    const am=p.match(/^\/api\/announcements\/(\d+)\/delete$/);
    if(am&&POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!can(n,'manageAnnouncements')) return send(res,403,{error:'没有公告管理权限'});
      const i=db.announcements.findIndex(x=>String(x.id)===am[1]); if(i<0) return send(res,404,{error:'公告不存在'});
      db.announcements.splice(i,1); persist(); return send(res,200,{ok:true});}
    // 管理员总览：GET /api/admin/overview（仅管理员）-> 全部用户、全部频道消息（含已删除消息的原文 deletedText）、公告
    if(p==='/api/admin/overview'&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      const summary={...(can(n,'manageFeedback')?{unreadFeedback:db.feedback.filter(x=>!x.read).length}:{}),...(can(n,'manageReports')?{unreadReports:db.reports.filter(x=>!x.resolved).length}:{}),...(can(n,'manageDisputes')?{disputes:CHANNELS.reduce((a,c)=>a+db.messages[c].filter(x=>x.task&&x.stage==='disputed'&&!x.done&&!x.cancelled&&!x.deleted).length,0)}:{}),...(isSuperAdmin(n)?{disk:diskInfo()}:{})};
      if(u.searchParams.get('summary')==='1')return send(res,200,summary);
      const online=Object.create(null); for(const v of Object.values(db.sessions)){const un=typeof v==='string'?v:(v.exp>Date.now()?v.user:null); if(un) online[un]=(online[un]||0)+1;}
      const users=Object.entries(db.users).map(([k,v])=>({username:k,created:new Date(v.created).toISOString(),...roleInfo(k),points:v.points||0,banned:!!v.banned,bannedAt:v.bannedAt||null,banReason:v.banReason||'',activeSessions:online[k]||0}));
      const channels=Object.fromEntries(CHANNELS.map(c=>[c,db.messages[c].map(x=>({...out(x,null,true),...(x.deleted?{deletedText:db.deletedTexts[x.id]||'',originalText:db.deletedTexts[x.id]||''}:{})}))]));
      return send(res,200,{users,channels,announcements:db.announcements,...summary});
    }
    // GET /api/admin/users -> [{username,created,admin,banned,bannedAt,banReason,activeSessions,messages}]（messages=发过的消息数）
    // GET /api/admin/messages -> 全部消息（含已删除、已撤销），每条带 channel，已删除的带 originalText，按时间倒序
    if((p==='/api/admin/users'||p==='/api/admin/messages')&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      if(p==='/api/admin/messages'){
        const view=(x,c)=>({...out(x,c,true),...(x.deleted?{originalText:db.deletedTexts[x.id]||'',deletedText:db.deletedTexts[x.id]||''}:{}),...(x.task?{chatCount:(db.taskChats[x.id]||[]).length,ipOverlap:!!(x.ratings&&Object.values(x.ratings).some(v=>v.ipOverlap))}:{})});
        if(!u.searchParams.has('page')&&!u.searchParams.has('limit'))return send(res,200,CHANNELS.flatMap(c=>db.messages[c].map(x=>view(x,c))).sort((a,b)=>b.id-a.id));
        const page=intIn(u.searchParams.get('page')||'1',1,1000000),limit=intIn(u.searchParams.get('limit')||'50',1,100),channel=u.searchParams.get('channel')||'',filter=u.searchParams.get('filter')||'',q=(u.searchParams.get('q')||'').trim().toLowerCase().slice(0,100);
        if(page==null||limit==null||(channel&&!CHANNELS.includes(channel))||!['','task','note','live','gone'].includes(filter)||['page','limit','channel','filter','q'].some(k=>u.searchParams.getAll(k).length>1))return send(res,400,{error:'分页或筛选参数无效'});
        const rows=[];for(const c of CHANNELS)if(!channel||channel===c)for(const x of db.messages[c]){
          if(filter==='task'&&!x.task||filter==='note'&&x.task||filter==='live'&&(x.deleted||x.cancelled)||filter==='gone'&&!x.deleted&&!x.cancelled)continue;
          if(q&&![x.deleted?db.deletedTexts[x.id]:x.text,x.user].some(v=>String(v||'').toLowerCase().includes(q)))continue;
          rows.push({msg:x,ch:c})}
        rows.sort((a,b)=>b.msg.id-a.msg.id);const total=rows.length,pages=Math.max(1,Math.ceil(total/limit)),current=Math.min(page,pages);
        return send(res,200,{messages:rows.slice((current-1)*limit,current*limit).map(x=>view(x.msg,x.ch)),total,page:current,pageSize:limit,pages});
      }
      const cnt=Object.create(null);for(const c of CHANNELS)for(const x of db.messages[c])cnt[x.user]=(cnt[x.user]||0)+1;
      const online=Object.create(null); for(const v of Object.values(db.sessions)){const un=typeof v==='string'?v:(v.exp>Date.now()?v.user:null); if(un) online[un]=(online[un]||0)+1;}
      return send(res,200,Object.entries(db.users).map(([k,v])=>({username:k,created:new Date(v.created).toISOString(),...roleInfo(k),points:v.points||0,banned:!!v.banned,bannedAt:v.bannedAt||null,banReason:v.banReason||'',activeSessions:online[k]||0,messages:cnt[k]||0})));
    }
    // 封禁/解封：POST /api/admin/users/<用户名>/ban {reason}、/unban（仅管理员，不能封管理员）
    // 删除账号：POST /api/admin/users/<用户名>/delete（仅管理员，不能删管理员）
    // 删除后 token 全部失效；他的消息标记已删除（原文留给管理员看）；他发的未完成任务撤销；他接了没完成的任务放回待接单；用户名可以重新注册
    const dm=p.match(/^\/api\/admin\/users\/([^/]+)\/delete$/);
    if(dm&&POST){ let du; try{du=decodeURIComponent(dm[1])}catch{return send(res,400,{error:'用户名格式不对'})}
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      if(!db.users[du]) return send(res,404,{error:'用户不存在'}); if(protectedUser(n,du)) return send(res,403,{error:'不能删除总管理员或其他管理员'});
      const now=new Date().toISOString(); let msgs=0,cancelled=0,released=0,disputed=0;
      for(const c of CHANNELS) for(const m of db.messages[c]){
        let ch=false;
        if(m.user===du&&m.task&&m.claimedBy&&!m.done&&!m.cancelled&&!m.deleted&&m.stage){ // 已到 finished/paid：不撤销，转成纠纷交给管理员
          if(m.stage!=='disputed'){m.dispute={by:null,role:'system',reason:'发布人已注销',time:now,from:m.stage};m.stage='disputed';disputed++;sysChat(m,'发布人已注销，任务转交管理员处理');ev(m.claimedBy,'dispute',m,'发布人已注销，任务转交管理员处理',du)}
          m.userDeleted=true; ch=true;
        } else if(m.user===du){ if(m.task) rmImgs(m.id);
          if(m.task&&!m.done&&!m.cancelled){m.cancelled=true;m.cancelledAt=now;cancelled++;ch=true;
            if(m.claimedBy&&!m.claimerDeleted&&db.users[m.claimedBy]){if(m.claimCost&&!m.claimRefunded){addPoints(m.claimedBy,m.claimCost,'refund','发布人已注销，退还接单积分',m.id);m.claimRefunded=true}
              ev(m.claimedBy,'cancel',m,'发布人已注销，任务已取消'+(m.claimCost?'，接单积分已退还':''),du)}}
          if(!m.deleted){db.deletedTexts[m.id]=m.text;m.deleted=true;m.text='';m.deletedBy=n;m.deletedAt=now;msgs++;ch=true}
          if(!m.userDeleted){m.userDeleted=true;ch=true}
        } else if(m.task&&m.claimedBy===du&&!m.done&&m.stage&&!m.cancelled){if(!m.claimerDeleted){m.claimerDeleted=true; // 接单人在 finished/paid 删号：转成纠纷交给管理员
            if(m.stage!=='disputed'){m.dispute={by:null,role:'system',reason:'接单人已注销',time:now,from:m.stage};m.stage='disputed';disputed++;ev(m.user,'dispute',m,'接单人已注销，任务转交管理员处理',du)}
            sysChat(m,'接单人已注销，任务转交管理员处理');ch=true}}
        else if(m.task&&m.claimedBy===du&&!m.done){rmImgs(m.id,x=>x.claimer===du);delete m.claimedBy;delete m.claimedAt;delete m.claimCost;resetNegotiation(m);m.unclaimedAt=now;released++;ch=true;
          if(!m.cancelled&&!m.deleted) ev(m.user,'unclaim',m,'接单人已注销，任务回到待接单',du)}
        else if(m.task&&m.claimedBy===du&&m.done&&!m.claimerDeleted){m.claimerDeleted=true;ch=true} // 已完成的保留，但标记接单人已删号，同名新账号不会认领
        if(ch) m.rev=nextRev();
      }
      for(const [k,v] of Object.entries(db.sessions)) if(v===du||v.user===du) delete db.sessions[k];
      for(const [tid,list] of Object.entries(db.taskChats)) for(const x of list){if(x.user===du&&!x.userDeleted) x.userDeleted=true; if(x.claimer===du) x.claimerGone=true}
      for(const v of Object.values(db.chatRead)) delete v[du]; delete db.events[du]; UB.delete(du); rebuildUR();
      let rej=0; for(const x of db.ledger) if(x.user===du&&!x.userDeleted) x.userDeleted=true;
      for(const x of db.recharges) if(x.user===du&&!x.userDeleted){x.userDeleted=true; if(x.status==='pending'){x.status='rejected';x.reason='账号已删除';x.handledBy=n;x.handledAt=now;rej++}}
      for(const [tid,l] of Object.entries(db.offers)){const t=IDX.get(tid); for(const o of l){if(o.user===du)o.userDeleted=true;if(o.status==='pending'){
        if(o.user===du){o.status='withdrawn';o.reason='讨价人已注销';o.updated=now}
        else if(t&&t.msg.user===du){o.status='expired';o.reason='发布人已注销';o.updated=now;if(ownsOffer(o,o.user))ev(o.user,'offer_expire',t.msg,'你的讨价已失效：发布人已注销',du)}}}}
      for(const f of db.feedback)if(f.user===du&&(!f.userId||f.userId===db.users[du].id))f.userDeleted=true;
      delete db.users[du]; persist();
      return send(res,200,{username:du,deleted:true,messages:msgs,cancelledTasks:cancelled,releasedTasks:released,disputedTasks:disputed,rejectedRecharges:rej});
    }
    const bm=p.match(/^\/api\/admin\/users\/([^/]+)\/(ban|unban)$/);
    if(bm&&POST){ let bu; try{bu=decodeURIComponent(bm[1])}catch{return send(res,400,{error:'用户名格式不对'})}
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      const t=db.users[bu]; if(!t) return send(res,404,{error:'用户不存在'}); if(protectedUser(n,bu)) return send(res,403,{error:'不能封禁总管理员或其他管理员'});
      t.banVersion=(t.banVersion||0)+1;
      if(bm[2]==='ban'){const b=await body(req); t.banned=true; t.bannedAt=new Date().toISOString(); t.banReason=str(b.reason,100);}
      else {delete t.banned; delete t.bannedAt; delete t.banReason;}
      persist(); return send(res,200,{username:bu,banned:!!t.banned});
    }
    if(p==='/api/settings'&&GET) return send(res,200,S());
    if(p==='/api/support'&&(GET||POST)){
      const n=supportUser(req);if(!n)return send(res,401,{error:'请登录；封禁账号请在登录页验证原账号密码后申诉'});const id=db.users[n].id;
      const own=db.feedback.filter(x=>x.kind==='support'&&x.userId===id);
      if(GET)return send(res,200,own.slice(-50).reverse().map(({id,text,contact,time,replies,read})=>({id,text,contact,time,replies:replies||[],read:!!read})));
      const b=await body(req);if(typeof b.text!=='string'||!b.text.trim()||(b.contact!=null&&typeof b.contact!=='string'))return send(res,400,{error:'请填写留言，联系方式须为文字'});
      if(limited('support:'+id,3)||own.filter(x=>Date.now()-Date.parse(x.time)<86400000).length>=10)return send(res,429,{error:'留言过于频繁，每分钟最多 3 条、每天最多 10 条'});
      const f={id:String(newId()),kind:'support',user:n,userId:id,text:b.text.trim().slice(0,1000),contact:str(b.contact,100),time:new Date().toISOString(),read:false,banned:banned(n),replies:[]};db.feedback.push(f);persist();return send(res,200,{ok:true,id:f.id});
    }
    // 建议：只有管理员能看，普通用户连自己的也看不到
    if(p==='/api/feedback'||p.startsWith('/api/admin/feedback')){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      if(p==='/api/feedback'&&POST){ if(banned(n)) return send(res,403,BANNED);
        const b=await body(req); if(typeof b.text!=='string'||!b.text.trim()) return send(res,400,{error:'建议内容不能为空'});
        if(b.contact!=null&&typeof b.contact!=='string') return send(res,400,{error:'联系方式格式不对'});
        if(limited('fb:'+n,3)) return send(res,429,{error:'发得太快了，请一分钟后再试'});
        const fb={id:String(newId()),user:n,text:b.text.trim().slice(0,1000),contact:str(b.contact,100),time:new Date().toISOString(),read:false};
        db.feedback.push(fb); persist(); return send(res,200,{ok:true,id:fb.id});
      }
      if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      if(p==='/api/admin/feedback'&&GET) return send(res,200,db.feedback.slice().reverse());
      const fm=p.match(/^\/api\/admin\/feedback\/([^/]+)\/(read|delete|reply)$/);
      if(fm&&POST){ const i=db.feedback.findIndex(x=>x.id===fm[1]); if(i<0) return send(res,404,{error:'建议不存在'});
        if(fm[2]==='reply'){const f=db.feedback[i],b=await body(req);if(f.kind!=='support')return send(res,400,{error:'只有联系留言可以站内回复'});if(!db.users[f.user]||db.users[f.user].id!==f.userId)return send(res,409,{error:'原留言账号已注销，不能回复同名新账号'});if(typeof b.text!=='string'||!b.text.trim())return send(res,400,{error:'请填写回复内容'});const replies=f.replies||(f.replies=[]);if(replies.length>=20)return send(res,409,{error:'该留言回复已达上限'});replies.push({id:String(newId()),user:n,text:b.text.trim().slice(0,1000),time:new Date().toISOString()});f.read=true;persist();return send(res,200,{ok:true})}
        if(fm[2]==='read') db.feedback[i].read=true; else db.feedback.splice(i,1);
        persist(); return send(res,200,{ok:true}); }
      return send(res,404,{error:'接口不存在'});
    }
    if(p.startsWith('/api/my/points')||p.startsWith('/api/my/recharges')||p==='/api/recharge'||p.startsWith('/api/admin/settings')||p.startsWith('/api/admin/recharges')||/^\/api\/admin\/users\/[^/]+\/points$/.test(p)){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      if(p==='/api/my/points'&&GET) return send(res,200,{points:pts(n),log:db.ledger.filter(x=>x.user===n&&!x.userDeleted).slice(-500).reverse().map(({user,...x})=>x)});
      if(p==='/api/my/recharges'&&GET) return send(res,200,db.recharges.filter(x=>x.user===n&&!x.userDeleted).slice().reverse());
      if(p==='/api/recharge'&&POST){
        if(banned(n)) return send(res,403,BANNED);
        const b=await body(req), amt=typeof b.amount==='string'?Number(b.amount):b.amount;
        if(typeof amt!=='number'||!isFinite(amt)||amt<0.01||amt>10000) return send(res,400,{error:'金额要在 0.01 到 10000 元之间'});
        if(!['alipay','wechat'].includes(b.method)) return send(res,400,{error:'请选择支付宝或微信'});
        if(db.recharges.filter(x=>x.user===n&&!x.userDeleted&&x.status==='pending').length>=5) return send(res,429,{error:'你还有 5 笔充值在审核中，请等管理员处理'});
        const rec={id:String(newId()),user:n,amount:Math.round(amt*100)/100,method:b.method,note:str(b.note,100),status:'pending',time:new Date().toISOString()};
        db.recharges.push(rec); persist(); return send(res,200,rec);
      }
      if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      if(p==='/api/admin/settings'&&GET) return send(res,200,S());
      if(p==='/api/admin/settings'&&POST){
        const b=await body(req), nx={...S()};
        for(const k of ['postCost','claimCost','signupBonus']) if(b[k]!=null){const v=intIn(b[k],0,1000000); if(v==null) return send(res,400,{error:k+' 要是 0 以上的整数'}); nx[k]=v}
        if(Object.hasOwn(b,'contactInfo')){if(!isSuperAdmin(n))return send(res,403,{error:'仅总管理员可修改联系渠道'});if(typeof b.contactInfo!=='string'||b.contactInfo.length>200)return send(res,400,{error:'联系方式须为 200 字以内的文字'});nx.contactInfo=b.contactInfo.trim()}
        db.settings=nx; persist(); return send(res,200,S());
      }
      if(p==='/api/admin/recharges'&&GET){const st=u.searchParams.get('status'); return send(res,200,db.recharges.filter(x=>!st||x.status===st).slice().reverse().map(x=>({...x,userPoints:pts(x.user),userExists:!x.userDeleted&&!!db.users[x.user]})))}
      const rm=p.match(/^\/api\/admin\/recharges\/([^/]+)\/(approve|reject)$/);
      if(rm&&POST){
        const b=await body(req), rec=db.recharges.find(x=>x.id===rm[1]); if(!rec) return send(res,404,{error:'充值记录不存在'});
        if(rec.status!=='pending') return send(res,409,{error:'这笔充值已经处理过了'});
        if(rm[2]==='approve'){ if(rec.userDeleted||!db.users[rec.user]) return send(res,404,{error:'用户已不存在'}); const v=intIn(b.points,1,1000000); if(v==null) return send(res,400,{error:'积分要是 1-1000000 的整数'});
          rec.status='approved'; rec.points=v; addPoints(rec.user,v,'recharge','充值 '+rec.amount+' 元',rec.id); }
        else { rec.status='rejected'; rec.reason=str(b.reason,100); }
        rec.handledBy=n; rec.handledAt=new Date().toISOString(); persist(); return send(res,200,rec);
      }
      const pm=p.match(/^\/api\/admin\/users\/([^/]+)\/points$/);
      if(pm&&POST){
        let pu; try{pu=decodeURIComponent(pm[1])}catch{return send(res,400,{error:'用户名格式不对'})}
        if(!db.users[pu]) return send(res,404,{error:'用户不存在'}); if(!isSuperAdmin(n)&&hasAdminRole(pu))return send(res,403,{error:'不能调整管理员的积分'});
        const b=await body(req), d=intIn(b.delta,-1000000,1000000); if(d==null||d===0) return send(res,400,{error:'调整的积分要是非 0 整数'});
        if(pts(pu)+d<0) return send(res,400,{error:'扣完会变成负数，当前只有 '+pts(pu)+' 积分'});
        addPoints(pu,d,'admin',str(b.reason,100)||'管理员调整'); persist(); return send(res,200,{username:pu,points:pts(pu)});
      }
      return send(res,404,{error:'接口不存在'});
    }
    if(p==='/api/health') return send(res,200,{ok:true,uptime:Math.round(process.uptime())});
    if(p==='/api/channels'){ if(!chCache||chCache.rev!==(db.rev||0)) chCache={rev:db.rev||0,data:CHANNELS.map(c=>{const l=db.messages[c].filter(alive);return{name:c,count:l.length,lastId:l.length?l[l.length-1].id:0}})}; return send(res,200,chCache.data)}
    // 任务和消息操作：POST /api/channels/:ch/messages/:id/<claim|unclaim|complete|done|cancel|delete>
    const am2=p.match(/^\/api\/channels\/([^/]+)\/messages\/(\d+)\/(claim|unclaim|release|kick|finish|paid|received|complete|done|cancel|delete|dispute)$/);
    if(am2&&POST){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(banned(n)) return send(res,403,BANNED);
      if(limited('task:'+n,60))return send(res,429,{error:'任务操作太频繁，请一分钟后再试'});
      const list=db.messages[am2[1]]; if(!list) return send(res,404,{error:'频道不存在'});
      const ix=IDX.get(am2[2]), msg=ix&&ix.ch===am2[1]?ix.msg:null; if(!msg||msg.deleted) return send(res,404,{error:'消息不存在'});
      const prevClaimer=msg.claimedBy, act=am2[3]==='kick'?'release':am2[3],now=new Date().toISOString();
      if(act==='delete'){ // 管理员可删任何消息；普通用户可删自己没人接的消息
        if(!can(n,'deleteMessages')&&!(msg.user===n&&!msg.claimedBy)) return send(res,403,{error:'没有权限删除这条消息'});
        if(can(n,'deleteMessages')&&msg.task){ // 管理员删任务：不自动退分，只退勾选的 refundPost / refundClaim（已退过、已注销的跳过）
          const b=await body(req); if(msg.deleted) return send(res,404,{error:'消息不存在'}); const yes=v=>v===true||v==='true'||v===1||v==='1';
          const rp=yes(b.refundPost)&&msg.cost&&!msg.refunded&&!msg.userDeleted&&db.users[msg.user]?msg.cost:0, rc=yes(b.refundClaim)&&msg.claimedBy&&msg.claimCost&&!msg.claimRefunded&&!msg.claimerDeleted&&db.users[msg.claimedBy]?msg.claimCost:0;
          if(rp){addPoints(msg.user,rp,'refund','管理员删除任务，退还发布积分',msg.id);msg.refunded=true}
          if(rc){addPoints(msg.claimedBy,rc,'refund','管理员删除任务，退还接单积分',msg.id);msg.claimRefunded=true}
          msg.deleteRefund={post:rp,claim:rc};
          if(msg.claimedBy) sysChat(msg,'管理员删除了任务（'+([rp?'退还发布人 '+rp+' 积分':'',rc?'退还接单人 '+rc+' 积分':''].filter(Boolean).join('，')||'不退积分')+'）');
        } else if(msg.task&&msg.cost&&!msg.refunded&&!msg.cancelled&&!msg.claimedBy&&!msg.done){addPoints(msg.user,msg.cost,'refund','删除未接任务退还',msg.id);msg.refunded=true} // 发布人自己删没人接的任务：照常退
        db.deletedTexts[msg.id]=msg.text;msg.deleted=true;msg.text='';msg.deletedBy=n;msg.deletedAt=now;
      } else {
        if(!msg.task) return send(res,404,{error:'任务不存在'});
        if(msg.cancelled) return send(res,409,{error:'任务已撤销'});
        if(msg.stage==='disputed') return send(res,409,{error:act==='dispute'?'已经在等平台处理了':'任务在纠纷处理中，请等管理员处理',status:'disputed'});
        if(act==='dispute'){ // 申请平台介入：双方在 claimed/finished/paid 都能发起，之后状态动作全部冻结，只能由管理员 force
          const st=status(msg), role=isPoster(msg,n)?'poster':isClaimer(msg,n)?'claimer':null;
          if(!role) return send(res,403,{error:'只有发布人和接单人能申请平台介入'});
          if(!['claimed','finished','paid'].includes(st)) return send(res,409,{error:'当前状态不能申请平台介入',status:st});
          const b=await body(req); if(typeof b.reason!=='string'||!b.reason.trim()) return send(res,400,{error:'请填写申请介入的原因'});
          if(msg.stage==='disputed'||msg.done||msg.cancelled) return send(res,409,{error:'任务状态已经变了，请刷新'});
          msg.dispute={by:n,role,reason:str(b.reason,200),time:now,from:st}; msg.stage='disputed';
          sysChat(msg,(role==='poster'?'发布人':'接单人')+' 申请了平台介入：'+msg.dispute.reason+'。任务已冻结，等待管理员处理');
          ev(role==='poster'?msg.claimedBy:msg.user,'dispute',msg,(role==='poster'?'发布人':'接单人')+' 申请了平台介入，任务已冻结',n);
        } else if(act==='claim'){
          if(msg.user===n) return send(res,400,{error:'不能接自己发布的任务'});
          if(msg.claimedBy) return send(res,409,{error:'已被 '+msg.claimedBy+' 接单'});
          if(expired(msg)) return send(res,409,{error:'任务已过期'});
          if((db.taskChats[msg.id]||[]).length>=TASK_CHAT_MAX)return send(res,409,{error:'任务历史记录已满，请发布人撤回后重新发布'});
          delete msg.claimCost; delete msg.claimRefunded;
          if(!can(n,'freeTasks')){const c=S().claimCost; if(pts(n)<c) return send(res,402,noPoints(n,c)); if(c>0){addPoints(n,-c,'claim','接单',msg.id); msg.claimCost=c}}
          msg.claimedBy=n;msg.claimedAt=now; sysChat(msg,n+' 接单了');
        } else if(act==='unclaim'){ // 接单人放弃，任务回到待接单
          if(msg.claimedBy!==n) return send(res,403,{error:'只有接单人能放弃接单'});
          if(msg.done) return send(res,409,{error:'任务已完成，不能放弃'});
          if(msg.stage) return send(res,409,{error:'你已经点了「我已完成」，不能再放弃'});
          sysChat(msg,msg.claimedBy+' 放弃了接单');
          delete msg.claimedBy;delete msg.claimedAt;delete msg.claimCost;resetNegotiation(msg);msg.unclaimedAt=now;
        } else if(act==='release'){ // 发布人取消接单人：任务回到待接单，退还接单人的接单分
          if(msg.user!==n) return send(res,403,{error:'只有发布者能取消接单人'});
          if(!msg.claimedBy) return send(res,400,{error:'任务还没人接单'});
          if(msg.done) return send(res,409,{error:'任务已完成'});
          if(msg.stage) return send(res,409,{error:'接单人已完成任务，不能再取消接单人'});
          sysChat(msg,'发布人取消了接单人 '+msg.claimedBy);
          if(msg.claimCost&&!msg.claimerDeleted&&db.users[msg.claimedBy]) addPoints(msg.claimedBy,msg.claimCost,'refund','发布人取消接单，退还接单积分',msg.id);
          msg.releasedBy=msg.claimedBy;delete msg.claimedBy;delete msg.claimedAt;delete msg.claimCost;resetNegotiation(msg);msg.unclaimedAt=now;
        } else if(act==='cancel'){ // 发布者撤销没人接的任务，或已超时的任务
          if(msg.user!==n) return send(res,403,{error:'只有发布者能撤销'});
          if(msg.done) return send(res,409,{error:'任务已完成'});
          if(msg.stage) return send(res,409,{error:'接单人已完成任务，不能撤回'});
          if(msg.claimedBy&&!overdue(msg)) return send(res,409,{error:'任务已被接单，请先取消接单人再撤回'});
          if(msg.claimedBy){ // 超时撤回：接单人的接单积分也退还
            const cr=msg.claimCost&&!msg.claimRefunded&&!msg.claimerDeleted&&db.users[msg.claimedBy]?msg.claimCost:0;
            if(cr){addPoints(msg.claimedBy,cr,'refund','任务超时被撤回，退还接单积分',msg.id);msg.claimRefunded=true}
            sysChat(msg,'任务超时，发布人撤回了任务'+(cr?'，已退还接单人 '+cr+' 积分':''))}
          msg.cancelled=true;msg.cancelledAt=now; if(msg.cost&&!msg.refunded){addPoints(msg.user,msg.cost,'refund','撤回任务退还',msg.id);msg.refunded=true}
        } else if(act==='finish'||act==='paid'||act==='received'){ // 交易流程：接单人「我已完成」→ 发布人「我已付款」→ 接单人「确认收款」
          if(msg.done) return send(res,409,{error:'任务已完成'});
          const st=status(msg), need={finish:'claimed',paid:'finished',received:'paid'}[act], who=act==='paid'?msg.user:msg.claimedBy;
          if(!msg.claimedBy) return send(res,400,{error:'任务还没人接单'});
          if(n!==who||(act!=='paid'&&msg.claimerDeleted)) return send(res,403,{error:act==='paid'?'只有发布人能点「我已付款」':'只有接单人能操作'});
          if(st!==need) return send(res,409,{error:'当前状态不能这样操作',status:st});
          if(act==='finish'){msg.stage='finished';msg.finishedAt=now;sysChat(msg,n+' 表示任务已完成，等待发布人付款')}
          else if(act==='paid'){msg.stage='paid';msg.paidAt=now;sysChat(msg,'发布人表示已付款，等待接单人确认收款')}
          else {finishTask(msg,now);sysChat(msg,n+' 已确认收款，任务完成')}
        } else { // complete / done：发布人「无需付款，直接完成」
          if(msg.user!==n) return send(res,403,{error:"只有发布者能确认完成"});
          if(!msg.claimedBy) return send(res,400,{error:"任务还没人接单"});
          if(msg.done) return send(res,409,{error:"任务已完成"});
          if(status(msg)!=='claimed') return send(res,409,{error:'接单人已点「我已完成」，请按付款流程操作',status:status(msg)});
          finishTask(msg,now); sysChat(msg,'发布人确认任务完成（无需付款）');
        }
      }
      if(msg.task){const pc=prevClaimer;
        if(act==='claim') ev(msg.user,'claim',msg,n+' 接了你的任务',n);
        else if(act==='unclaim') ev(msg.user,'unclaim',msg,pc+' 放弃了接单',n);
        else if(act==='release') ev(pc,'release',msg,'发布人取消了你的接单，接单积分已退还',n);
        else if(act==='cancel'&&pc) ev(pc,'cancel',msg,'任务超时，发布人撤回了任务'+(msg.claimRefunded&&msg.claimCost?'，接单积分 '+msg.claimCost+' 已退还':''),n);
        else if(act==='finish') ev(msg.user,'finish',msg,n+' 表示任务已完成，请付款',n);
        else if(act==='paid') ev(msg.claimedBy,'paid',msg,'发布人已付款，请确认收款',n);
        else if(act==='received') ev(msg.user,'received',msg,n+' 已确认收款，任务完成',n);
        else if(act==='complete'||act==='done') ev(msg.claimedBy,'done',msg,'发布人确认任务完成',n);
        else if(act==='delete'&&can(n,'deleteMessages')){const dr=msg.deleteRefund||{}; ev(msg.user,'deleted',msg,'任务被管理员删除'+(dr.post?'，退还你 '+dr.post+' 发布积分':msg.cost&&!msg.refunded?'，发布积分不退':''),n); ev(pc,'deleted',msg,'任务被管理员删除'+(dr.claim?'，退还你 '+dr.claim+' 接单积分':msg.claimCost&&!msg.claimRefunded?'，接单积分不退':''),n)}}
      if(act==='delete'&&msg.task) rmImgs(msg.id);
      if(msg.task&&(act==='claim'||act==='cancel'||act==='delete')) expireOffers(msg,act==='claim'?'任务已被 '+n+' 接走':act==='cancel'?'发布人撤回了任务':'任务已被删除',n);
      recalc(msg); msg.rev=nextRev(); persist(); return send(res,200,out(msg,null,n));
    }
    // 任务动态：GET /api/my/events?after=<id>（新的在前）；POST /api/my/events/read 全部标已读
    if(p==='/api/my/events'&&GET){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); const a=+u.searchParams.get('after')||0; const l=(db.events[n]||[]).filter(x=>x.id>a).slice().reverse(); return send(res,200,{unread:(db.events[n]||[]).filter(x=>!x.read).length,events:l})}
    if(p==='/api/my/events/read'&&POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); let k=0; for(const x of db.events[n]||[]) if(!x.read){x.read=true;k++} if(k) persist(); return send(res,200,{ok:true,read:k})}
    // 讨价：POST .../messages/<id>/offer {price,note}；GET .../offers；POST .../offers/<oid>/accept|reject|counter|withdraw
    const of=p.match(/^\/api\/channels\/([^/]+)\/messages\/(\d+)\/(offer|offers)(?:\/(\d+)\/(accept|reject|counter|withdraw))?$/);
    if(of&&((POST&&of[3]==='offer'&&!of[4])||(GET&&of[3]==='offers'&&!of[4])||(POST&&of[3]==='offers'&&of[4]))){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      const ix=IDX.get(of[2]), m=ix&&ix.ch===of[1]&&ix.msg.task?ix.msg:null; if(!m||(m.deleted&&!canInspect(n))) return send(res,404,{error:'任务不存在'});
      const list=db.offers[m.id]||[], poster=isPoster(m,n), adm=canInspect(n);
      const view=o=>offerView(o,m,n);
      if(GET){ if(adm||poster) return send(res,200,{count:pendingOffers(m).length,offers:list.slice().reverse().map(view)});
        return send(res,200,{count:pendingOffers(m).length,offers:list.filter(o=>ownsOffer(o,n)).reverse().map(view)}) }
      if(banned(n)) return send(res,403,BANNED);
      if(adm&&!poster) return send(res,403,{error:'管理员不能参与讨价'});
      const b=await body(req), now=new Date().toISOString();
      // 以下全是同步代码，读完请求体后再检查状态，不会有并发竞态
      const openErr=()=>m.deleted||m.cancelled?'任务已撤回':m.claimedBy?'任务已被接走':expired(m)?'任务已过截止时间':m.stage==='disputed'?'任务在纠纷处理中':(db.taskChats[m.id]||[]).length>=TASK_CHAT_MAX?'任务历史记录已满，请发布人撤回后重新发布':null;
      const done=(o,code=200)=>{m.rev=nextRev();persist();return send(res,code,{offer:view(o),task:out(m,of[1],n)})};
      if(!of[4]){ // 发起讨价
        if(poster||m.user===n) return send(res,400,{error:'不能和自己的任务讨价'});
        const e=openErr(); if(e) return send(res,409,{error:e+'，不能讨价'});
        const price=offerPrice(b.price); if(price==null) return send(res,400,{error:'期望报酬要是 0.01-100000 之间的金额'});
        if(b.note!=null&&typeof b.note!=='string') return send(res,400,{error:'留言格式不对'});
        if(list.some(o=>o.user===n&&o.status==='pending')) return send(res,409,{error:'你已经有一个进行中的讨价了'});
        if(pendingOffers(m).length>=OFFER_MAX_PENDING) return send(res,409,{error:'这个任务的讨价人数已满（最多 '+OFFER_MAX_PENDING+' 个），请稍后再试'});
        if(limited('offer:'+n,10)) return send(res,429,{error:'操作太频繁，请稍后再试'});
        const o={id:newId(),user:n,userId:db.users[n].id,status:'pending',price,turn:'poster',rounds:[{by:'claimer',price,note:str(b.note,50),time:now}],time:now,updated:now};
        (db.offers[m.id]=db.offers[m.id]||[]).push(o); ev(m.user,'offer',m,n+' 想以 '+price+' 元接你的任务'+(o.rounds[0].note?'：'+o.rounds[0].note:''),n);
        return done(o);
      }
      const o=list.find(x=>String(x.id)===of[4]); if(!o) return send(res,404,{error:'讨价不存在'});
      const mine=ownsOffer(o,n); if(!poster&&!mine) return send(res,403,{error:'只有发布人和讨价人能操作'});
      if(o.status!=='pending') return send(res,409,{error:'这个讨价已经结束了',status:o.status});
      const act=of[5];
      if(act==='withdraw'){ if(!mine) return send(res,403,{error:'只有讨价人能放弃'}); o.status='withdrawn';o.updated=now; ev(m.user,'offer_withdraw',m,n+' 放弃了讨价',n); return done(o)}
      if(act==='reject'){ if(!poster) return send(res,403,{error:'只有发布人能拒绝'}); o.status='rejected';o.updated=now; ev(o.user,'offer_reject',m,'发布人拒绝了你的讨价',n); return done(o)}
      const myTurn=poster?o.turn==='poster':o.turn==='claimer'; if(!myTurn) return send(res,409,{error:'现在轮到对方回复'});
      const e=openErr(); if(e){expireOffers(m,e,null); m.rev=nextRev(); persist(); return send(res,409,{error:e+'，讨价已失效'})}
      if(act==='counter'){
        if(o.rounds.length>=OFFER_MAX_ROUNDS) return send(res,409,{error:'已经来回 3 轮了，不能再还价，请同意或拒绝'});
        const price=offerPrice(b.price); if(price==null) return send(res,400,{error:'还价要是 0.01-100000 之间的金额'});
        if(b.note!=null&&typeof b.note!=='string') return send(res,400,{error:'留言格式不对'});
        o.rounds.push({by:poster?'poster':'claimer',price,note:str(b.note,50),time:now}); o.price=price; o.turn=poster?'claimer':'poster'; o.updated=now;
        ev(poster?o.user:m.user,'offer_counter',m,(poster?'发布人':n)+' 还价 '+price+' 元',n); return done(o);
      }
      // accept：同意当前价格，讨价人当场接单
      const cu=o.user; if(!ownsOffer(o,cu)) return send(res,409,{error:'讨价人已不存在'}); if(banned(cu)) return send(res,409,{error:'讨价人已被封禁'});
      const c=can(cu,'freeTasks')?0:S().claimCost;
      if(pts(cu)<c) return send(res,402,poster?{error:'对方积分不足（接单需要 '+c+' 积分，对方只有 '+pts(cu)+' 积分），暂时不能同意',need:c}:noPoints(cu,c));
      delete m.claimCost; delete m.claimRefunded; if(c>0){addPoints(cu,-c,'claim','议价接单',m.id); m.claimCost=c}
      if(m.originalReward==null) m.originalReward=m.reward||''; m.reward=o.price+'元'; m.negotiated=true; m.offerId=o.id;
      m.claimedBy=cu; m.claimedAt=now; o.status='accepted'; o.updated=now;
      sysChat(m,'双方已议价 '+o.price+' 元'+(m.originalReward?'（原价 '+m.originalReward+'）':'')+'，'+cu+' 接单了');
      ev(poster?cu:m.user,'offer_accept',m,(poster?'发布人同意了你的讨价，':cu+' 接受了你的还价，')+'按 '+o.price+' 元成交',n);
      expireOffers(m,'任务已被 '+cu+' 接走',null); recalc(m);
      return done(o);
    }
    // 互评：POST /api/channels/<ch>/messages/<id>/rate {score:1-5, comment}，任务 done 后双方各评一次
    const rt=p.match(/^\/api\/channels\/([^/]+)\/messages\/(\d+)\/rate$/);
    if(rt&&POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(banned(n)) return send(res,403,BANNED);
      const list=db.messages[rt[1]]; if(!list) return send(res,404,{error:'频道不存在'}); const ix=IDX.get(rt[2]), m=ix&&ix.ch===rt[1]&&ix.msg.task?ix.msg:null; if(!m||m.deleted) return send(res,404,{error:'任务不存在'});
      if(!m.done||m.closed) return send(res,409,{error:'任务完成后才能评价'});
      if(m.dispute) return send(res,409,{error:'这个任务有过纠纷，不能评价'});
      const role=isPoster(m,n)?'poster':isClaimer(m,n)?'claimer':null; if(!role) return send(res,403,{error:'只有发布人和接单人能评价'});
      if(role==='poster'&&m.claimerDeleted) return send(res,409,{error:'接单人已注销，不能评价'}); if(role==='claimer'&&m.userDeleted) return send(res,409,{error:'发布人已注销，不能评价'});
      m.ratings=m.ratings||{}; if(m.ratings[role]) return send(res,409,{error:'你已经评价过了'});
      const b=await body(req), sc=intIn(b.score,1,5); if(m.ratings[role]) return send(res,409,{error:'你已经评价过了'}); if(sc==null) return send(res,400,{error:'评分要是 1-5 的整数'}); if(b.comment!=null&&typeof b.comment!=='string') return send(res,400,{error:'评价内容格式不对'});
      const target=role==='poster'?m.claimedBy:m.user; const ia=(db.users[n]||{}).ips||[], ib=(db.users[target]||{}).ips||[];
      m.ratings[role]={from:n,to:target,score:sc,comment:str(b.comment,80),time:new Date().toISOString(),...(ia.some(x=>ib.includes(x))?{ipOverlap:true}:{})};
      ev(target,'rated',m,n+' 给了你 '+sc+' 星评价',n); m.rev=nextRev(); persist(); return send(res,200,out(m,rt[1],n));
    }
    // 用户信用：GET /api/users/<name>/profile -> {username,completed,posted,ratingCount,avgScore,goodRate,recent}
    const pf=p.match(/^\/api\/users\/([^/]+)\/profile$/);
    if(pf&&GET){const name=pf[1]; if(!db.users[name]) return send(res,404,{error:'用户不存在'});
      let completed=0,posted=0; const got=[];
      for(const c of CHANNELS) for(const m of db.messages[c]){ if(!m.task||m.deleted) continue;
        if(m.done&&!m.closed&&m.claimedBy===name&&!m.claimerDeleted) completed++;
        if(m.done&&!m.closed&&m.user===name&&!m.userDeleted) posted++;
        const rs=m.ratings||{};
        if(rs.poster&&rs.poster.to===name&&m.claimedBy===name&&!m.claimerDeleted) got.push({score:rs.poster.score,comment:rs.poster.comment,time:rs.poster.time,from:m.userDeleted?null:rs.poster.from,role:'claimer',taskId:m.id,channel:c,_f:rs.poster.from,_ip:!!rs.poster.ipOverlap});
        if(rs.claimer&&rs.claimer.to===name&&m.user===name&&!m.userDeleted) got.push({score:rs.claimer.score,comment:rs.claimer.comment,time:rs.claimer.time,from:m.claimerDeleted?null:rs.claimer.from,role:'poster',taskId:m.id,channel:c,_f:rs.claimer.from,_ip:!!rs.claimer.ipOverlap}); }
      // 计入信用的评价：同一个人只算最新的 1 次（IP 重叠只给管理员提示，不影响信用）
      got.sort((a,b)=>b.time.localeCompare(a.time)); const seen=new Set(); for(const x of got){x.counted=!seen.has(x._f); if(x.counted) seen.add(x._f)}
      const cn=got.filter(x=>x.counted), avg=cn.length?Math.round(cn.reduce((a,x)=>a+x.score,0)/cn.length*10)/10:null;
      return send(res,200,{username:name,admin:isAdmin(name),completed,posted,ratingCount:cn.length,ratingTotal:got.length,avgScore:avg,goodRate:cn.length?Math.round(cn.filter(x=>x.score>=4).length/cn.length*100):null,recent:got.slice(0,10).map(({_f,_ip,...x})=>x)});
    }
    // 举报：POST /api/report {target:'user'|'task', id, reason}；管理员 GET /api/admin/reports、POST /api/admin/reports/<id>/resolve|delete
    if(p==='/api/report'&&POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(banned(n)) return send(res,403,BANNED);
      const b=await body(req); if(b.target!=='user'&&b.target!=='task') return send(res,400,{error:"target 要是 user 或 task"});
      if(typeof b.id!=='string'&&typeof b.id!=='number') return send(res,400,{error:'id 格式不对'}); const id=String(b.id).slice(0,40);
      if(typeof b.reason!=='string'||!b.reason.trim()) return send(res,400,{error:'请填写举报原因'});
      if(b.target==='user'?!db.users[id]:!findTask(id)) return send(res,404,{error:b.target==='user'?'用户不存在':'任务不存在'});
      if(limited('rp:'+n,3)) return send(res,429,{error:'举报太频繁，请一分钟后再试'});
      const x={id:String(newId()),user:n,target:b.target,targetId:id,reason:str(b.reason,200),time:new Date().toISOString(),resolved:false}; db.reports.push(x); persist(); return send(res,200,{ok:true,id:x.id});
    }
    if(p==='/api/admin/reports'||p.startsWith('/api/admin/reports/')||p==='/api/admin/backup'||p==='/api/admin/disputes'){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      if(p==='/api/admin/backup'&&GET){const {sessions,users,...rest}=db; const us=Object.create(null); for(const [k,v] of Object.entries(users)){const {ips,...o}=v; us[k]=o} const d=JSON.stringify({users:us,...rest}); res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="aevon-backup-'+new Date(Date.now()+8*3600e3).toISOString().slice(0,10)+'.json"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}); return res.end(d)}
      if(p==='/api/admin/disputes'&&GET){const o=[]; for(const c of CHANNELS) for(const x of db.messages[c]) if(x.task&&x.dispute&&!x.deleted) o.push({...out(x,c,true),chatCount:(db.taskChats[x.id]||[]).length,ipOverlap:!!((x.ratings&&Object.values(x.ratings).some(v=>v.ipOverlap))||((db.users[x.user]||{}).ips||[]).some(i=>((db.users[x.claimedBy]||{}).ips||[]).includes(i))),resolved:x.stage!=='disputed'}); return send(res,200,o.sort((a,b)=>(a.resolved-b.resolved)||b.dispute.time.localeCompare(a.dispute.time)))}
      if(p==='/api/admin/reports'&&GET) return send(res,200,db.reports.slice().reverse().map(x=>{const t=x.target==='task'?findTask(x.targetId):null; return {...x,targetText:t?(t.msg.deleted?db.deletedTexts[t.msg.id]:t.msg.text):null,targetChannel:t?t.ch:null,targetExists:x.target==='user'?!!db.users[x.targetId]:!!t}}));
      const rm2=p.match(/^\/api\/admin\/reports\/([^/]+)\/(resolve|delete)$/);
      if(rm2&&POST){const i=db.reports.findIndex(x=>x.id===rm2[1]); if(i<0) return send(res,404,{error:'举报不存在'});
        if(rm2[2]==='delete'){db.reports.splice(i,1);persist();return send(res,200,{ok:true})}
        const b=await body(req), x=db.reports[i]; x.resolved=true; x.resolvedAt=new Date().toISOString(); x.note=str(b.note,200); persist(); return send(res,200,x)}
      return send(res,404,{error:'接口不存在'});
    }
    // 管理员处理纠纷：POST /api/admin/tasks/<id>/force {action:'done'|'close', reason}
    const fm=p.match(/^\/api\/admin\/tasks\/(\d+)\/force$/);
    if(fm&&POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      const t=findTask(fm[1]); if(!t||t.msg.deleted) return send(res,404,{error:'任务不存在'}); const m=t.msg,b=await body(req),reason=str(b.reason,100),now=new Date().toISOString();
      if(m.done||m.cancelled) return send(res,409,{error:'任务已经结束了',status:status(m)});
      if(b.action==='done'){ if(!m.claimedBy) return send(res,400,{error:'任务还没人接单，不能强制完成'}); finishTask(m,now); m.forcedBy=n; sysChat(m,'管理员强制完成了任务'+(reason?'：'+reason:'')); }
      else if(b.action==='close'){ // 关闭不自动退分：管理员勾选 refundPost / refundClaim 才退对应的积分
        const yes=v=>v===true||v==='true'||v===1||v==='1';
        const rp=yes(b.refundPost)&&m.cost&&!m.refunded&&!m.userDeleted&&db.users[m.user]?m.cost:0, rc=yes(b.refundClaim)&&m.claimedBy&&m.claimCost&&!m.claimRefunded&&!m.claimerDeleted&&db.users[m.claimedBy]?m.claimCost:0;
        m.cancelled=true;m.closed=true;m.cancelledAt=now;m.forcedBy=n;m.closeReason=reason; delete m.stage; expireOffers(m,'任务已被管理员关闭',n);
        if(rp){addPoints(m.user,rp,'refund','管理员关闭任务，退还发布积分',m.id);m.refunded=true}
        if(rc){addPoints(m.claimedBy,rc,'refund','管理员关闭任务，退还接单积分',m.id);m.claimRefunded=true}
        m.closeRefund={post:rp,claim:rc};
        const rt=[rp?'退还发布人 '+rp+' 积分':'',rc?'退还接单人 '+rc+' 积分':''].filter(Boolean).join('，')||'不退积分';
        sysChat(m,'管理员关闭了任务'+(reason?'：'+reason:'')+'（'+rt+'）'); }
      else return send(res,400,{error:'action 要是 done 或 close'});
      if(m.dispute){m.dispute.resolvedAt=now;m.dispute.resolution=b.action;m.dispute.resolvedBy=n;m.dispute.note=reason}
      recalc(m);
      if(b.action==='done'){const w='管理员强制完成了任务'; ev(m.user,'force',m,w,n); ev(m.claimedBy,'force',m,w,n)}
      else {const cr=m.closeRefund; ev(m.user,'force',m,'管理员关闭了任务'+(cr.post?'，退还你 '+cr.post+' 发布积分':'，发布积分不退'),n); if(m.claimedBy) ev(m.claimedBy,'force',m,'管理员关闭了任务'+(cr.claim?'，退还你 '+cr.claim+' 接单积分':'，接单积分不退'),n)}
      m.rev=nextRev(); persist(); return send(res,200,out(m,t.ch,true));
    }
    // 私聊图片：POST /api/tasks/<id>/chat/image（body 是图片二进制，或 JSON {data:base64}）；GET /api/tasks/<id>/chat/image/<消息id>
    const ti=p.match(/^\/api\/tasks\/(\d+)\/chat\/image(?:\/(\d+))?$/);
    if(ti&&((POST&&!ti[2])||(GET&&ti[2]))){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      const t=findTask(ti[1]); if(!t||(t.msg.deleted&&!canReadChat(n))) return send(res,404,{error:'任务不存在'});
      const m=t.msg, adm=canReadChat(n), mine=isPoster(m,n)||isClaimer(m,n),account=db.users[n];
      if(!adm&&!mine) return send(res,403,{error:'只有发布人和接单人能看这个私聊'});
      if(GET){ const x=chatOf(m,adm).find(y=>String(y.id)===ti[2]&&y.image); if(!x) return send(res,404,{error:'图片不存在'});
        fs.readFile(path.join(UPLOADS,String(m.id),x.id+'.'+x.imageExt),(e,d)=>{if(userOf(req)!==n||(!canReadChat(n)&&!(isPoster(m,n)||isClaimer(m,n))))return send(res,403,{error:'查看权限已变化'});if(e) return send(res,404,{error:'图片不存在'}); res.writeHead(200,{'Content-Type':x.imageExt==='png'?'image/png':'image/jpeg','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}); res.end(d)}); return; }
      if(!mine&&!can(n,'joinChats'))return send(res,403,{error:'未获参与任务私聊权限，只能查看'});
      if(!canWriteChat(m,n))return send(res,409,{error:'订单已结束或账号不可发言'});
      if(banned(n)) return send(res,403,BANNED);
      if(!m.claimedBy) return send(res,409,{error:'任务还没人接，不能私聊'});
      if(m.cancelled||m.deleted) return send(res,409,{error:'任务已撤销'});
      const clen=+req.headers['content-length']||0; if(clen>IMG_MAX*1.4+1000){res.setHeader('Connection','close');send(res,413,{error:'图片不能超过 300KB'});req.resume();setTimeout(()=>req.destroy(),5000).unref();return}
      let buf=await rawBody(req,IMG_MAX*1.4+1000), kind='', cap=''; if(!buf){res.setHeader('Connection','close');return send(res,413,{error:'图片不能超过 300KB'})}
      if(userOf(req)!==n||db.users[n]!==account)return send(res,401,{error:'登录状态已变化，请重新登录'});
      if(banned(n))return send(res,403,BANNED);
      if(/json/.test(req.headers['content-type']||'')){try{const j=JSON.parse(buf.toString());buf=Buffer.from(String(j.data||'').replace(/^data:[^,]*,/,''),'base64'); if(j.kind==='payqr') kind='payqr'; if(typeof j.text==='string') cap=j.text.trim().slice(0,100)}catch{return send(res,400,{error:'图片格式不对'})}}
      if(!canWriteChat(m,n)) return send(res,409,{error:'任务状态已经变了，请刷新'});
      if(!buf.length) return send(res,400,{error:'图片不能为空'}); if(buf.length>IMG_MAX) return send(res,413,{error:'图片不能超过 300KB'});
      const ext=buf[0]===0xFF&&buf[1]===0xD8&&buf[2]===0xFF?'jpg':buf.slice(0,8).equals(Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]))?'png':null;
      if(!ext) return send(res,400,{error:'只支持 JPEG 或 PNG 图片'});
      const day=new Date(Date.now()+8*3600e3).toISOString().slice(0,10), dc=db.imgDaily[n]&&db.imgDaily[n].day===day?db.imgDaily[n].count:0;
      if(dc>=IMG_DAILY) return send(res,429,{error:'每人每天最多发 '+IMG_DAILY+' 张图片'});
      if(uploadBytes+buf.length>UPLOAD_MAX) return send(res,507,{error:'服务器图片空间已满，请联系管理员'});
      if((UB.get(n)||0)+buf.length>USER_IMG_MAX) return send(res,409,{error:'你的图片空间已满（每人最多 20MB），旧任务结束 30 天后会自动清理'});
      const list=db.taskChats[m.id]=db.taskChats[m.id]||[]; if(list.length>=TASK_CHAT_MAX) return send(res,409,{error:'这个任务的私聊消息太多了'});
      const x={id:newId(),user:n,text:cap,time:new Date().toISOString(),claimer:m.claimedBy,...(!isPoster(m,n)&&!isClaimer(m,n)?{moderator:true}:{}),imageExt:ext,imageSize:buf.length,...(kind?{kind}:{})};
      x.image='/api/tasks/'+m.id+'/chat/image/'+x.id;
      try{fs.mkdirSync(path.join(UPLOADS,String(m.id)),{recursive:true});fs.writeFileSync(path.join(UPLOADS,String(m.id),x.id+'.'+ext),buf)}catch(e){console.error('存图失败',e.message);return send(res,500,{error:'图片保存失败'})}
      uploadBytes+=buf.length; UB.set(n,(UB.get(n)||0)+buf.length); db.imgDaily[n]={day,count:dc+1};
      list.push(x); (db.chatRead[m.id]=db.chatRead[m.id]||Object.create(null))[n]=x.id; recalc(m); m.rev=nextRev(); persist(); return send(res,200,x);
    }
    // 任务私聊：GET/POST /api/tasks/<id>/chat，GET 支持 ?after=<消息id或时间>；GET /api/my/chat-unread；管理员 GET /api/admin/chats
    const tc=p.match(/^\/api\/tasks\/(\d+)\/chat$/);
    if(tc&&(GET||POST)){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      const t=findTask(tc[1]); if(!t||(t.msg.deleted&&!canReadChat(n))) return send(res,404,{error:'任务不存在'});
      const m=t.msg, adm=canReadChat(n), mine=isPoster(m,n)||isClaimer(m,n);
      if(!adm&&!mine) return send(res,403,{error:'只有发布人和接单人能看这个私聊'});
      if(GET){
        const a=u.searchParams.get('after'); let list=chatOf(m,adm);
        if(a){const v=Number(a); if(!isNaN(v)&&v>1e14) list=list.filter(x=>x.id>v); else {const ms=isNaN(v)?Date.parse(a):v; if(!isNaN(ms)) list=list.filter(x=>Date.parse(x.time)>ms)}}
        if(mine){const all=chatOf(m); if(all.length){const r=(db.chatRead[m.id]=db.chatRead[m.id]||Object.create(null)), last=all[all.length-1].id; if(r[n]!==last){r[n]=last; recalc(m); persist()}}}
        return send(res,200,{poster:m.user,task:{id:m.id,channel:t.ch,user:m.user,status:status(m),claimerDeleted:!!m.claimerDeleted,claimedBy:m.claimedBy||null,done:!!m.done,cancelled:!!m.cancelled,canWrite:canWriteChat(m,n),moderator:!mine&&can(n,'joinChats'),...(m.dispute?{dispute:out(m,null,adm||n).dispute}:{}),...(m.autoConfirmed?{autoConfirmed:true}:{})},messages:list});
      }
      if(!mine&&!can(n,'joinChats'))return send(res,403,{error:'未获参与任务私聊权限，只能查看'});
      if(!canWriteChat(m,n))return send(res,409,{error:'订单已结束或账号不可发言'});
      if(banned(n)) return send(res,403,BANNED);
      if(!m.claimedBy) return send(res,409,{error:'任务还没人接，不能私聊'});
      if(m.cancelled||m.deleted) return send(res,409,{error:'任务已撤销'});
      const b=await body(req); if(!canWriteChat(m,n)) return send(res,409,{error:'任务状态已经变了，请刷新'});
      if(typeof b.text!=='string'||!b.text.trim()) return send(res,400,{error:'消息不能为空'});
      if(limited('tchat:'+n,20)) return send(res,429,{error:'发得太快了，请稍后再试'});
      const list=db.taskChats[m.id]=db.taskChats[m.id]||[]; if(list.length>=TASK_CHAT_MAX) return send(res,409,{error:'这个任务的私聊消息太多了'});
      const x={id:newId(),user:n,text:b.text.trim().slice(0,500),time:new Date().toISOString(),claimer:m.claimedBy,...(!isPoster(m,n)&&!isClaimer(m,n)?{moderator:true}:{})};
      list.push(x); (db.chatRead[m.id]=db.chatRead[m.id]||Object.create(null))[n]=x.id; recalc(m); m.rev=nextRev(); persist(); return send(res,200,x);
    }
    if(p==='/api/my/chat-unread'&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      return send(res,200,Object.fromEntries(UR.get(n)||[]));
    }
    if(p==='/api/admin/chats'&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      const o=[]; for(const [tid,list] of Object.entries(db.taskChats)){if(!list.length)continue; const t=findTask(tid); const l=list[list.length-1];
        o.push({taskId:Number(tid),channel:t?t.ch:null,text:t?(t.msg.deleted?db.deletedTexts[t.msg.id]:t.msg.text):null,user:t?t.msg.user:null,claimedBy:t?t.msg.claimedBy||null:null,count:list.length,last:{user:l.user,text:l.text,time:l.time}})}
      return send(res,200,o.sort((a,b)=>b.last.time.localeCompare(a.last.time)));
    }
    // GET /api/my/tasks  我的任务（需登录）-> {posted:[...], claimed:[...]}，每条带 channel，按时间倒序，不含已删除的
    const oneTask=p.match(/^\/api\/tasks\/(\d+)$/);
    if(oneTask&&GET){const n=userOf(req);if(!n)return send(res,401,{error:'请先登录'});const t=findTask(oneTask[1]);if(!t)return send(res,404,{error:'订单不存在'});if(!isPoster(t.msg,n)&&!isClaimer(t.msg,n)&&!canInspect(n))return send(res,403,{error:'无权查看该订单'});return send(res,200,withUnread(out(t.msg,t.ch,n),n))}
    if(p==="/api/my/tasks"&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:"请先登录"});
      const all=CHANNELS.flatMap(c=>db.messages[c].filter(x=>x.task&&(!x.deleted||u.searchParams.get('includeHistory')==='1')&&(isPoster(x,n)||isClaimer(x,n))).map(x=>out(x,c,n))).sort((a,b)=>b.id-a.id);
      return send(res,200,{posted:all.filter(x=>x.user===n).map(x=>withUnread(x,n)),claimed:all.filter(x=>x.claimedBy===n).map(x=>withUnread(x,n))});
    }
    // GET /api/tasks?status=open|claimed|done|all&limit=10  跨频道任务；open=没人接、没撤销、没过期
    if(p==="/api/tasks"&&GET){
      const st=u.searchParams.get("status")||"open", lim=Math.min(Math.max(parseInt(u.searchParams.get("limit"))||10,1),100);
      if(!['open','claimed','done','all'].includes(st))return send(res,400,{error:'任务状态无效'});
      const me=userOf(req),q=(u.searchParams.get('q')||'').trim().toLowerCase().slice(0,50),all=[];
      for(const c of CHANNELS)for(const x of db.messages[c]){if(!x.task||!alive(x)||st==='open'&&(x.claimedBy||expired(x))||st==='claimed'&&(!x.claimedBy||x.done)||st==='done'&&!x.done)continue;
        if(q&&![x.text,x.place,x.reward].some(v=>String(v||'').toLowerCase().includes(q)))continue;all.push({msg:x,ch:c})}
      const compare=taskComparator(u.searchParams.get('sort'));all.sort((a,b)=>compare(a.msg,b.msg));
      return send(res,200,all.slice(0,lim).map(x=>withUnread(out(x.msg,x.ch,me),me)));
    }
    // GET /api/channels/:name/notices?limit=50  置顶公告：全站公告 + 管理员在这个频道发的普通消息，按时间倒序
    const nm=p.match(/^\/api\/channels\/([^/]+)\/notices$/);
    if(nm&&GET){const ch=nm[1]; if(!db.messages[ch]) return send(res,404,{error:'频道不存在'}); const lim=Math.min(Math.max(parseInt(u.searchParams.get('limit'))||50,1),100);
      const a=db.announcements.map(x=>({id:x.id,type:'global',title:x.title,text:x.text,user:x.user,time:x.time}));
      const c=db.messages[ch].filter(x=>!x.task&&!x.deleted&&x.official).map(x=>({id:x.id,type:'channel',title:'',text:x.text,user:x.user,time:x.time,channel:ch}));
      return send(res,200,a.concat(c).sort((x,y)=>y.time.localeCompare(x.time)||y.id-x.id).slice(0,lim))}
    // GET /api/channels/:name/messages?rev=<n>（或旧的 ?since=<id>）；POST 同路径 {text,task,reward,place,deadline}
    const m=p.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if(m){
      const ch=m[1]; if(!db.messages[ch]) return send(res,404,{error:'频道不存在'});
      if(GET){
        // ?rev=<n> 返回 rev 大于 n 的消息（含新消息、状态变化、被删除的），响应头 X-Rev 是当前最大 rev
        const rv=u.searchParams.get('rev'), me=userOf(req);
        const q=(u.searchParams.get('q')||'').trim().toLowerCase().slice(0,50), so=u.searchParams.get('sort');
        if(q||so){const lim=Math.min(Math.max(parseInt(u.searchParams.get('limit'))||50,1),100); let l=db.messages[ch].filter(x=>x.task&&alive(x)); if(q) l=l.filter(x=>[x.text,x.place,x.reward].some(v=>String(v||'').toLowerCase().includes(q))); return send(res,200,sortTasks(l,so).slice(0,lim).map(x=>withUnread(out(x,null,me),me)))}
        const bf=u.searchParams.get('before');
        if(bf!==null){const b=+bf||0;const l=db.messages[ch].filter(x=>x.id<b);return send(res,200,l.slice(-50).map(x=>withUnread(out(x,null,me),me)))}
        if(rv!==null){const n=+rv||0;res.setHeader('X-Rev',String(db.rev||0));const l=n>0?db.messages[ch].filter(x=>(x.rev||0)>n):db.messages[ch].slice(-50);return send(res,200,l.map(x=>withUnread(out(x,null,me),me)));}
        const s=+u.searchParams.get('since')||0; return send(res,200,db.messages[ch].filter(x=>x.id>s).map(x=>withUnread(out(x,null,me),me)));}
      if(POST){
        const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
        if(banned(n)) return send(res,403,BANNED);
        if(limited("msg:"+n,10)) return send(res,429,{error:"发得太快了，请稍后再试"});
        const b=await body(req); if(typeof b.text!=='string'||!b.text.trim()) return send(res,400,{error:'消息不能为空'});
        for(const k of ['reward','place','deadline']) if(b[k]!=null&&typeof b[k]!=='string'&&typeof b[k]!=='number') return send(res,400,{error:k+' 格式不对'});
        if(!b.task&&!can(n,'postOfficial')) return send(res,403,{error:'频道里只能发布任务'});
        const msg={id:newId(),user:n,text:String(b.text).slice(0,2000),task:!!b.task,time:new Date().toISOString()};
        if(can(n,'postOfficial')) msg.official=true;
        if(msg.task){
          const reward=str(b.reward,20),place=str(b.place,50);
          if(reward) msg.reward=reward; if(place) msg.place=place;
          if(b.deadline){const t=Date.parse(b.deadline); if(isNaN(t)) return send(res,400,{error:'截止时间格式不对'}); if(t<=Date.now()) return send(res,400,{error:'截止时间要晚于现在'}); msg.deadline=new Date(t).toISOString();}
        }
        if(msg.task){
          if(b.bonusPoints!=null&&b.bonusPoints!==''&&b.bonusPoints!==0){ if(!can(n,'publishBonus')) return send(res,403,{error:'没有发布积分奖励任务的权限'}); const bp=intIn(b.bonusPoints,1,100000); if(bp==null) return send(res,400,{error:'奖励积分要是 1-100000 的整数'}); msg.bonusPoints=bp; }
          if(!can(n,'freeTasks')){const c=S().postCost; if(pts(n)<c) return send(res,402,noPoints(n,c)); if(c>0){addPoints(n,-c,'post','发布任务',msg.id); msg.cost=c}}
        }
        msg.rev=nextRev(); db.messages[ch].push(msg); IDX.set(String(msg.id),{msg,ch}); persist(); return send(res,200,out(msg,null,n));
      }
    }
    return send(res,404,{error:'接口不存在'});
  }
  const publicName=p==='/'?'index.html':p.slice(1);
  if(!PUBLIC_FILES.has(publicName)){res.writeHead(403);return res.end()}
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{'Allow':'GET, HEAD'});return res.end()}
  const f=path.join(ROOT,publicName);
  fs.stat(f,(e,st)=>{if(e||!st.isFile()){res.writeHead(404);return res.end('Not found')}
    const ext=path.extname(f).toLowerCase(), img=/^\.(png|jpe?g|webp|svg|ico|gif)$/.test(ext), etag='"'+st.size.toString(36)+'-'+Math.floor(st.mtimeMs).toString(36)+'"';
    const h={'Content-Type':MIME[ext]||'application/octet-stream','ETag':etag,'Cache-Control':img?'public, max-age=604800':'no-cache',...(/\/sw\.js$/.test(f)?{'Service-Worker-Allowed':'/'}:{}),'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN'};
    if(req.headers['if-none-match']===etag){res.writeHead(304,h);return res.end()}
    fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}
      const gz=/gzip/.test(req.headers['accept-encoding']||'')&&/^\.(html|js|css|json|svg|txt)$/.test(ext)&&d.length>512;
      if(gz){let c=gzCache.get(f); if(!c||c.etag!==etag){c={etag,data:zlib.gzipSync(d)};gzCache.set(f,c)} h['Content-Encoding']='gzip';h['Vary']='Accept-Encoding';d=c.data}
      res.writeHead(200,h);res.end(req.method==='HEAD'?undefined:d)})});
};
// 任何请求出错都返回 500，不会让请求一直挂着
const server=http.createServer((req,res)=>handle(req,res).catch(e=>{if(!e.statusCode)console.error('请求出错',req.method,req.url,e&&e.stack||e);try{if(!res.headersSent)return send(res,e.statusCode||500,{error:e.statusCode?e.message:'服务器出错了'});res.end()}catch{}}));
server.listen(PORT,BIND_HOST,()=>console.log('Aevon校园交流网运行在 http://localhost:'+server.address().port+(ADMINS.length?'，管理员：'+ADMINS.join(','):'')));
