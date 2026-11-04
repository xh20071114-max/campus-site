const api=require('../../utils/api');
Page({
  data:{register:false,username:'',password:'',password2:'',error:'',busy:false,agreed:false,appealToken:'',banReason:'',adminContact:'',supportText:'',supportContact:'',appealSent:false,supportMessages:[]},
  onLoad(q){this.next=q.next||''},
  onUser(e){this.setData({username:e.detail.value})},
  onPassword(e){this.setData({password:e.detail.value})},
  onPassword2(e){this.setData({password2:e.detail.value})},
  onAgreement(e){this.setData({agreed:!!(e.detail.value||[]).length})},
  onSupportText(e){this.setData({supportText:e.detail.value})},
  onSupportContact(e){this.setData({supportContact:e.detail.value})},
  toggle(){this.setData({register:!this.data.register,error:'',appealToken:''})},
  openLegal(){wx.navigateTo({url:'/pages/legal/legal'})},
  async submit(){
    if(this.data.busy)return;
    if(!this.data.agreed)return this.setData({error:'请先阅读并同意用户协议与隐私说明'});
    const username=this.data.username.trim(),password=this.data.password;
    if(!username||!password)return this.setData({error:'请填写用户名和密码'});
    if(this.data.register&&password.length<6)return this.setData({error:'密码至少 6 位'});
    if(this.data.register&&password!==this.data.password2)return this.setData({error:'两次输入的密码不一致'});
    this.setData({busy:true,error:''});
    try{
      const d=await api.post(this.data.register?'/api/register':'/api/login',{username,password,...(this.data.register?{password2:this.data.password2}:{})});
      getApp().saveSession(d);wx.showToast({title:'登录成功',icon:'success'});
      setTimeout(()=>{if(this.next==='orders')wx.redirectTo({url:'/pages/orders/orders'});else if(getCurrentPages().length>1)wx.navigateBack({delta:1});else wx.switchTab({url:'/pages/index/index'})},350);
    }catch(e){
      if(e.statusCode===403&&e.body&&e.body.appealToken){this.setData({error:'该账号当前无法使用任务和交易功能。',appealToken:e.body.appealToken,banReason:e.body.reason||'',adminContact:e.body.contact||''});this.loadSupport(e.body.appealToken)}
      else this.setData({error:e.message});
    }finally{this.setData({busy:false})}
  },
  async submitAppeal(){
    if(!this.data.supportText.trim())return wx.showToast({title:'请填写申诉或留言内容',icon:'none'});
    try{
      await api.post('/api/support',{text:this.data.supportText.trim(),contact:this.data.supportContact.trim()},{header:{Authorization:'Bearer '+this.data.appealToken}});
      this.setData({appealSent:true,supportText:'',error:''});wx.showToast({title:'已发送给管理员'});this.loadSupport(this.data.appealToken);
    }catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  async loadSupport(token){
    try{const r=await api.request('/api/support',{header:{Authorization:'Bearer '+token}});this.setData({supportMessages:(r.data||[]).slice().reverse()})}
    catch(e){wx.showToast({title:e.message,icon:'none'})}
  },
  refreshSupport(){if(this.data.appealToken)this.loadSupport(this.data.appealToken)}
});
