// 共用「💡 建议」浮动按钮。用法：<script src="feedback.js"></script>
// 页面里有 #fbSlot 时按钮放进去不浮动；也可调用 window.openFeedback() 打开弹窗。
// 可选 data-bottom="96" 调整离底部的距离（px），避免挡住页面底部的输入框。
(function(){
  if(window.__fbLoaded)return;window.__fbLoaded=1;
  var me=document.currentScript,bottom=(me&&me.dataset.bottom)||20;
  var API=function(){return window.API_BASE||''};
  var css=document.createElement('style');
  css.textContent='#fbBtn{position:fixed;right:18px;bottom:'+bottom+'px;z-index:50;background:#f59e0b;color:#fff;border:none;border-radius:22px;padding:9px 15px;font-size:14px;box-shadow:0 4px 14px rgba(0,0,0,.18);cursor:pointer;font-family:inherit}#fbBtn:hover{background:#d97706}body.fbPad{padding-bottom:72px}@media(max-width:640px){#fbBtn:not(.inSlot){width:42px;height:42px;padding:0;border-radius:50%;font-size:18px;right:12px;opacity:.92}#fbBtn:not(.inSlot) .l{display:none}}#fbBtn.inSlot{position:static;box-shadow:none;padding:5px 12px;font-size:13px;border-radius:14px;vertical-align:middle}'+
  '#fbMask{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;z-index:60;padding:16px}#fbMask.on{display:flex}'+
  '#fbBox{background:#fff;border-radius:14px;padding:20px;width:100%;max-width:420px;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2937}'+
  '#fbBox h3{font-size:18px;margin:0 0 4px}#fbBox p{color:#6b7280;font-size:13px;margin:0 0 12px}'+
  '#fbBox textarea,#fbBox input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;font-family:inherit;margin-bottom:8px}#fbBox textarea{min-height:120px;resize:vertical}'+
  '#fbBox .r{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:4px}#fbBox small{color:#9ca3af}'+
  '#fbBox button{border:none;border-radius:8px;padding:9px 18px;cursor:pointer;font-size:14px}#fbSend{background:#1e3a8a;color:#fff}#fbSend:disabled{background:#9ca3af;cursor:not-allowed}#fbClose{background:#f3f4f6}'+
  '#fbMsg{font-size:13px;min-height:18px;margin-top:8px}#fbBox a.go{display:inline-block;background:#1e3a8a;color:#fff;padding:9px 20px;border-radius:8px;text-decoration:none;margin-top:6px}';
  document.head.appendChild(css);
  var b=document.createElement('button');b.id='fbBtn';b.type='button';b.innerHTML='💡<span class="l"> 建议</span>';b.setAttribute('aria-label','给管理员提建议');b.title='给管理员提建议';
  var m=document.createElement('div');m.id='fbMask';m.innerHTML='<div id="fbBox"></div>';
  var slot=document.getElementById('fbSlot');if(slot){b.className='inSlot';slot.appendChild(b)}else{document.body.appendChild(b);document.body.classList.add('fbPad')}document.body.appendChild(m);
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
      .catch(function(){msg.style.color='#b91c1c';msg.textContent='网络连接失败，请检查网络后重试';s.disabled=false});
    };
    m.classList.add('on');setTimeout(function(){t.focus()},50);
  };
})();

