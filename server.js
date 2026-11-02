// Aevon校园交流网 后端：静态文件 + 登录 + 频道消息 + 公告（数据存 data.json，每日备份到 backups/）
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto'),zlib=require('zlib');
const PORT=process.env.PORT||3000, ROOT=__dirname, DATA_DIR=path.resolve(process.env.DATA_DIR||ROOT), DB=path.join(DATA_DIR,'data.json'), BAK=path.join(DATA_DIR,'backups');
try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch{}
const CHANNELS=['校园跑','食堂配送','代取快递','代课'];
let db={users:{},sessions:{},messages:{}};
try{db=JSON.parse(fs.readFileSync(DB,'utf8'))}catch{}
db.users=db.users||{};db.sessions=db.sessions||{};db.messages=db.messages||{};db.announcements=db.announcements||[];db.deletedTexts=db.deletedTexts||{};
// 用无原型对象，防止 __proto__、constructor 这类用户名或频道名命中内置属性
for(const k of ['users','sessions','messages','deletedTexts']) if(db[k]&&typeof db[k]==='object') db[k]=Object.assign(Object.create(null),db[k]);
CHANNELS.forEach(c=>db.messages[c]=db.messages[c]||[]);
// 先写临时文件再改名，避免写一半崩溃把 data.json 弄坏
// 200ms 内的多次写合并成一次；进程退出前会立即写盘
let persistTimer=null;
const persistNow=()=>{if(persistTimer){clearTimeout(persistTimer);persistTimer=null}fs.writeFileSync(DB+".tmp",JSON.stringify(db));fs.renameSync(DB+".tmp",DB)};
const persist=()=>{if(!persistTimer)persistTimer=setTimeout(()=>{persistTimer=null;try{persistNow()}catch(e){console.error('写盘失败',e.message)}},200)};
process.on('exit',()=>{if(persistTimer)try{persistNow()}catch{}});
for(const sig of ['SIGTERM','SIGINT']) process.on(sig,()=>{try{persistNow()}catch{}process.exit(0)});
// 唯一管理员：环境变量 ADMIN（兼容旧的 ADMINS，只取第一个），全站只认这一个账号
const ADMIN=(process.env.ADMIN||(process.env.ADMINS||'').split(',')[0]||'AevonEcho').trim();
const ADMINS=ADMIN?[ADMIN]:[];
const banned=n=>!!(n&&db.users[n]&&db.users[n].banned);
const BANNED={error:'账号已被封禁',banned:true};
const isAdmin=n=>!!n&&ADMINS.includes(n);
const legacy=p=>crypto.createHash("sha256").update("campus:"+p).digest("hex");
const hash=(p,salt=crypto.randomBytes(16).toString("hex"))=>"s1$"+salt+"$"+crypto.scryptSync(p,salt,32).toString("hex");
const scryptA=(p,salt)=>new Promise((ok,no)=>crypto.scrypt(p,salt,32,(e,k)=>e?no(e):ok(k)));
const hashA=async(p,salt=crypto.randomBytes(16).toString("hex"))=>"s1$"+salt+"$"+(await scryptA(p,salt)).toString("hex");
const verifyA=async(p,h)=>{if(!h)return false;if(!h.startsWith("s1$"))return h===legacy(p);const salt=h.split("$")[1];const x=Buffer.from(await hashA(p,salt)),y=Buffer.from(h);return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const verify=(p,h)=>{if(!h)return false;if(!h.startsWith("s1$"))return h===legacy(p);const salt=h.split("$")[1];return crypto.timingSafeEqual(Buffer.from(hash(p,salt)),Buffer.from(h))};
const SESSION_MS=7*24*3600e3, hits={};
// 按账号限制登录失败：同一用户名 15 分钟内错 10 次就先锁住，不管请求从哪个 IP 来
const fails=new Map(),FAIL_MS=15*60e3,failCount=n=>{const k=String(n).toLowerCase(),a=(fails.get(k)||[]).filter(t=>Date.now()-t<FAIL_MS);fails.set(k,a);return a.length},addFail=n=>{const k=String(n).toLowerCase();fails.set(k,[...(fails.get(k)||[]),Date.now()])};
const limited=(key,max=20)=>{const now=Date.now(),a=(hits[key]||[]).filter(t=>now-t<60e3);a.push(now);hits[key]=a;return a.length>max};
const nextRev=()=>db.rev=(db.rev||0)+1;
// ===== 积分 =====
db.settings=Object.assign({postCost:1,claimCost:1,signupBonus:10},db.settings||{}); db.ledger=db.ledger||[]; db.recharges=db.recharges||[]; db.feedback=db.feedback||[];
// 任务私聊：taskChats[任务id]=[{id,user,text,time,claimer}]；chatRead[任务id][用户]=读到的最后一条 id
db.taskChats=Object.assign(Object.create(null),db.taskChats||{}); db.chatRead=Object.assign(Object.create(null),db.chatRead||{}); for(const k in db.chatRead) db.chatRead[k]=Object.assign(Object.create(null),db.chatRead[k]);
const S=()=>db.settings, pts=n=>(db.users[n]&&db.users[n].points)||0;
const intIn=(v,min,max)=>{const x=typeof v==='string'&&v.trim()!==''?Number(v):v;return Number.isInteger(x)&&x>=min&&x<=max?x:null};
// 改积分必须走这里：同步完成「改余额+记流水」，中间没有 await，并发请求不会扣成负数
const addPoints=(n,delta,type,reason,ref)=>{const u=db.users[n];if(!u||!delta)return;u.points=(u.points||0)+delta;db.ledger.push({id:Date.now()*1000+Math.floor(Math.random()*1000),user:n,time:new Date().toISOString(),delta,balance:u.points,type,reason:reason||'',...(ref!=null?{ref:String(ref)}:{})})};
const noPoints=(n,need)=>({error:'积分不足：需要 '+need+' 积分，当前 '+pts(n)+' 积分，请先充值',points:pts(n),need});
for(const [k,u] of Object.entries(db.users)) if(u.points==null){u.points=0;if(!isAdmin(k))addPoints(k,S().signupBonus,'signup','老账号补发注册积分')}
// 任务私聊辅助：找任务、判断能不能读、算未读
const findTask=id=>{for(const c of CHANNELS){const m=db.messages[c].find(x=>x.task&&String(x.id)===String(id));if(m)return{msg:m,ch:c}}return null};
const isPoster=(m,n)=>m.user===n&&!m.userDeleted, isClaimer=(m,n)=>!!m.claimedBy&&m.claimedBy===n&&!m.claimerDeleted;
const chatOf=(m,all)=>(db.taskChats[m.id]||[]).filter(x=>all||(m.claimedBy&&x.claimer===m.claimedBy&&!x.claimerGone));
const chatUnread=(m,n)=>{if(!(isPoster(m,n)||isClaimer(m,n)))return undefined;const last=(db.chatRead[m.id]&&db.chatRead[m.id][n])||0;return chatOf(m).filter(x=>x.id>last&&x.user!==n).length};
const withUnread=(x,n)=>{if(!n)return x;const c=chatUnread(x,n);return c===undefined?x:{...x,chatUnread:c}};
const newId=()=>Date.now()*1000+Math.floor(Math.random()*1000);
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Cache-Control':'no-store'});res.end(JSON.stringify(obj))};
const body=req=>new Promise(r=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e5){d='';r({});req.destroy()}});req.on('end',()=>{try{const v=JSON.parse(d||'{}');r(v&&typeof v==='object'&&!Array.isArray(v)?v:{})}catch{r({})}})});
const tokenOf=req=>(req.headers.authorization||"").replace("Bearer ","");
const userOf=req=>{const t=tokenOf(req),x=db.sessions[t];if(!x)return null;if(typeof x==="string")return x;if(Date.now()>x.exp){delete db.sessions[t];return null}return x.user};
const expired=x=>!!(x.deadline&&!x.claimedBy&&Date.parse(x.deadline)<Date.now());
// 返回给前端时附上计算字段 expired（截止时间已过且没人接）
// 已接单、没完成、超过截止时间 24 小时 = 超时，发布人可以撤销
const overdue=x=>!!(x.task&&x.deadline&&x.claimedBy&&!x.done&&!x.cancelled&&Date.parse(x.deadline)+24*3600e3<Date.now());
const out=(x,c)=>({...x,...(c?{channel:c}:{}),expired:expired(x),overdue:overdue(x)});
const alive=x=>!x.deleted&&!x.cancelled;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.jpg':'image/jpeg','.webp':'image/webp'};
// 真实客户端 IP：部署在网关后面时（默认 TRUST_PROXY=1）读 X-Forwarded-For 里最右边那个，也就是网关自己追加的、伪造不了的那个；直连部署时设 TRUST_PROXY=0
const clientIp=req=>{if(process.env.TRUST_PROXY!=='0'){const x=String(req.headers['x-forwarded-for']||'').split(',').map(v=>v.trim()).filter(Boolean);if(x.length)return x[x.length-1];const r=req.headers['x-real-ip'];if(r)return String(r).trim()}return req.socket.remoteAddress||''};
const str=(v,max)=>v==null?'':String(v).trim().slice(0,max);

