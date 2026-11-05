const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const crypto=require('node:crypto'),http=require('node:http');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),ch='/api/channels/'+encodeURIComponent('校园跑')+'/messages';
const password='testpass',salt='regression',pw='s1$'+salt+'$'+crypto.scryptSync(password,salt,32).toString('hex');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function seed(){const users={},sessions={};for(const n of ['AevonEcho','Alice','Bob','Carol']){users[n]={id:'account-'+n,pw,points:100,created:Date.now()-86400000};sessions[n]={user:n,exp:Date.now()+86400000}}return {users,sessions,messages:{}}}
async function start(dir,options={}){
 const args=[];
 if(options.gateScryptCall||options.gateAllScrypt){const preload=path.join(dir,'gate-crypto.cjs'),started=path.join(dir,'crypto-started'),release=path.join(dir,'crypto-release');
  await fs.writeFile(preload,`const crypto=require('node:crypto'),fs=require('node:fs');const original=crypto.scrypt;let calls=0;crypto.scrypt=function(...args){const cb=args.pop(),count=++calls,gated=${options.gateAllScrypt?'true':'count==='+options.gateScryptCall};if(gated)fs.writeFileSync(${JSON.stringify(started)},String(count));return original.call(this,...args,(...result)=>{if(!gated)return cb(...result);const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);cb(...result)}},10)})};`);
  args.push('--require',preload);
 }
 if(options.clock){const preload=path.join(dir,'controlled-clock.cjs'),clock=path.join(dir,'clock');await fs.writeFile(clock,String(Date.now()));await fs.writeFile(preload,`const fs=require('node:fs');Date.now=()=>Number(fs.readFileSync(${JSON.stringify(clock)},'utf8'));`);args.push('--require',preload)}
 if(options.blockImageDeletion){const preload=path.join(dir,'block-image-delete.cjs');await fs.writeFile(preload,"const fs=require('node:fs');const original=fs.unlinkSync;fs.unlinkSync=function(file){if(String(file).split(require('node:path').sep).includes('uploads'))throw Object.assign(new Error('Injected image permission failure'),{code:'EACCES'});return original.apply(this,arguments)};");args.push('--require',preload)}
 if(options.partialImageWrite){const preload=path.join(dir,'partial-image-write.cjs');await fs.writeFile(preload,"const fs=require('node:fs');const original=fs.writeFileSync;fs.writeFileSync=function(file,data,...args){if(String(file).split(require('node:path').sep).includes('uploads')){original.call(this,file,data.subarray(0,Math.max(1,Math.floor(data.length/2))),...args);throw Object.assign(new Error('Injected image disk-full failure'),{code:'ENOSPC'})}return original.call(this,file,data,...args)};");args.push('--require',preload)}
 if(options.blockBackupWrite){const preload=path.join(dir,'block-backup-write.cjs');await fs.writeFile(preload,"const fs=require('node:fs');const original=fs.openSync;fs.openSync=function(file){if(String(file).split(require('node:path').sep).includes('backups')&&String(file).endsWith('.tmp'))throw Object.assign(new Error('Injected backup disk-full failure'),{code:'ENOSPC'});return original.apply(this,arguments)};");args.push('--require',preload)}
 if(options.blockSnapshotWrite){const preload=path.join(dir,'block-snapshot-write.cjs'),marker=path.join(dir,'fail-write');await fs.writeFile(preload,`const fs=require('node:fs');const original=fs.writeSync;let writes=0;fs.writeSync=function(){if(fs.existsSync(${JSON.stringify(marker)})&&++writes>=2)throw Object.assign(new Error('Injected partial snapshot failure'),{code:'EIO'});return original.apply(this,arguments)};`);args.push('--require',preload)}
 if(options.shortWrites){const preload=path.join(dir,'short-writes.cjs');await fs.writeFile(preload,"const fs=require('node:fs');const original=fs.writeSync;fs.writeSync=function(...args){if(Buffer.isBuffer(args[1])&&typeof args[3]==='number')args[3]=Math.min(args[3],17);return original.apply(this,args)};");args.push('--require',preload)}
 const cp=spawn(process.execPath,[...args,'server.js'],{cwd:root,env:{...process.env,PORT:'0',BIND_HOST:'127.0.0.1',DATA_DIR:dir,ADMIN:'AevonEcho',ADMIN_PASSWORD:'',ADMINS:'',TRUST_PROXY:'0',APP_COMMIT:options.appCommit||'',RELEASE_SHA:options.releaseSha||''},windowsHide:true});
 let logs='';cp.stdout.on('data',b=>logs+=b);cp.stderr.on('data',b=>logs+=b);
 let port;for(let i=0;i<100;i++){const m=logs.match(/localhost:(\d+)/);if(m){port=Number(m[1]);break}if(cp.exitCode!==null)break;await sleep(50)}
 if(!port){cp.kill();throw new Error('Server failed to start: '+logs)}
 return {base:'http://127.0.0.1:'+port,logs:()=>logs,stop:async()=>{if(cp.exitCode!==null)return;const stopped=new Promise(resolve=>cp.once('exit',resolve));cp.kill();await stopped}};
}
async function fixture(run,data=seed(),options={}){
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'aevon-regression-'));let server;
 try{await fs.writeFile(path.join(tmp,'data.json'),JSON.stringify(data));if(options.prepare)await options.prepare(tmp);try{server=await start(tmp,options)}catch(e){if(options.onStartFailure)await options.onStartFailure(tmp,e);throw e}
  const call=async(p,n='Alice',b)=>{const r=await fetch(server.base+p,{method:b===undefined?'GET':'POST',headers:{Authorization:'Bearer '+n,'Content-Type':'application/json'},...(b===undefined?{}:{body:JSON.stringify(b)})});return {status:r.status,data:await r.json()}};
  const task=async(n='Alice',extra={})=>{const r=await call(ch,n,{text:'Regression task',task:true,reward:'10元',...extra});assert.equal(r.status,200,JSON.stringify(r));return r.data};
  const act=(m,n,a,b={})=>call(ch+'/'+m.id+'/'+a,n,b);
  await run({call,task,act,tmp,base:server.base,restart:async()=>{await sleep(250);await server.stop();server=await start(tmp)},advanceTime:async ms=>{const f=path.join(tmp,'clock');await fs.writeFile(f,String(Number(await fs.readFile(f,'utf8'))+ms))},waitForCrypto:async()=>{for(let i=0;i<200;i++){try{await fs.access(path.join(tmp,'crypto-started'));return}catch{}await sleep(10)}throw new Error('Crypto gate was not reached')},releaseCrypto:()=>fs.writeFile(path.join(tmp,'crypto-release'),'release')});
 }finally{if(server)await server.stop();const resolved=path.resolve(tmp);assert.ok(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('aevon-regression-'));await fs.rm(resolved,{recursive:true,force:true})}
}
function pendingRequest(base,p,token,prefix){let resolve,reject;const response=new Promise((r,j)=>{resolve=r;reject=j});const req=http.request(base+p,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,data:JSON.parse(data)}))});req.on('error',reject);req.write(prefix);return {req,response}}


module.exports={fixture,seed,password,pendingRequest,sleep,root};