// 独立联系入口：普通登录或仅用于申诉的短期凭证均可使用。
(function(){
  var style=document.createElement('style');style.textContent='#supportBtn{position:fixed;right:18px;bottom:72px;z-index:49;background:#1e3a8a;color:white;border:0;border-radius:20px;padding:10px 14px;cursor:pointer;font:14px sans-serif}#supportBtn.inSlot{position:static;padding:5px 10px;margin-left:6px}#supportMask{position:fixed;inset:0;background:#0008;z-index:70;display:none;align-items:center;justify-content:center;padding:16px}#supportMask.on{display:flex}#supportBox{background:white;color:#1f2937;border-radius:14px;padding:18px;width:100%;max-width:520px;max-height:85vh;overflow:auto;font:14px/1.6 sans-serif}#supportBox textarea,#supportBox input{display:block;width:100%;box-sizing:border-box;margin:8px 0;padding:10px;border:1px solid #d1d5db;border-radius:8px;font:inherit}#supportBox button,#supportBox a{cursor:pointer;padding:8px 12px;border:0;border-radius:8px}#supportBox article{background:#f5f7fb;border-radius:8px;padding:10px;margin:10px 0;white-space:pre-wrap;overflow-wrap:anywhere}#supportBox small{color:#6b7280}';document.head.append(style);
  var button=document.createElement('button');button.id='supportBtn';button.type='button';button.textContent='联系管理员';var slot=document.getElementById('fbSlot');if(slot){button.className='inSlot';slot.append(button)}else document.body.append(button);
  var mask=document.createElement('div');mask.id='supportMask';mask.innerHTML='<section id="supportBox" role="dialog" aria-label="联系管理员" aria-modal="true"></section>';document.body.append(mask);var box=mask.firstChild,seq=0,currentToken=null;
  var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
  var close=function(){seq++;mask.classList.remove('on');box.replaceChildren();currentToken=null};mask.onclick=function(e){if(e.target===mask)close()};document.addEventListener('keydown',function(e){if(e.key==='Escape')close()});
  var request=async function(token,body){var r=await fetch((window.API_BASE||'')+'/api/support',{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})}),d=await r.json();if(!r.ok)throw new Error(d.error||'联系失败');return d};
  window.openSupport=async function(options){var token=options&&options.token||localStorage.getItem('token'),version=++seq;currentToken=token;mask.classList.add('on');box.innerHTML='<h3>联系管理员 / 封禁申诉</h3><p>正在加载…</p><button type="button" data-close>关闭</button>';box.querySelector('[data-close]').onclick=close;
    if(!token){box.innerHTML='<h3>联系管理员</h3><p>请先登录后留言。封禁账号可在登录页输入原账号密码，验证后点击“联系管理员 / 申诉”。</p><a href="login.html">前往登录</a> <button type="button" data-close>关闭</button>';box.querySelector('[data-close]').onclick=close;return}
    var history;try{history=await request(token)}catch(e){if(version!==seq)return;box.innerHTML='<h3>联系管理员</h3><p></p><a href="login.html">重新验证账号</a> <button type="button" data-close>关闭</button>';box.querySelector('p').textContent=e.message;box.querySelector('[data-close]').onclick=close;return}if(version!==seq)return;
    box.innerHTML='<h3>联系管理员 / 封禁申诉</h3><p>留言仅总管理员及获授权管理员可见。回复在此查看；此功能不会自动解封账号。</p><form id="supportForm"><textarea name="text" rows="4" maxlength="1000" placeholder="说明你的问题或申诉原因" required></textarea><input name="contact" maxlength="100" placeholder="联系方式（选填）"><button type="submit" style="background:#1e3a8a;color:white">发送留言</button> <button type="button" data-refresh>刷新回复</button> <button type="button" data-close>关闭</button><p role="status"></p></form><h4>我的留言与管理员回复</h4><div id="supportHistory"></div>';
    box.querySelector('[data-close]').onclick=close;box.querySelector('[data-refresh]').onclick=function(){window.openSupport({token:token,draft:box.querySelector('textarea').value,contact:box.querySelector('input').value})};var list=box.querySelector('#supportHistory');list.innerHTML=history.length?history.map(function(m){return '<article><small>'+esc(new Date(m.time).toLocaleString())+' · '+(m.read?'已读':'待查看')+'</small><p>'+esc(m.text)+'</p>'+m.replies.map(function(r){return '<p style="border-left:3px solid #1e3a8a;padding-left:8px"><b>管理员回复</b> <small>'+esc(new Date(r.time).toLocaleString())+'</small><br>'+esc(r.text)+'</p>'}).join('')+'</article>'}).join(''):'<p>还没有留言。</p>';
    var form=box.querySelector('form'),sending=false;form.elements.text.value=options&&options.draft||'';form.elements.contact.value=options&&options.contact||'';form.onsubmit=async function(e){e.preventDefault();if(version!==seq||sending)return;var send=form.querySelector('[type=submit]'),status=form.querySelector('[role=status]'),text=form.elements.text.value.trim();if(!text)return;sending=true;send.disabled=true;status.textContent='发送中…';try{await request(token,{text:text,contact:form.elements.contact.value.trim()});if(version!==seq)return;form.elements.text.value='';status.textContent='已发送。管理员回复后，可在此刷新查看。';var fresh=await request(token);if(version!==seq)return;list.innerHTML=fresh.map(function(m){return '<article><small>'+esc(new Date(m.time).toLocaleString())+'</small><p>'+esc(m.text)+'</p>'+m.replies.map(function(r){return '<p><b>管理员回复：</b>'+esc(r.text)+'</p>'}).join('')+'</article>'}).join('')}catch(err){if(version===seq)status.textContent=err.message}finally{sending=false;if(version===seq)send.disabled=false}};
  };
  button.onclick=function(){window.openSupport()};
})();