// 每日备份：启动时和之后每小时检查一次，距上次备份满 24 小时就备份，保留最近 7 份
function backup(){try{
  if(!fs.existsSync(DB))return;
  fs.mkdirSync(BAK,{recursive:true});
  const files=fs.readdirSync(BAK).filter(f=>/^data-.*\.json$/.test(f)).sort();
  const last=files.length?fs.statSync(path.join(BAK,files[files.length-1])).mtimeMs:0;
  if(Date.now()-last<24*3600e3)return;
  fs.copyFileSync(DB,path.join(BAK,'data-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json'));
  const all=fs.readdirSync(BAK).filter(f=>/^data-.*\.json$/.test(f)).sort();
  all.slice(0,Math.max(0,all.length-7)).forEach(f=>fs.unlinkSync(path.join(BAK,f)));
}catch(e){console.error('备份失败',e.message)}}
// 设置了 ADMIN_PASSWORD 时，启动时直接建好管理员账号，避免部署后被别人抢先注册（已存在就不动）
if(ADMIN&&process.env.ADMIN_PASSWORD&&!db.users[ADMIN]){db.users[ADMIN]={pw:hash(String(process.env.ADMIN_PASSWORD)),created:Date.now()};console.log('已创建管理员账号',ADMIN)}
persist();
backup();setInterval(backup,3600e3).unref();
function cleanup(){const now=Date.now();let ch=false;
  for(const [k,v] of Object.entries(db.sessions)) if(v&&typeof v==='object'&&now>v.exp){delete db.sessions[k];ch=true}
  for(const k of Object.keys(hits)) if(!hits[k].some(t=>now-t<60e3)) delete hits[k];
  for(const [k,a] of fails) if(!a.some(t=>now-t<FAIL_MS)) fails.delete(k);
  if(ch) persist()}
