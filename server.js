// Aevon校园交流网 后端：静态文件 + 登录 + 频道消息 + 公告（数据存 data.json，每日备份到 backups/）
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
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
const persist=()=>{fs.writeFileSync(DB+".tmp",JSON.stringify(db,null,1));fs.renameSync(DB+".tmp",DB)};
// 唯一管理员：环境变量 ADMIN（兼容旧的 ADMINS，只取第一个），全站只认这一个账号
const ADMIN=(process.env.ADMIN||(process.env.ADMINS||'').split(',')[0]||'AevonEcho').trim();
const ADMINS=ADMIN?[ADMIN]:[];
const banned=n=>!!(n&&db.users[n]&&db.users[n].banned);
const BANNED={error:'账号已被封禁',banned:true};
const isAdmin=n=>!!n&&ADMINS.includes(n);
const legacy=p=>crypto.createHash("sha256").update("campus:"+p).digest("hex");
const hash=(p,salt=crypto.randomBytes(16).toString("hex"))=>"s1$"+salt+"$"+crypto.scryptSync(p,salt,32).toString("hex");
const verify=(p,h)=>{if(!h)return false;if(!h.startsWith("s1$"))return h===legacy(p);const salt=h.split("$")[1];return crypto.timingSafeEqual(Buffer.from(hash(p,salt)),Buffer.from(h))};
const SESSION_MS=7*24*3600e3, hits={};
// 按账号限制登录失败：同一用户名 15 分钟内错 10 次就先锁住，不管请求从哪个 IP 来
const fails=new Map(),FAIL_MS=15*60e3,failCount=n=>{const k=String(n).toLowerCase(),a=(fails.get(k)||[]).filter(t=>Date.now()-t<FAIL_MS);fails.set(k,a);return a.length},addFail=n=>{const k=String(n).toLowerCase();fails.set(k,[...(fails.get(k)||[]),Date.now()])};
const limited=(key,max=20)=>{const now=Date.now(),a=(hits[key]||[]).filter(t=>now-t<60e3);a.push(now);hits[key]=a;return a.length>max};
const nextRev=()=>db.rev=(db.rev||0)+1;
const newId=()=>Date.now()*1000+Math.floor(Math.random()*1000);
const send=(res,code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj))};
const body=req=>new Promise(r=>{let d='';req.on('data',c=>{d+=c;if(d.length>1e5){d='';r({});req.destroy()}});req.on('end',()=>{try{const v=JSON.parse(d||'{}');r(v&&typeof v==='object'&&!Array.isArray(v)?v:{})}catch{r({})}})});
const tokenOf=req=>(req.headers.authorization||"").replace("Bearer ","");
const userOf=req=>{const t=tokenOf(req),x=db.sessions[t];if(!x)return null;if(typeof x==="string")return x;if(Date.now()>x.exp){delete db.sessions[t];return null}return x.user};
const expired=x=>!!(x.deadline&&!x.claimedBy&&Date.parse(x.deadline)<Date.now());
// 返回给前端时附上计算字段 expired（截止时间已过且没人接）
const out=(x,c)=>({...x,...(c?{channel:c}:{}),expired:expired(x)});
const alive=x=>!x.deleted&&!x.cancelled;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.jpg':'image/jpeg','.webp':'image/webp'};
// 真实客户端 IP：部署在网关后面时（默认 TRUST_PROXY=1）读 X-Forwarded-For 里最右边那个，也就是网关自己追加的、伪造不了的那个；直连部署时设 TRUST_PROXY=0
const clientIp=req=>{if(process.env.TRUST_PROXY!=='0'){const x=String(req.headers['x-forwarded-for']||'').split(',').map(v=>v.trim()).filter(Boolean);if(x.length)return x[x.length-1];const r=req.headers['x-real-ip'];if(r)return String(r).trim()}return req.socket.remoteAddress||''};
const str=(v,max)=>v==null?'':String(v).trim().slice(0,max);

