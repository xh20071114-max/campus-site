// Manual development benchmark. Uses isolated data and loopback HTTP, never the production site.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {spawn}=require('node:child_process');
const {seed,root,sleep}=require('./helpers.cjs');
const entryArg=process.argv.find(x=>x.startsWith('--server=')),entry=entryArg?path.resolve(entryArg.slice(9)):path.join(root,'server.js');
async function measure(count,backupDue){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'aevon-perf-')),data=seed(),now=Date.now();
 data.rev=count;data.messages['校园跑']=Array.from({length:count},(_,i)=>({id:now*1000+i,user:'Alice',text:'x'.repeat(500),task:true,reward:'10元',time:new Date(now).toISOString(),rev:i+1}));
 const json=JSON.stringify(data);await fs.writeFile(path.join(dir,'data.json'),json);await fs.mkdir(path.join(dir,'backups'));
 for(let i=1;i<=7;i++){const file=path.join(dir,'backups','data-2000-01-0'+i+'.json');await fs.writeFile(file,json);if(backupDue)await fs.utimes(file,new Date('2000-01-01'),new Date('2000-01-01'))}
 const preload=path.join(dir,'telemetry.cjs');await fs.writeFile(preload,"const http=require('node:http'),listen=http.Server.prototype.listen;http.Server.prototype.listen=function(...args){if(typeof args[1]==='function')args.splice(1,0,'127.0.0.1');return listen.apply(this,args)};process.on('message',m=>{if(m==='memory')process.send({memory:process.memoryUsage(),maxRSS:process.resourceUsage().maxRSS})});");
 const child=spawn(process.execPath,['--require',preload,entry],{cwd:root,env:{...process.env,PORT:'0',BIND_HOST:'127.0.0.1',DATA_DIR:dir,ADMIN:'AevonEcho',ADMIN_PASSWORD:'',TRUST_PROXY:'0'},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 const memory=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(new Error('Telemetry timed out, process exit: '+child.exitCode))},3000),done=m=>{cleanup();resolve(m)},cleanup=()=>{clearTimeout(timer);child.removeListener('message',done)};child.once('message',done);child.send('memory',e=>{if(e){cleanup();reject(e)}})});
 try{
  let port;for(let i=0;i<200;i++){const m=logs.match(/localhost:(\d+)/);if(m){port=Number(m[1]);break}if(child.exitCode!==null)throw new Error(logs);await sleep(50)}if(!port)throw new Error('Server startup timed out: '+logs);
  const base='http://127.0.0.1:'+port;await fetch(base+'/api/health');const start=await memory(),times=[];
  for(let i=0;i<5;i++){const t=performance.now();const r=await fetch(base+'/api/tasks?limit=8');if(!r.ok)throw new Error('Task read failed');await r.json();times.push(performance.now()-t)}
  const writes=[];for(let i=0;i<5;i++){const began=performance.now(),write=await fetch(base+'/api/channels/'+encodeURIComponent('校园跑')+'/messages',{method:'POST',headers:{Authorization:'Bearer Alice','Content-Type':'application/json'},body:JSON.stringify({text:'measurement '+i,task:true})});if(!write.ok)throw new Error('Task write failed');await write.json();writes.push(performance.now()-began)}const end=await memory();
  return {count,dbMiB:Buffer.byteLength(json)/1048576,startRSSMiB:start.memory.rss/1048576,maxRSSMiB:end.maxRSS/1024,tasksMeanMs:times.reduce((a,b)=>a+b)/times.length,writeMeanMs:writes.reduce((a,b)=>a+b)/writes.length,writeMaxMs:Math.max(...writes)};
 }finally{
  if(child.exitCode===null){const ended=new Promise(r=>child.once('exit',r));child.kill();await ended}
  const resolved=path.resolve(dir);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('aevon-perf-'))throw new Error('Unexpected cleanup target');await fs.rm(resolved,{recursive:true,force:true});
 }
}
(async()=>{const backupDue=process.argv.includes('--backup-due'),results=[];for(const count of [1000,10000,30000])results.push(await measure(count,backupDue));console.log(JSON.stringify({runtime:process.version,platform:process.platform,entry,scenario:backupDue?'daily backup due':'seven recent valid backups',samplesPerOperation:5,note:'Synthetic local benchmark; not a container memory or capacity guarantee.',results},null,2))})().catch(e=>{console.error(e);process.exitCode=1});