cleanup();setInterval(cleanup,3600e3).unref();

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
    const POST=req.method==='POST', GET=req.method==='GET';
    // POST /api/register、/api/login {username,password} -> {token,username,admin}
    if(POST&&(p==='/api/register'||p==='/api/login')){
      const {username,password}=await body(req);
      if(limited("auth:"+clientIp(req))) return send(res,429,{error:"操作太频繁，请一分钟后再试"});
      if(!username||!password) return send(res,400,{error:"用户名和密码不能为空"});
      if(typeof username!=="string"||!/^[\w\u4e00-\u9fa5]{2,16}$/.test(username)) return send(res,400,{error:"用户名需为 2-16 位中文、字母、数字或下划线"});
      if(p==="/api/register"&&String(password).length<6) return send(res,400,{error:"密码至少 6 位"});
      if(p==='/api/register'){
        if((ADMIN&&username!==ADMIN&&String(username).toLowerCase()===ADMIN.toLowerCase())||db.users[username]||Object.keys(db.users).some(k=>k.toLowerCase()===String(username).toLowerCase())) return send(res,409,{error:'用户名已存在'});
        const pw=await hashA(String(password)); if(db.users[username]) return send(res,409,{error:'用户名已存在'});
        db.users[username]={pw,created:Date.now(),points:0}; if(!isAdmin(username)) addPoints(username,S().signupBonus,'signup','注册赠送');
      } else { // 两层锁定：同账号同 IP 15 分钟错 10 次只锁这个 IP；同账号所有 IP 合计错 50 次锁整个账号（以前在这个 IP 成功登录过的本人除外）
        const ip=clientIp(req),known=!!(db.users[username]&&(db.users[username].ips||[]).includes(ip));
        if(failCount(username+'@'+ip)>=10||(failCount(username)>=50&&!known)) return send(res,429,{error:'密码错误次数太多，请 15 分钟后再试'});
        if(!db.users[username]||!(await verifyA(String(password),db.users[username].pw))||!db.users[username]){addFail(username);addFail(username+'@'+ip);return send(res,401,{error:'用户名或密码错误'})} }
      if(p==="/api/login"&&banned(username)) return send(res,403,BANNED);
      if(p==="/api/login"&&!db.users[username].pw.startsWith("s1$")){const h=await hashA(String(password)); if(db.users[username]) db.users[username].pw=h}
      {const uu=db.users[username],ip=clientIp(req); if(uu&&ip){uu.ips=[ip,...(uu.ips||[]).filter(x=>x!==ip)].slice(0,5)}}
      const token=crypto.randomBytes(16).toString('hex'); db.sessions[token]={user:username,exp:Date.now()+SESSION_MS}; persist();
      return send(res,200,{token,username,admin:isAdmin(username)});
    }
    if(p==="/api/logout"&&POST){delete db.sessions[tokenOf(req)];persist();return send(res,200,{ok:true})}
    if(p==='/api/me'){const n=userOf(req); return n?send(res,200,{username:n,admin:isAdmin(n),banned:banned(n),points:pts(n),postCost:S().postCost,claimCost:S().claimCost}):send(res,401,{error:'未登录'});}
    // POST /api/password {oldPassword,newPassword}  改密码，成功后其他设备的登录全部失效，当前 token 保留
    if(p==='/api/password'&&POST){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      if(limited("auth:"+clientIp(req))) return send(res,429,{error:"操作太频繁，请一分钟后再试"});
      const {oldPassword,newPassword}=await body(req);
      if(!(await verifyA(String(oldPassword||''),db.users[n].pw))||!db.users[n]) return send(res,401,{error:'原密码错误'});
      if(String(newPassword||'').length<6) return send(res,400,{error:'新密码至少 6 位'});
      {const h=await hashA(String(newPassword)); if(!db.users[n]) return send(res,401,{error:'请先登录'}); db.users[n].pw=h}
      const t=tokenOf(req); for(const [k,v] of Object.entries(db.sessions)) if(k!==t&&(v===n||v.user===n)) delete db.sessions[k];
      persist(); return send(res,200,{ok:true});
    }
    // 公告：GET /api/announcements（新的在前）；POST 同路径 {title,text}（仅管理员）；POST /api/announcements/:id/delete（仅管理员）
    if(p==='/api/announcements'){
      if(GET) return send(res,200,db.announcements.slice().sort((a,b)=>b.id-a.id));
      if(POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能发公告'});
        const b=await body(req),title=str(b.title,60),text=str(b.text,2000); if(!title) return send(res,400,{error:'公告标题不能为空'});
        const a={id:newId(),title,text,user:n,time:new Date().toISOString()}; db.announcements.push(a); persist(); return send(res,200,a);}
    }
    const am=p.match(/^\/api\/announcements\/(\d+)\/delete$/);
    if(am&&POST){const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能删除公告'});
      const i=db.announcements.findIndex(x=>String(x.id)===am[1]); if(i<0) return send(res,404,{error:'公告不存在'});
      db.announcements.splice(i,1); persist(); return send(res,200,{ok:true});}
    // 管理员总览：GET /api/admin/overview（仅管理员）-> 全部用户、全部频道消息（含已删除消息的原文 deletedText）、公告
    if(p==='/api/admin/overview'&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      const online={}; for(const v of Object.values(db.sessions)){const un=typeof v==='string'?v:(v.exp>Date.now()?v.user:null); if(un) online[un]=(online[un]||0)+1;}
      const users=Object.entries(db.users).map(([k,v])=>({username:k,created:new Date(v.created).toISOString(),admin:isAdmin(k),points:v.points||0,banned:!!v.banned,bannedAt:v.bannedAt||null,banReason:v.banReason||'',activeSessions:online[k]||0}));
      const channels=Object.fromEntries(CHANNELS.map(c=>[c,db.messages[c].map(x=>({...out(x),...(x.deleted?{deletedText:db.deletedTexts[x.id]||'',originalText:db.deletedTexts[x.id]||''}:{})}))]));
      return send(res,200,{users,channels,announcements:db.announcements,unreadFeedback:db.feedback.filter(x=>!x.read).length});
    }
    // GET /api/admin/users -> [{username,created,admin,banned,bannedAt,banReason,activeSessions,messages}]（messages=发过的消息数）
    // GET /api/admin/messages -> 全部消息（含已删除、已撤销），每条带 channel，已删除的带 originalText，按时间倒序
    if((p==='/api/admin/users'||p==='/api/admin/messages')&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      const all=CHANNELS.flatMap(c=>db.messages[c].map(x=>({...out(x,c),...(x.deleted?{originalText:db.deletedTexts[x.id]||'',deletedText:db.deletedTexts[x.id]||''}:{}),...(x.task?{chatCount:(db.taskChats[x.id]||[]).length}:{})})));
      if(p==='/api/admin/messages') return send(res,200,all.sort((a,b)=>b.id-a.id));
      const cnt={}; all.forEach(x=>cnt[x.user]=(cnt[x.user]||0)+1);
      const online={}; for(const v of Object.values(db.sessions)){const un=typeof v==='string'?v:(v.exp>Date.now()?v.user:null); if(un) online[un]=(online[un]||0)+1;}
      return send(res,200,Object.entries(db.users).map(([k,v])=>({username:k,created:new Date(v.created).toISOString(),admin:isAdmin(k),points:v.points||0,banned:!!v.banned,bannedAt:v.bannedAt||null,banReason:v.banReason||'',activeSessions:online[k]||0,messages:cnt[k]||0})));
    }
    // 封禁/解封：POST /api/admin/users/<用户名>/ban {reason}、/unban（仅管理员，不能封管理员）
    // 删除账号：POST /api/admin/users/<用户名>/delete（仅管理员，不能删管理员）
    // 删除后 token 全部失效；他的消息标记已删除（原文留给管理员看）；他发的未完成任务撤销；他接了没完成的任务放回待接单；用户名可以重新注册
    const dm=p.match(/^\/api\/admin\/users\/([^/]+)\/delete$/);
    if(dm&&POST){ let du; try{du=decodeURIComponent(dm[1])}catch{return send(res,400,{error:'用户名格式不对'})}
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      if(!db.users[du]) return send(res,404,{error:'用户不存在'}); if(isAdmin(du)) return send(res,400,{error:'不能删除管理员'});
      const now=new Date().toISOString(); let msgs=0,cancelled=0,released=0;
      for(const c of CHANNELS) for(const m of db.messages[c]){
        let ch=false;
        if(m.user===du){
          if(m.task&&!m.done&&!m.cancelled){m.cancelled=true;m.cancelledAt=now;cancelled++;ch=true}
          if(!m.deleted){db.deletedTexts[m.id]=m.text;m.deleted=true;m.text='';m.deletedBy=n;m.deletedAt=now;msgs++;ch=true}
          if(!m.userDeleted){m.userDeleted=true;ch=true}
        } else if(m.task&&m.claimedBy===du&&!m.done){delete m.claimedBy;delete m.claimedAt;m.unclaimedAt=now;released++;ch=true}
        else if(m.task&&m.claimedBy===du&&m.done&&!m.claimerDeleted){m.claimerDeleted=true;ch=true} // 已完成的保留，但标记接单人已删号，同名新账号不会认领
        if(ch) m.rev=nextRev();
      }
      for(const [k,v] of Object.entries(db.sessions)) if(v===du||v.user===du) delete db.sessions[k];
      for(const [tid,list] of Object.entries(db.taskChats)) for(const x of list){if(x.user===du&&!x.userDeleted) x.userDeleted=true; if(x.claimer===du) x.claimerGone=true}
      for(const v of Object.values(db.chatRead)) delete v[du];
      let rej=0; for(const x of db.ledger) if(x.user===du&&!x.userDeleted) x.userDeleted=true;
      for(const x of db.recharges) if(x.user===du&&!x.userDeleted){x.userDeleted=true; if(x.status==='pending'){x.status='rejected';x.reason='账号已删除';x.handledBy=n;x.handledAt=now;rej++}}
      delete db.users[du]; persist();
      return send(res,200,{username:du,deleted:true,messages:msgs,cancelledTasks:cancelled,releasedTasks:released,rejectedRecharges:rej});
    }
    const bm=p.match(/^\/api\/admin\/users\/([^/]+)\/(ban|unban)$/);
    if(bm&&POST){ let bu; try{bu=decodeURIComponent(bm[1])}catch{return send(res,400,{error:'用户名格式不对'})}
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      const t=db.users[bu]; if(!t) return send(res,404,{error:'用户不存在'}); if(isAdmin(bu)) return send(res,400,{error:'不能封禁管理员'});
      if(bm[2]==='ban'){const b=await body(req); t.banned=true; t.bannedAt=new Date().toISOString(); t.banReason=str(b.reason,100);}
      else {delete t.banned; delete t.bannedAt; delete t.banReason;}
      persist(); return send(res,200,{username:bu,banned:!!t.banned});
    }
    if(p==='/api/settings'&&GET) return send(res,200,S());
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
      const fm=p.match(/^\/api\/admin\/feedback\/([^/]+)\/(read|delete)$/);
      if(fm&&POST){ const i=db.feedback.findIndex(x=>x.id===fm[1]); if(i<0) return send(res,404,{error:'建议不存在'});
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
        if(!db.users[pu]) return send(res,404,{error:'用户不存在'});
        const b=await body(req), d=intIn(b.delta,-1000000,1000000); if(d==null||d===0) return send(res,400,{error:'调整的积分要是非 0 整数'});
        if(pts(pu)+d<0) return send(res,400,{error:'扣完会变成负数，当前只有 '+pts(pu)+' 积分'});
        addPoints(pu,d,'admin',str(b.reason,100)||'管理员调整'); persist(); return send(res,200,{username:pu,points:pts(pu)});
      }
      return send(res,404,{error:'接口不存在'});
    }
    if(p==='/api/health') return send(res,200,{ok:true,uptime:Math.round(process.uptime())});
    if(p==='/api/channels'){ if(!chCache||chCache.rev!==(db.rev||0)) chCache={rev:db.rev||0,data:CHANNELS.map(c=>{const l=db.messages[c].filter(alive);return{name:c,count:l.length,lastId:l.length?l[l.length-1].id:0}})}; return send(res,200,chCache.data)}
    // 任务和消息操作：POST /api/channels/:ch/messages/:id/<claim|unclaim|complete|done|cancel|delete>
    const am2=p.match(/^\/api\/channels\/([^/]+)\/messages\/(\d+)\/(claim|unclaim|release|kick|complete|done|cancel|delete)$/);
    if(am2&&POST){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(banned(n)) return send(res,403,BANNED);
      const list=db.messages[am2[1]]; if(!list) return send(res,404,{error:'频道不存在'});
      const msg=list.find(x=>String(x.id)===am2[2]); if(!msg||msg.deleted) return send(res,404,{error:'消息不存在'});
      const act=am2[3]==='kick'?'release':am2[3],now=new Date().toISOString();
      if(act==='delete'){ // 管理员可删任何消息；普通用户可删自己没人接的消息
        if(!isAdmin(n)&&!(msg.user===n&&!msg.claimedBy)) return send(res,403,{error:'没有权限删除这条消息'});
        if(msg.task&&msg.cost&&!msg.refunded&&!msg.cancelled&&!msg.claimedBy&&!msg.done){addPoints(msg.user,msg.cost,'refund','删除未接任务退还',msg.id);msg.refunded=true}
        if(msg.task&&msg.claimedBy&&!msg.done&&!msg.cancelled&&isAdmin(n)){ // 管理员删除已接单的任务：双方都退分
          if(msg.cost&&!msg.refunded&&!msg.userDeleted){addPoints(msg.user,msg.cost,'refund','管理员删除任务退还',msg.id);msg.refunded=true}
          if(msg.claimCost&&!msg.claimRefunded&&!msg.claimerDeleted){addPoints(msg.claimedBy,msg.claimCost,'refund','管理员删除任务退还接单积分',msg.id);msg.claimRefunded=true}}
        db.deletedTexts[msg.id]=msg.text;msg.deleted=true;msg.text='';msg.deletedBy=n;msg.deletedAt=now;
      } else {
        if(!msg.task) return send(res,404,{error:'任务不存在'});
        if(msg.cancelled) return send(res,409,{error:'任务已撤销'});
        if(act==='claim'){
          if(msg.user===n) return send(res,400,{error:'不能接自己发布的任务'});
          if(msg.claimedBy) return send(res,409,{error:'已被 '+msg.claimedBy+' 接单'});
          if(expired(msg)) return send(res,409,{error:'任务已过期'});
          if(!isAdmin(n)){const c=S().claimCost; if(pts(n)<c) return send(res,402,noPoints(n,c)); if(c>0){addPoints(n,-c,'claim','接单',msg.id); msg.claimCost=c}}
          msg.claimedBy=n;msg.claimedAt=now;
        } else if(act==='unclaim'){ // 接单人放弃，任务回到待接单
          if(msg.claimedBy!==n) return send(res,403,{error:'只有接单人能放弃接单'});
          if(msg.done) return send(res,409,{error:'任务已完成，不能放弃'});
          delete msg.claimedBy;delete msg.claimedAt;delete msg.claimCost;msg.unclaimedAt=now;
        } else if(act==='release'){ // 发布人取消接单人：任务回到待接单，退还接单人的接单分
          if(msg.user!==n) return send(res,403,{error:'只有发布者能取消接单人'});
          if(!msg.claimedBy) return send(res,400,{error:'任务还没人接单'});
          if(msg.done) return send(res,409,{error:'任务已完成'});
          if(msg.claimCost&&!msg.claimerDeleted&&db.users[msg.claimedBy]) addPoints(msg.claimedBy,msg.claimCost,'refund','发布人取消接单，退还接单积分',msg.id);
          msg.releasedBy=msg.claimedBy;delete msg.claimedBy;delete msg.claimedAt;delete msg.claimCost;msg.unclaimedAt=now;
        } else if(act==='cancel'){ // 发布者撤销没人接的任务，或已超时的任务
          if(msg.user!==n) return send(res,403,{error:'只有发布者能撤销'});
          if(msg.done) return send(res,409,{error:'任务已完成'});
          if(msg.claimedBy&&!overdue(msg)) return send(res,409,{error:'任务已被接单，请先取消接单人再撤回'});
          msg.cancelled=true;msg.cancelledAt=now; if(msg.cost&&!msg.refunded){addPoints(msg.user,msg.cost,'refund','撤回任务退还',msg.id);msg.refunded=true}
        } else { // complete / done
          if(msg.user!==n) return send(res,403,{error:"只有发布者能确认完成"});
          if(!msg.claimedBy) return send(res,400,{error:"任务还没人接单"});
          if(msg.done) return send(res,409,{error:"任务已完成"});
          msg.done=true;msg.doneAt=now; if(msg.bonusPoints&&!msg.bonusPaid&&!msg.claimerDeleted&&db.users[msg.claimedBy]){addPoints(msg.claimedBy,msg.bonusPoints,'bonus','完成积分任务',msg.id);msg.bonusPaid=true}
        }
      }
      msg.rev=nextRev(); persist(); return send(res,200,out(msg));
    }
    // 任务私聊：GET/POST /api/tasks/<id>/chat，GET 支持 ?after=<消息id或时间>；GET /api/my/chat-unread；管理员 GET /api/admin/chats
    const tc=p.match(/^\/api\/tasks\/(\d+)\/chat$/);
    if(tc&&(GET||POST)){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      const t=findTask(tc[1]); if(!t||(t.msg.deleted&&!isAdmin(n))) return send(res,404,{error:'任务不存在'});
      const m=t.msg, adm=isAdmin(n), mine=isPoster(m,n)||isClaimer(m,n);
      if(!adm&&!mine) return send(res,403,{error:'只有发布人和接单人能看这个私聊'});
      if(GET){
        const a=u.searchParams.get('after'); let list=chatOf(m,adm&&!mine);
        if(a){const v=Number(a); if(!isNaN(v)&&v>1e14) list=list.filter(x=>x.id>v); else {const ms=isNaN(v)?Date.parse(a):v; if(!isNaN(ms)) list=list.filter(x=>Date.parse(x.time)>ms)}}
        if(mine){const all=chatOf(m); if(all.length){const r=(db.chatRead[m.id]=db.chatRead[m.id]||Object.create(null)), last=all[all.length-1].id; if(r[n]!==last){r[n]=last; persist()}}}
        return send(res,200,{poster:m.user,task:{id:m.id,channel:t.ch,user:m.user,claimedBy:m.claimedBy||null,done:!!m.done,cancelled:!!m.cancelled,canWrite:mine&&!!m.claimedBy&&!m.cancelled&&!m.deleted},messages:list});
      }
      if(adm&&!mine) return send(res,403,{error:'管理员只能查看私聊，不能发消息'});
      if(banned(n)) return send(res,403,BANNED);
      if(!m.claimedBy) return send(res,409,{error:'任务还没人接，不能私聊'});
      if(m.cancelled||m.deleted) return send(res,409,{error:'任务已撤销'});
      const b=await body(req); if(typeof b.text!=='string'||!b.text.trim()) return send(res,400,{error:'消息不能为空'});
      if(limited('tchat:'+n,20)) return send(res,429,{error:'发得太快了，请稍后再试'});
      const list=db.taskChats[m.id]=db.taskChats[m.id]||[]; if(list.length>=2000) return send(res,409,{error:'这个任务的私聊消息太多了'});
      const x={id:newId(),user:n,text:b.text.trim().slice(0,500),time:new Date().toISOString(),claimer:m.claimedBy};
      list.push(x); (db.chatRead[m.id]=db.chatRead[m.id]||Object.create(null))[n]=x.id; m.rev=nextRev(); persist(); return send(res,200,x);
    }
    if(p==='/api/my/chat-unread'&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); const o={};
      for(const c of CHANNELS) for(const m of db.messages[c]) if(m.task&&!m.deleted&&m.claimedBy){const k=chatUnread(m,n); if(k) o[m.id]=k}
      return send(res,200,o);
    }
    if(p==='/api/admin/chats'&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      const o=[]; for(const [tid,list] of Object.entries(db.taskChats)){if(!list.length)continue; const t=findTask(tid); const l=list[list.length-1];
        o.push({taskId:Number(tid),channel:t?t.ch:null,text:t?(t.msg.deleted?db.deletedTexts[t.msg.id]:t.msg.text):null,user:t?t.msg.user:null,claimedBy:t?t.msg.claimedBy||null:null,count:list.length,last:{user:l.user,text:l.text,time:l.time}})}
      return send(res,200,o.sort((a,b)=>b.last.time.localeCompare(a.last.time)));
    }
    // GET /api/my/tasks  我的任务（需登录）-> {posted:[...], claimed:[...]}，每条带 channel，按时间倒序，不含已删除的
    if(p==="/api/my/tasks"&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:"请先登录"});
      const all=CHANNELS.flatMap(c=>db.messages[c].filter(x=>x.task&&!x.deleted).map(x=>out(x,c))).sort((a,b)=>b.id-a.id);
      return send(res,200,{posted:all.filter(x=>x.user===n).map(x=>withUnread(x,n)),claimed:all.filter(x=>x.claimedBy===n&&!x.claimerDeleted).map(x=>withUnread(x,n))});
    }
    // GET /api/tasks?status=open|claimed|done|all&limit=10  跨频道任务；open=没人接、没撤销、没过期
    if(p==="/api/tasks"&&GET){
      const st=u.searchParams.get("status")||"open", lim=Math.min(Math.max(parseInt(u.searchParams.get("limit"))||10,1),100);
      let all=CHANNELS.flatMap(c=>db.messages[c].filter(x=>x.task&&alive(x)).map(x=>out(x,c)));
      if(st==="open") all=all.filter(x=>!x.claimedBy&&!x.expired); else if(st==="claimed") all=all.filter(x=>x.claimedBy&&!x.done); else if(st==="done") all=all.filter(x=>x.done);
      const me=userOf(req); return send(res,200,all.sort((a,b)=>b.id-a.id).slice(0,lim).map(x=>withUnread(x,me)));
    }
    // GET /api/channels/:name/notices?limit=50  置顶公告：全站公告 + 管理员在这个频道发的普通消息，按时间倒序
    const nm=p.match(/^\/api\/channels\/([^/]+)\/notices$/);
    if(nm&&GET){const ch=nm[1]; if(!db.messages[ch]) return send(res,404,{error:'频道不存在'}); const lim=Math.min(Math.max(parseInt(u.searchParams.get('limit'))||50,1),100);
      const a=db.announcements.map(x=>({id:x.id,type:'global',title:x.title,text:x.text,user:x.user,time:x.time}));
      const c=db.messages[ch].filter(x=>!x.task&&!x.deleted&&isAdmin(x.user)).map(x=>({id:x.id,type:'channel',title:'',text:x.text,user:x.user,time:x.time,channel:ch}));
      return send(res,200,a.concat(c).sort((x,y)=>y.time.localeCompare(x.time)||y.id-x.id).slice(0,lim))}
    // GET /api/channels/:name/messages?rev=<n>（或旧的 ?since=<id>）；POST 同路径 {text,task,reward,place,deadline}
    const m=p.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if(m){
      const ch=m[1]; if(!db.messages[ch]) return send(res,404,{error:'频道不存在'});
      if(GET){
        // ?rev=<n> 返回 rev 大于 n 的消息（含新消息、状态变化、被删除的），响应头 X-Rev 是当前最大 rev
        const rv=u.searchParams.get('rev'), me=userOf(req);
        const bf=u.searchParams.get('before');
        if(bf!==null){const b=+bf||0;const l=db.messages[ch].filter(x=>x.id<b);return send(res,200,l.slice(-50).map(x=>withUnread(out(x),me)))}
        if(rv!==null){const n=+rv||0;res.setHeader('X-Rev',String(db.rev||0));const l=n>0?db.messages[ch].filter(x=>(x.rev||0)>n):db.messages[ch].slice(-50);return send(res,200,l.map(x=>withUnread(out(x),me)));}
        const s=+u.searchParams.get('since')||0; return send(res,200,db.messages[ch].filter(x=>x.id>s).map(x=>withUnread(out(x),me)));}
      if(POST){
        const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
        if(banned(n)) return send(res,403,BANNED);
        if(limited("msg:"+n,10)) return send(res,429,{error:"发得太快了，请稍后再试"});
        const b=await body(req); if(typeof b.text!=='string'||!b.text.trim()) return send(res,400,{error:'消息不能为空'});
        for(const k of ['reward','place','deadline']) if(b[k]!=null&&typeof b[k]!=='string'&&typeof b[k]!=='number') return send(res,400,{error:k+' 格式不对'});
        if(!b.task&&!isAdmin(n)) return send(res,403,{error:'频道里只能发布任务'});
        const msg={id:newId(),user:n,text:String(b.text).slice(0,2000),task:!!b.task,time:new Date().toISOString()};
        if(isAdmin(n)) msg.official=true;
        if(msg.task){
          const reward=str(b.reward,20),place=str(b.place,50);
          if(reward) msg.reward=reward; if(place) msg.place=place;
          if(b.deadline){const t=Date.parse(b.deadline); if(isNaN(t)) return send(res,400,{error:'截止时间格式不对'}); if(t<=Date.now()) return send(res,400,{error:'截止时间要晚于现在'}); msg.deadline=new Date(t).toISOString();}
        }
        if(msg.task){
          if(b.bonusPoints!=null&&b.bonusPoints!==''&&b.bonusPoints!==0){ if(!isAdmin(n)) return send(res,403,{error:'只有管理员能发积分任务'}); const bp=intIn(b.bonusPoints,1,100000); if(bp==null) return send(res,400,{error:'奖励积分要是 1-100000 的整数'}); msg.bonusPoints=bp; }
          if(!isAdmin(n)){const c=S().postCost; if(pts(n)<c) return send(res,402,noPoints(n,c)); if(c>0){addPoints(n,-c,'post','发布任务',msg.id); msg.cost=c}}
        }
        msg.rev=nextRev(); db.messages[ch].push(msg); persist(); return send(res,200,out(msg));
      }
    }
    return send(res,404,{error:'接口不存在'});
  }
  let f=path.join(ROOT,p==='/'?'index.html':p);
  if(!f.startsWith(ROOT)||f===DB||(DATA_DIR!==ROOT&&f.startsWith(DATA_DIR+path.sep))||/(server\.(js|log)|run\.sh|Dockerfile|README\.md|data\.json(\.tmp)?|\.env)$/.test(f)||/\/\./.test(p)||f.startsWith(path.join(ROOT,'old'))||f.startsWith(BAK)){res.writeHead(403);return res.end()}
  fs.stat(f,(e,st)=>{if(e||!st.isFile()){res.writeHead(404);return res.end('Not found')}
    const ext=path.extname(f).toLowerCase(), img=/^\.(png|jpe?g|webp|svg|ico|gif)$/.test(ext), etag='"'+st.size.toString(36)+'-'+Math.floor(st.mtimeMs).toString(36)+'"';
    const h={'Content-Type':MIME[ext]||'application/octet-stream','ETag':etag,'Cache-Control':img?'public, max-age=604800':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN'};
    if(req.headers['if-none-match']===etag){res.writeHead(304,h);return res.end()}
    fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}
      const gz=/gzip/.test(req.headers['accept-encoding']||'')&&/^\.(html|js|css|json|svg|txt)$/.test(ext)&&d.length>512;
      if(gz){let c=gzCache.get(f); if(!c||c.etag!==etag){c={etag,data:zlib.gzipSync(d)};gzCache.set(f,c)} h['Content-Encoding']='gzip';h['Vary']='Accept-Encoding';d=c.data}
      res.writeHead(200,h);res.end(req.method==='HEAD'?undefined:d)})});
};
// 任何请求出错都返回 500，不会让请求一直挂着
http.createServer((req,res)=>handle(req,res).catch(e=>{console.error('请求出错',req.method,req.url,e&&e.stack||e);try{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end('{"error":"服务器出错了"}')}catch{}})).listen(PORT,()=>console.log('Aevon校园交流网运行在 http://localhost:'+PORT+(ADMINS.length?'，管理员：'+ADMINS.join(','):'')));
