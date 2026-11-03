// 会话更换后重新载入页面，清除旧账号的 DOM、私聊、缓存与在途请求。
// 各页面在此脚本之后读取 token，账号切换不复用上一账号的页面状态。
(()=>{const initialToken=localStorage.getItem('token');
  const check=()=>{if(localStorage.getItem('token')!==initialToken)location.reload()};
  addEventListener('storage',e=>{if(e.key===null||e.key==='token')check()});
  addEventListener('pageshow',check);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});
})();