// 每日备份：启动时和之后每小时检查一次，距上次备份满 24 小时就备份，保留最近 7 份
function backup(){try{
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

// 兜底：单个请求出错只记日志，不让整个进程退出
process.on('uncaughtException',e=>console.error('未捕获错误',e&&e.stack||e));process.on('unhandledRejection',e=>console.error('未处理的 Promise 错误',e&&e.stack||e));
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
        db.users[username]={pw:hash(String(password)),created:Date.now()};
      } else { // 两层锁定：同账号同 IP 15 分钟错 10 次只锁这个 IP；同账号所有 IP 合计错 50 次锁整个账号（以前在这个 IP 成功登录过的本人除外）
        const ip=clientIp(req),known=!!(db.users[username]&&(db.users[username].ips||[]).includes(ip));
        if(failCount(username+'@'+ip)>=10||(failCount(username)>=50&&!known)) return send(res,429,{error:'密码错误次数太多，请 15 分钟后再试'});
        if(!db.users[username]||!verify(String(password),db.users[username].pw)){addFail(username);addFail(username+'@'+ip);return send(res,401,{error:'用户名或密码错误'})} }
      if(p==="/api/login"&&banned(username)) return send(res,403,BANNED);
      if(p==="/api/login"&&!db.users[username].pw.startsWith("s1$"))db.users[username].pw=hash(String(password));
      {const uu=db.users[username],ip=clientIp(req); if(uu&&ip){uu.ips=[ip,...(uu.ips||[]).filter(x=>x!==ip)].slice(0,5)}}
      const token=crypto.randomBytes(16).toString('hex'); db.sessions[token]={user:username,exp:Date.now()+SESSION_MS}; persist();
      return send(res,200,{token,username,admin:isAdmin(username)});
    }
    if(p==="/api/logout"&&POST){delete db.sessions[tokenOf(req)];persist();return send(res,200,{ok:true})}
    if(p==='/api/me'){const n=userOf(req); return n?send(res,200,{username:n,admin:isAdmin(n),banned:banned(n)}):send(res,401,{error:'未登录'});}
    // POST /api/password {oldPassword,newPassword}  改密码，成功后其他设备的登录全部失效，当前 token 保留
    if(p==='/api/password'&&POST){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
      if(limited("auth:"+clientIp(req))) return send(res,429,{error:"操作太频繁，请一分钟后再试"});
      const {oldPassword,newPassword}=await body(req);
      if(!verify(String(oldPassword||''),db.users[n].pw)) return send(res,401,{error:'原密码错误'});
      if(String(newPassword||'').length<6) return send(res,400,{error:'新密码至少 6 位'});
      db.users[n].pw=hash(String(newPassword));
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
      const users=Object.entries(db.users).map(([k,v])=>({username:k,created:new Date(v.created).toISOString(),admin:isAdmin(k),banned:!!v.banned,bannedAt:v.bannedAt||null,banReason:v.banReason||'',activeSessions:online[k]||0}));
      const channels=Object.fromEntries(CHANNELS.map(c=>[c,db.messages[c].map(x=>({...out(x),...(x.deleted?{deletedText:db.deletedTexts[x.id]||'',originalText:db.deletedTexts[x.id]||''}:{})}))]));
      return send(res,200,{users,channels,announcements:db.announcements});
    }
    // GET /api/admin/users -> [{username,created,admin,banned,bannedAt,banReason,activeSessions,messages}]（messages=发过的消息数）
    // GET /api/admin/messages -> 全部消息（含已删除、已撤销），每条带 channel，已删除的带 originalText，按时间倒序
    if((p==='/api/admin/users'||p==='/api/admin/messages')&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能查看'});
      const all=CHANNELS.flatMap(c=>db.messages[c].map(x=>({...out(x,c),...(x.deleted?{originalText:db.deletedTexts[x.id]||'',deletedText:db.deletedTexts[x.id]||''}:{})})));
      if(p==='/api/admin/messages') return send(res,200,all.sort((a,b)=>b.id-a.id));
      const cnt={}; all.forEach(x=>cnt[x.user]=(cnt[x.user]||0)+1);
      const online={}; for(const v of Object.values(db.sessions)){const un=typeof v==='string'?v:(v.exp>Date.now()?v.user:null); if(un) online[un]=(online[un]||0)+1;}
      return send(res,200,Object.entries(db.users).map(([k,v])=>({username:k,created:new Date(v.created).toISOString(),admin:isAdmin(k),banned:!!v.banned,bannedAt:v.bannedAt||null,banReason:v.banReason||'',activeSessions:online[k]||0,messages:cnt[k]||0})));
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
      delete db.users[du]; persist();
      return send(res,200,{username:du,deleted:true,messages:msgs,cancelledTasks:cancelled,releasedTasks:released});
    }
    const bm=p.match(/^\/api\/admin\/users\/([^/]+)\/(ban|unban)$/);
    if(bm&&POST){ let bu; try{bu=decodeURIComponent(bm[1])}catch{return send(res,400,{error:'用户名格式不对'})}
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(!isAdmin(n)) return send(res,403,{error:'只有管理员能操作'});
      const t=db.users[bu]; if(!t) return send(res,404,{error:'用户不存在'}); if(isAdmin(bu)) return send(res,400,{error:'不能封禁管理员'});
      if(bm[2]==='ban'){const b=await body(req); t.banned=true; t.bannedAt=new Date().toISOString(); t.banReason=str(b.reason,100);}
      else {delete t.banned; delete t.bannedAt; delete t.banReason;}
      persist(); return send(res,200,{username:bu,banned:!!t.banned});
    }
    if(p==='/api/health') return send(res,200,{ok:true,uptime:Math.round(process.uptime())});
    if(p==='/api/channels') return send(res,200,CHANNELS.map(c=>({name:c,count:db.messages[c].filter(alive).length})));
    // 任务和消息操作：POST /api/channels/:ch/messages/:id/<claim|unclaim|complete|done|cancel|delete>
    const am2=p.match(/^\/api\/channels\/([^/]+)\/messages\/(\d+)\/(claim|unclaim|complete|done|cancel|delete)$/);
    if(am2&&POST){
      const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'}); if(banned(n)) return send(res,403,BANNED);
      const list=db.messages[am2[1]]; if(!list) return send(res,404,{error:'频道不存在'});
      const msg=list.find(x=>String(x.id)===am2[2]); if(!msg||msg.deleted) return send(res,404,{error:'消息不存在'});
      const act=am2[3],now=new Date().toISOString();
      if(act==='delete'){ // 管理员可删任何消息；普通用户可删自己没人接的消息
        if(!isAdmin(n)&&!(msg.user===n&&!msg.claimedBy)) return send(res,403,{error:'没有权限删除这条消息'});
        db.deletedTexts[msg.id]=msg.text;msg.deleted=true;msg.text='';msg.deletedBy=n;msg.deletedAt=now;
      } else {
        if(!msg.task) return send(res,404,{error:'任务不存在'});
        if(msg.cancelled) return send(res,409,{error:'任务已撤销'});
        if(act==='claim'){
          if(msg.user===n) return send(res,400,{error:'不能接自己发布的任务'});
          if(msg.claimedBy) return send(res,409,{error:'已被 '+msg.claimedBy+' 接单'});
          if(expired(msg)) return send(res,409,{error:'任务已过期'});
          msg.claimedBy=n;msg.claimedAt=now;
        } else if(act==='unclaim'){ // 接单人放弃，任务回到待接单
          if(msg.claimedBy!==n) return send(res,403,{error:'只有接单人能放弃接单'});
          if(msg.done) return send(res,409,{error:'任务已完成，不能放弃'});
          delete msg.claimedBy;delete msg.claimedAt;msg.unclaimedAt=now;
        } else if(act==='cancel'){ // 发布者撤销没人接的任务
          if(msg.user!==n) return send(res,403,{error:'只有发布者能撤销'});
          if(msg.claimedBy) return send(res,409,{error:'任务已被接单，不能撤销'});
          msg.cancelled=true;msg.cancelledAt=now;
        } else { // complete / done
          if(msg.user!==n) return send(res,403,{error:"只有发布者能确认完成"});
          if(!msg.claimedBy) return send(res,400,{error:"任务还没人接单"});
          if(msg.done) return send(res,409,{error:"任务已完成"});
          msg.done=true;msg.doneAt=now;
        }
      }
      msg.rev=nextRev(); persist(); return send(res,200,out(msg));
    }
    // GET /api/my/tasks  我的任务（需登录）-> {posted:[...], claimed:[...]}，每条带 channel，按时间倒序，不含已删除的
    if(p==="/api/my/tasks"&&GET){
      const n=userOf(req); if(!n) return send(res,401,{error:"请先登录"});
      const all=CHANNELS.flatMap(c=>db.messages[c].filter(x=>x.task&&!x.deleted).map(x=>out(x,c))).sort((a,b)=>b.id-a.id);
      return send(res,200,{posted:all.filter(x=>x.user===n),claimed:all.filter(x=>x.claimedBy===n&&!x.claimerDeleted)});
    }
    // GET /api/tasks?status=open|claimed|done|all&limit=10  跨频道任务；open=没人接、没撤销、没过期
    if(p==="/api/tasks"&&GET){
      const st=u.searchParams.get("status")||"open", lim=Math.min(+u.searchParams.get("limit")||10,100);
      let all=CHANNELS.flatMap(c=>db.messages[c].filter(x=>x.task&&alive(x)).map(x=>out(x,c)));
      if(st==="open") all=all.filter(x=>!x.claimedBy&&!x.expired); else if(st==="claimed") all=all.filter(x=>x.claimedBy&&!x.done); else if(st==="done") all=all.filter(x=>x.done);
      return send(res,200,all.sort((a,b)=>b.id-a.id).slice(0,lim));
    }
    // GET /api/channels/:name/messages?rev=<n>（或旧的 ?since=<id>）；POST 同路径 {text,task,reward,place,deadline}
    const m=p.match(/^\/api\/channels\/([^/]+)\/messages$/);
    if(m){
      const ch=m[1]; if(!db.messages[ch]) return send(res,404,{error:'频道不存在'});
      if(GET){
        // ?rev=<n> 返回 rev 大于 n 的消息（含新消息、状态变化、被删除的），响应头 X-Rev 是当前最大 rev
        const rv=u.searchParams.get('rev');
        if(rv!==null){const n=+rv||0;res.setHeader('X-Rev',String(db.rev||0));return send(res,200,db.messages[ch].filter(x=>(x.rev||0)>n).map(x=>out(x)));}
        const s=+u.searchParams.get('since')||0; return send(res,200,db.messages[ch].filter(x=>x.id>s).map(x=>out(x)));}
      if(POST){
        const n=userOf(req); if(!n) return send(res,401,{error:'请先登录'});
        if(banned(n)) return send(res,403,BANNED);
        if(limited("msg:"+n,10)) return send(res,429,{error:"发得太快了，请稍后再试"});
        const b=await body(req); if(typeof b.text!=='string'||!b.text.trim()) return send(res,400,{error:'消息不能为空'});
        for(const k of ['reward','place','deadline']) if(b[k]!=null&&typeof b[k]!=='string'&&typeof b[k]!=='number') return send(res,400,{error:k+' 格式不对'});
        const msg={id:newId(),user:n,text:String(b.text).slice(0,2000),task:!!b.task,time:new Date().toISOString()};
        if(isAdmin(n)) msg.official=true;
        if(msg.task){
          const reward=str(b.reward,20),place=str(b.place,50);
          if(reward) msg.reward=reward; if(place) msg.place=place;
          if(b.deadline){const t=Date.parse(b.deadline); if(isNaN(t)) return send(res,400,{error:'截止时间格式不对'}); if(t<=Date.now()) return send(res,400,{error:'截止时间要晚于现在'}); msg.deadline=new Date(t).toISOString();}
        }
        msg.rev=nextRev(); db.messages[ch].push(msg); persist(); return send(res,200,out(msg));
      }
    }
    return send(res,404,{error:'接口不存在'});
  }
  let f=path.join(ROOT,p==='/'?'index.html':p);
  if(!f.startsWith(ROOT)||f===DB||(DATA_DIR!==ROOT&&f.startsWith(DATA_DIR+path.sep))||/(server\.(js|log)|run\.sh|Dockerfile|README\.md|data\.json(\.tmp)?|\.env)$/.test(f)||/\/\./.test(p)||f.startsWith(path.join(ROOT,'old'))||f.startsWith(BAK)){res.writeHead(403);return res.end()}
  fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end('Not found')}
    res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});res.end(d)});
};
// 任何请求出错都返回 500，不会让请求一直挂着
http.createServer((req,res)=>handle(req,res).catch(e=>{console.error('请求出错',req.method,req.url,e&&e.stack||e);try{if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});res.end('{"error":"服务器出错了"}')}catch{}})).listen(PORT,()=>console.log('Aevon校园交流网运行在 http://localhost:'+PORT+(ADMINS.length?'，管理员：'+ADMINS.join(','):'')));
