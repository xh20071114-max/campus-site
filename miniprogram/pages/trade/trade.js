const api=require('../../utils/api');
const fmt=require('../../utils/format');

function decodeRouteValue(value){try{return decodeURIComponent(value)}catch{return null}}

Page({
  data:{id:'',channel:'',task:null,messages:[],username:'',draft:'',sending:false,error:'',statusText:'',inquiryMode:false,inquiryId:'',inquiryUser:'',threads:[],showThreads:false,canConsult:false,canViewInquiries:false,canOpenOrder:false,canComplete:false,canClaim:false,canCancel:false,canFinish:false,canPay:false,canReceive:false,canFreeDecision:false,canWithdrawFree:false,canUnclaim:false,canWrite:false},
  onLoad(q){
    this.loadedImages=new Set();
    this.unloaded=false;
    this.sessionToken=wx.getStorageSync('token')||'';
    this.sessionUsername=wx.getStorageSync('username')||'';
    const channel=q.channel?decodeRouteValue(q.channel):'';
    this.setData({id:q.id||'',channel:channel===null?'':channel,inquiryMode:q.inquiry==='1',inquiryId:q.inquiryId||'',username:wx.getStorageSync('username')||'',error:channel===null?'订单链接无效，请从任务列表重新打开':''});
    this.load();
  },
  onShow(){
    this.unloaded=false;
    this.load(true);
    if(!this.timer)this.timer=setInterval(()=>this.load(true),5000);
  },
  onHide(){if(this.timer){clearInterval(this.timer);this.timer=null}},
  onUnload(){this.unloaded=true;if(this.timer)clearInterval(this.timer)},
  sameSession(token,username){return !!token&&token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername&&username===this.data.username},
  staleAction(){wx.showToast({title:'账号已切换，请刷新订单后重试',icon:'none'});if(!this.unloaded)this.load(true)},
  clearExpiredSession(){
    this.sessionToken='';
    this.sessionUsername='';
    this.sendRequestId=(this.sendRequestId||0)+1;
    this.loadedImages=new Set();
    this.setData({task:null,messages:[],threads:[],showThreads:false,inquiryId:'',inquiryUser:'',username:'',draft:'',sending:false,error:'',statusText:'',canConsult:false,canViewInquiries:false,canOpenOrder:false,canComplete:false,canClaim:false,canCancel:false,canFinish:false,canPay:false,canReceive:false,canFreeDecision:false,canWithdrawFree:false,canUnclaim:false,canWrite:false});
  },
  handleActionAuthError(error){
    if(!api.handleAuthError(error))return false;
    this.clearExpiredSession();
    return true;
  },
  async publicTask(){
    if(!this.data.channel)throw new Error('缺少订单频道，请从任务列表重新打开');
    const rows=await api.get('/api/channels/'+encodeURIComponent(this.data.channel)+'/messages?before='+(Number(this.data.id)+1));
    const task=(rows||[]).find(x=>String(x.id)===String(this.data.id));
    if(!task)throw new Error('订单不存在或已结束');
    return task;
  },
  async load(silent){
    const token=wx.getStorageSync('token')||'',name=wx.getStorageSync('username')||'';
    if(token!==this.sessionToken||name!==this.sessionUsername){
      this.sessionToken=token;
      this.sessionUsername=name;
      this.loadedImages=new Set();
      this.sendRequestId=(this.sendRequestId||0)+1;
      this.setData({task:null,messages:[],threads:[],showThreads:false,inquiryId:'',inquiryUser:'',draft:'',sending:false,error:'',statusText:'',canConsult:false,canViewInquiries:false,canOpenOrder:false,canComplete:false,canClaim:false,canCancel:false,canFinish:false,canPay:false,canReceive:false,canFreeDecision:false,canWithdrawFree:false,canUnclaim:false,canWrite:false});
      if(this.loading)this.reloadAfterLoad=true;
    }
    if(this.loading)return;this.loading=true;
    try{
      let task,chat={task:{canWrite:false},messages:[]};
      const inquiryMode=this.data.inquiryMode;
      if(inquiryMode){
        chat=await api.get('/api/tasks/'+this.data.id+'/inquiries'+(this.data.inquiryId?'?inquiryId='+encodeURIComponent(this.data.inquiryId):''));
        task=chat.task;
      }else{
        try{task=await api.get('/api/tasks/'+this.data.id)}
        catch(e){if(e.statusCode===401||e.statusCode===403)task=await this.publicTask();else throw e}
      }
      if(this.unloaded||token!==(wx.getStorageSync('token')||'')||name!==(wx.getStorageSync('username')||''))return;
      const poster=task.user===name,claimer=task.claimedBy===name;
      if(inquiryMode&&claimer){
        this.setData({inquiryMode:false,inquiryId:'',inquiryUser:'',threads:[],showThreads:false,messages:[],draft:'',canWrite:false});
        this.loadedImages=new Set();this.reloadAfterLoad=true;return;
      }
      if(!inquiryMode&&(task.status!=='open'||poster))chat=await api.get('/api/tasks/'+this.data.id+'/chat');
      if(this.unloaded||token!==(wx.getStorageSync('token')||'')||name!==(wx.getStorageSync('username')||''))return;
      const old=new Map(this.data.messages.map(x=>[String(x.id),x]));
      const messages=(chat.messages||[]).map(x=>{
        const cached=old.get(String(x.id)),sameImage=cached&&cached.image===x.image;
        return {...x,timeText:fmt.date(x.time),localImage:sameImage?cached.localImage||'':'',imageStatus:x.image?(sameImage?cached.imageStatus||'loading':'loading'):''};
      });
      const threads=Array.isArray(chat.threads)?chat.threads.map(x=>({...x,preview:x.last&&x.last.text||'图片消息'})):[];
      this.setData({task,channel:task.channel||this.data.channel,statusText:fmt.status(task.status),messages,username:name,threads,showThreads:inquiryMode&&Array.isArray(chat.threads),
        inquiryId:inquiryMode?(chat.inquiryId||this.data.inquiryId):'',inquiryUser:inquiryMode?(chat.user||''):'',
        canConsult:!inquiryMode&&!poster&&(task.status==='open'||!!task.myInquiry),canViewInquiries:!inquiryMode&&poster,canOpenOrder:inquiryMode&&!!task.claimedBy&&(poster||claimer),
        canClaim:!inquiryMode&&task.status==='open'&&!poster,canCancel:!inquiryMode&&poster&&task.status==='open',
        canWrite:!!chat.task.canWrite,
        canComplete:!inquiryMode&&poster&&task.status==='claimed',canFinish:!inquiryMode&&claimer&&task.status==='claimed',canPay:!inquiryMode&&poster&&task.status==='finished',
        canReceive:!inquiryMode&&claimer&&task.status==='paid',canFreeDecision:!inquiryMode&&claimer&&task.status==='free_pending',
        canWithdrawFree:!inquiryMode&&poster&&task.status==='free_pending',canUnclaim:!inquiryMode&&claimer&&task.status==='claimed',error:''});
      this.loadImages(messages,token,name);
    }catch(e){
      if(this.unloaded||token!==(wx.getStorageSync('token')||'')||name!==(wx.getStorageSync('username')||''))return;
      if(this.handleActionAuthError(e))return;
      if(e.statusCode===403||e.statusCode===404)this.setData({task:null,messages:[],threads:[],showThreads:false,canWrite:false});
      if(!silent||e.statusCode===403||e.statusCode===404)this.setData({error:e.message});
    }
    finally{
      this.loading=false;
      if(!this.unloaded&&(this.reloadAfterLoad||(wx.getStorageSync('token')||'')!==this.sessionToken)){
        this.reloadAfterLoad=false;
        this.load(true);
      }
    }
  },
  inquiryUrl(inquiryId){return '/pages/trade/trade?id='+encodeURIComponent(this.data.id)+'&channel='+encodeURIComponent(this.data.channel)+'&inquiry=1'+(inquiryId?'&inquiryId='+encodeURIComponent(inquiryId):'')},
  openInquiry(){if(api.requireLogin())wx.navigateTo({url:this.inquiryUrl('')})},
  selectThread(e){if(api.requireLogin())wx.navigateTo({url:this.inquiryUrl(e.currentTarget.dataset.id)})},
  showInquiryThreads(){wx.redirectTo({url:this.inquiryUrl('')})},
  openOrderChat(){if(api.requireLogin())wx.redirectTo({url:'/pages/trade/trade?id='+encodeURIComponent(this.data.id)+'&channel='+encodeURIComponent(this.data.channel)})},
  chatPath(image){
    const root='/api/tasks/'+this.data.id;
    if(!this.data.inquiryMode)return root+(image?'/chat/image':'/chat');
    return root+(image?'/chat/image?inquiry=1'+(this.data.inquiryId?'&inquiryId='+encodeURIComponent(this.data.inquiryId):''):'/inquiries');
  },
  loadImages(messages,token,username){
    if(!this.loadedImages)this.loadedImages=new Set();
    const app=getApp(),session=token===undefined?(wx.getStorageSync('token')||''):token,sessionUser=username===undefined?(wx.getStorageSync('username')||''):username;
    messages.forEach(m=>{
      const id=String(m.id);
      if(!m.image||m.localImage||m.imageStatus==='failed'||this.loadedImages.has(id))return;
      this.loadedImages.add(id);
      const current=()=>!this.unloaded&&(wx.getStorageSync('token')||'')===session&&(wx.getStorageSync('username')||'')===sessionUser;
      wx.downloadFile({url:app.globalData.apiBase+m.image,header:{Authorization:'Bearer '+session},success:r=>{
        if(this.unloaded||(wx.getStorageSync('token')||'')!==session||(wx.getStorageSync('username')||'')!==sessionUser){this.loadedImages.delete(id);return}
        if(r.statusCode!==200||!r.tempFilePath)return this.markImageFailed(id);
        this.setImageState(id,{localImage:r.tempFilePath,imageStatus:'loaded'});
      },fail:()=>{if(current())this.markImageFailed(id)}});
    });
  },
  setImageState(id,values){
    if(this.unloaded)return;
    const next=this.data.messages.slice(),index=next.findIndex(x=>String(x.id)===String(id));
    if(index<0)return;
    next[index]=Object.assign({},next[index],values);
    this.setData({messages:next});
  },
  markImageFailed(id){
    if(this.loadedImages)this.loadedImages.delete(String(id));
    this.setImageState(id,{localImage:'',imageStatus:'failed'});
  },
  imageError(e){const m=this.data.messages.find(x=>String(x.id)===String(e.currentTarget.dataset.id));if(m&&m.localImage===e.currentTarget.dataset.src)this.markImageFailed(m.id)},
  retryImage(e){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    if(!this.sameSession(token,username)){this.staleAction();return}
    const id=String(e.currentTarget.dataset.id),message=this.data.messages.find(x=>String(x.id)===id);
    if(!message||!message.image||this.loadedImages&&this.loadedImages.has(id))return;
    this.setImageState(id,{imageStatus:'loading'});
    this.loadImages([{...message,imageStatus:'loading'}],token,username);
  },
  onDraft(e){this.setData({draft:e.detail.value})},
  async send(){
    if(this.data.sending||!this.data.draft.trim())return;
    if(!api.requireLogin())return;
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'',text=this.data.draft.trim();
    if(!this.data.canWrite)return wx.showToast({title:'当前订单不可发送消息',icon:'none'});
    if(!this.sameSession(token,username)){this.staleAction();return}
    const requestId=(this.sendRequestId||0)+1;this.sendRequestId=requestId;
    this.setData({sending:true});
    try{const sent=await api.post(this.chatPath(false),{text,...(this.data.inquiryMode&&this.data.inquiryId?{inquiryId:this.data.inquiryId}:{})},{header:{Authorization:'Bearer '+token}});if(!this.sameSession(token,username))return;this.setData({draft:'',...(this.data.inquiryMode&&sent.inquiryId?{inquiryId:sent.inquiryId}:{})});await this.load(true)}
    catch(e){if(!this.sameSession(token,username)){this.staleAction();return}if(this.handleActionAuthError(e))return;wx.showToast({title:e.message,icon:'none'})}
    finally{if(requestId===this.sendRequestId)this.setData({sending:false})}
  },
  chooseImage(){
    if(!this.data.canWrite)return wx.showToast({title:'当前订单不可发送消息',icon:'none'});
    if(!api.requireLogin())return;
    const sessionToken=wx.getStorageSync('token')||'',sessionUsername=wx.getStorageSync('username')||'';
    if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
    wx.chooseMedia({count:1,mediaType:['image'],sizeType:['compressed'],sourceType:['album','camera'],success:r=>{
      if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
      const file=r.tempFiles&&r.tempFiles[0];
      if(!file||!file.tempFilePath)return wx.showToast({title:'没有获取到所选图片，请重试',icon:'none'});
      if(file.size>300*1024)return wx.showToast({title:'图片不能超过 300KB，请选择压缩图',icon:'none'});
      wx.getFileSystemManager().readFile({filePath:file.tempFilePath,success:async x=>{
        if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
        const bytes=new Uint8Array(x.data),type=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes[0]===137&&bytes[1]===80?'image/png':'';
        if(!type)return wx.showToast({title:'只支持 JPEG 或 PNG 图片',icon:'none'});
        try{const sent=await api.request(this.chatPath(true),{method:'POST',data:x.data,json:false,header:{'Content-Type':type,Authorization:'Bearer '+sessionToken}});if(this.sameSession(sessionToken,sessionUsername)){if(this.data.inquiryMode&&sent.data&&sent.data.inquiryId)this.setData({inquiryId:sent.data.inquiryId});this.load(true)}}
        catch(e){if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}if(this.handleActionAuthError(e))return;wx.showToast({title:e.message,icon:'none'})}
      },fail:()=>wx.showToast({title:'读取图片失败',icon:'none'})});
    },fail:error=>{const detail=error&&error.errMsg||'';if(!/cancel/i.test(detail))wx.showToast({title:'选择图片失败，请检查权限后重试',icon:'none'})}});
  },
  previewImage(e){const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';if(!this.sameSession(token,username)){this.staleAction();return}const src=e.currentTarget.dataset.src;if(!src)return;wx.previewImage({current:src,urls:this.data.messages.filter(x=>x.localImage).map(x=>x.localImage),fail:()=>{this.imageError(e);wx.showToast({title:'图片预览失败，请点此重试',icon:'none'})}})},
  claim(){
    if(!api.requireLogin())return;
    const sessionToken=wx.getStorageSync('token')||'',sessionUsername=wx.getStorageSync('username')||'';
    if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
    api.get('/api/me').then(me=>{
      if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
      const cost=me.claimCost;if(typeof cost!=='number'||!Number.isFinite(cost)||typeof me.points!=='number'||!Number.isFinite(me.points))return wx.showToast({title:'接单规则暂不可用，请稍后重试',icon:'none'});
      if(me.points<cost)return wx.showModal({title:'积分不足',content:'接单需要 '+cost+' 积分，当前 '+me.points+' 积分。现在前往充值吗？',confirmText:'去充值',success:r=>{if(r.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});
      wx.showModal({title:'确认接单',content:cost===0?'本次接单免扣积分。确认后请按订单流程完成交易。':'接单将扣除 '+cost+' 积分，放弃接单不退还。确认继续吗？',success:async r=>{
        if(!r.confirm)return;
        if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
        try{await api.post('/api/channels/'+encodeURIComponent(this.data.channel)+'/messages/'+this.data.id+'/claim',{}, {header:{Authorization:'Bearer '+sessionToken}});if(!this.sameSession(sessionToken,sessionUsername))return;wx.showToast({title:'接单成功'});this.load()}
        catch(e){if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}if(e.statusCode===402)wx.showModal({title:'积分不足',content:e.message,confirmText:'去充值',success:x=>{if(x.confirm)wx.navigateTo({url:'/pages/recharge/recharge'})}});else if(this.handleActionAuthError(e))return;else wx.showToast({title:e.message,icon:'none'})}
      }});
    }).catch(e=>{if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}if(this.handleActionAuthError(e))return;wx.showToast({title:e.message,icon:'none'})});
  },
  act(e){
    const action=e.currentTarget.dataset.action;
    if(!api.requireLogin())return;
    const sessionToken=wx.getStorageSync('token')||'',sessionUsername=wx.getStorageSync('username')||'';
    if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
    const labels={finish:'确认已经完成任务？',paid:'请确认已收到交付，并完成线下付款后再标记。',received:'只有在收款账户核实实际到账后，才确认收款。',complete:'普通任务需接单人同意；纯积分任务将直接完成。确认继续吗？',acceptfree:'确认已收到成果，且同意无需付款？',declinefree:'确定不同意免付款申请？',withdrawfree:'确定撤回免付款申请？',unclaim:'放弃接单不会退还接单积分，确定继续？',cancel:'撤回未接单任务后，发布积分会按规则退还。确定继续？'};
    wx.showModal({title:'确认订单操作',content:labels[action]||'确认执行此操作？',success:async r=>{
      if(!r.confirm)return;
      if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}
      try{await api.post('/api/channels/'+encodeURIComponent(this.data.channel)+'/messages/'+this.data.id+'/'+action,{}, {header:{Authorization:'Bearer '+sessionToken}});if(!this.sameSession(sessionToken,sessionUsername))return;wx.showToast({title:'订单状态已更新'});this.load()}
      catch(err){if(!this.sameSession(sessionToken,sessionUsername)){this.staleAction();return}if(this.handleActionAuthError(err))return;wx.showToast({title:err.message,icon:'none'})}
    }});
  }
});
