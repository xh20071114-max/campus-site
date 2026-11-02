// 共用「💡 建议」浮动按钮。用法：<script src="feedback.js"></script>
// 页面里有 #fbSlot 时按钮放进去不浮动；也可调用 window.openFeedback() 打开弹窗。
// 可选 data-bottom="96" 调整离底部的距离（px），避免挡住页面底部的输入框。
(function(){
  if(window.__fbLoaded)return;window.__fbLoaded=1;
  var me=document.currentScript,bottom=(me&&me.dataset.bottom)||20;
  var API=function(){return window.API_BASE||''};
  var css=document.createElement('style');
  css.textContent='#fbBtn{position:fixed;right:18px;bottom:'+bottom+'px;z-index:50;background:#f59e0b;color:#fff;border:none;border-radius:22px;padding:9px 15px;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;font-family:inherit}#fbBtn:hover{background:#d97706}#fbBtn.inSlot{position:static;box-shadow:none;padding:5px 12px;font-size:13px;border-radius:14px;vertical-align:middle}'+
  '#fbMask{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}#fbMask.on{display:flex}'+
  '#fbBox{background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}'+
  '#fbBox h3{font-size:18px;margin:0 0 4px}#fbBox p{color:#6b7280;font-size:13px;margin:0 0 12px}'+
  '#fbBox textarea,#fbBox input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;font-family:inherit;margin-bottom:8px}#fbBox textarea{min-height:120px;resize:vertical}'+
  '#fbBox .r{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:4px}#fbBox small{color:#9ca3af}'+
  '#fbBox button{border:none;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:14px}#fbSend{background:#1e3a8a;color:#fff}#fbSend:disabled{background:#9ca3af;cursor:not-allowed}#fbClose{background:#f3f4f6}'+
  '#fbMsg{font-size:13px;min-height:18px;margin-top:8px}#fbBox a.go{display:inline-block;background:#1e3a8a;color:#fff;padding:9px 20px;border-radius:8px;text-decoration:none;margin-top:6px}';
  document.head.appendChild(css);
  var b=document.createElement('button');b.id='fbBtn';b.type='button';b.textContent='💡 建议';b.title='给管理员提建议';
  var m=document.createElement('div');m.id='fbMask';m.innerHTML='<div id="fbBox"></div>';
  var slot=document.getElementById('fbSlot');if(slot){b.className='inSlot';slot.appendChild(b)}else document.body.appendChild(b);document.body.appendChild(m);
  var box=m.firstChild;
  function close(){m.classList.remove('on')}
  m.addEventListener('click',function(e){if(e.target===m)close()});
  document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
  window.openFeedback=function(){b.onclick()};
  b.onclick=function(){
    var token=localStorage.getItem('token');
    if(!token){var next=encodeURIComponent(location.pathname.split('/').pop()||'index.html');
      box.innerHTML='<h3>💡 提建议</h3><p>登录后才能给管理员提建议。</p><div class="r"><a class="go" href="login.html?next='+next+'">去登录</a><button id="fbClose" type="button">关闭</button></div>';
      document.getElementById('fbClose').onclick=close;m.classList.add('on');return}
    box.innerHTML='<h3>💡 给管理员提建议</h3><p>建议只有管理员能看到，其他同学看不到。</p>'+
      '<textarea id="fbText" maxlength="1000" placeholder="你遇到的问题、希望加的功能、对网站的想法…（必填）"></textarea>'+
      '<input id="fbContact" maxlength="100" placeholder="联系方式（选填，方便管理员回复你）">'+
      '<div class="r"><small id="fbCnt">0 / 1000</small><span><button id="fbClose" type="button">取消</button> <button id="fbSend" type="button">发送给管理员</button></span></div><div id="fbMsg"></div>';
    var t=document.getElementById('fbText'),c=document.getElementById('fbContact'),s=document.getElementById('fbSend'),msg=document.getElementById('fbMsg');
    t.oninput=function(){document.getElementById('fbCnt').textContent=t.value.length+' / 1000'};
    document.getElementById('fbClose').onclick=close;
    s.onclick=function(){
      var text=t.value.trim();if(!text){msg.style.color='#b91c1c';msg.textContent='请先写下你的建议';t.focus();return}
      s.disabled=true;msg.textContent='';
      fetch(API()+'/api/feedback',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({text:text,contact:c.value.trim()})})
      .then(function(r){return r.json().catch(function(){return{}}).then(function(d){return{r:r,d:d}})})
      .then(function(x){
        if(x.r.ok){box.innerHTML='<h3>✅ 已发送</h3><p>谢谢你的建议，管理员会看到的。</p><div class="r"><span></span><button id="fbClose" type="button">关闭</button></div>';document.getElementById('fbClose').onclick=close;return}
        if(x.r.status===401){localStorage.removeItem('token');localStorage.removeItem('username');msg.style.color='#b91c1c';msg.textContent='登录已过期，请重新登录后再发';s.disabled=false;return}
        msg.style.color='#b91c1c';msg.textContent=x.r.status===429?'发得太频繁了，请一分钟后再试':(x.d.error||'发送失败，请稍后再试');s.disabled=false})
      .catch(function(){msg.style.color='#b91c1c';msg.textContent='服务暂未开通，暂时发不了';s.disabled=false});
    };
    m.classList.add('on');setTimeout(function(){t.focus()},50);
  };
})();
