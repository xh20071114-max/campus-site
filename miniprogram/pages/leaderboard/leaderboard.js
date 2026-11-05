const api=require('../../utils/api');

const MAX_QR_SIZE=2*1024*1024;

function chooseQrImage(){
  return new Promise((resolve,reject)=>wx.chooseMedia({
    count:1,
    mediaType:['image'],
    sizeType:['compressed'],
    sourceType:['album','camera'],
    success:result=>resolve(result.tempFiles&&result.tempFiles[0]),
    fail:reject
  }));
}

function readImage(filePath){
  return new Promise((resolve,reject)=>wx.getFileSystemManager().readFile({
    filePath,
    success:result=>resolve(result.data),
    fail:()=>reject(new Error('读取收款码失败，请重试'))
  }));
}

Page({
  data:{live:null,locked:null,myRewards:[],error:'',uploading:false},
  onLoad(){
    this.sessionToken=wx.getStorageSync('token')||'';
    this.sessionUsername=wx.getStorageSync('username')||'';
  },
  onShow(){this.syncSession();this.load()},
  syncSession(){
    const token=wx.getStorageSync('token')||'',username=wx.getStorageSync('username')||'';
    const changed=token!==this.sessionToken||username!==this.sessionUsername;
    if(changed){
      this.sessionToken=token;
      this.sessionUsername=username;
      this.loadRequestId=(this.loadRequestId||0)+1;
      this.uploadRequestId=(this.uploadRequestId||0)+1;
      this.setData({myRewards:[],error:'',uploading:false});
    }
    return {token,username,changed};
  },
  sameSession(token,username){
    return token===(wx.getStorageSync('token')||'')&&username===(wx.getStorageSync('username')||'')&&token===this.sessionToken&&username===this.sessionUsername;
  },
  async load(){
    const {token,username}=this.syncSession(),requestId=(this.loadRequestId||0)+1;
    this.loadRequestId=requestId;
    const isCurrent=()=>requestId===this.loadRequestId&&this.sameSession(token,username);
    try{
      const options=token?{header:{Authorization:'Bearer '+token}}:{};
      const response=await api.request('/api/leaderboard',options);
      if(!isCurrent())return;
      const d=response.data||{};
      this.setData({live:d.live||null,locked:d.locked||null,myRewards:(d.myRewards||[]).filter(x=>!d.locked||x.key!==d.locked.key),error:''});
    }catch(e){
      if(!isCurrent())return;
      if(token&&api.handleAuthError(e)){this.syncSession();return}
      this.setData({error:e.message});
    }
  },
  async uploadQr(e){
    const session=this.syncSession();
    if(!api.requireLogin()||this.data.uploading)return;
    if(session.changed)return wx.showToast({title:'账号已切换，请刷新后重试',icon:'none'});
    const {token,username}=session;
    if(!this.sameSession(token,username))return wx.showToast({title:'登录状态已变化，请刷新后重试',icon:'none'});
    const period=e.currentTarget.dataset.period;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(period||''))return wx.showToast({title:'奖励期数无效，请刷新后重试',icon:'none'});
    const requestId=(this.uploadRequestId||0)+1;
    this.uploadRequestId=requestId;
    const isCurrent=()=>requestId===this.uploadRequestId&&this.sameSession(token,username);
    const stopIfStale=()=>{
      if(isCurrent())return false;
      this.syncSession();
      return true;
    };
    this.setData({uploading:true});
    try{
      const file=await chooseQrImage();
      if(stopIfStale())return;
      if(!file)throw new Error('没有选择收款码图片');
      if(Number.isFinite(file.size)&&file.size>MAX_QR_SIZE)throw new Error('图片不能超过 2MB');
      if(!file.tempFilePath)throw new Error('没有获取到所选收款码图片，请重试');
      const data=await readImage(file.tempFilePath);
      if(stopIfStale())return;
      const bytes=new Uint8Array(data);
      const png=bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
      const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!png&&!jpeg)throw new Error('只支持 PNG 或 JPEG 收款码图片');
      if(stopIfStale())return;
      await api.request('/api/my/weekly-reward/qr?period='+encodeURIComponent(period),{
        method:'POST',
        data,
        json:false,
        header:{Authorization:'Bearer '+token,'Content-Type':png?'image/png':'image/jpeg'}
      });
      if(stopIfStale())return;
      wx.showToast({title:'收款码已私密提交'});
      await this.load();
    }catch(err){
      if(stopIfStale())return;
      const detail=err&&err.errMsg||'';
      if(/cancel/i.test(detail))return;
      if(api.handleAuthError(err)){this.syncSession();return}
      wx.showToast({title:err.message||(detail?'选择图片失败，请检查权限后重试':'选择或提交图片失败，请重试'),icon:'none'});
    }finally{
      if(requestId===this.uploadRequestId)this.setData({uploading:false});
    }
  },
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())}
});
