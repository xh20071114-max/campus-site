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
  onShow(){this.load()},
  async load(){
    try{
      const d=await api.get('/api/leaderboard');
      this.setData({live:d.live,locked:d.locked,myRewards:(d.myRewards||[]).filter(x=>!d.locked||x.key!==d.locked.key),error:''});
    }catch(e){this.setData({error:e.message})}
  },
  async uploadQr(e){
    if(!api.requireLogin()||this.data.uploading)return;
    const period=e.currentTarget.dataset.period;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(period||''))return wx.showToast({title:'奖励期数无效，请刷新后重试',icon:'none'});
    this.setData({uploading:true});
    try{
      const file=await chooseQrImage();
      if(!file)throw new Error('没有选择收款码图片');
      if(Number.isFinite(file.size)&&file.size>MAX_QR_SIZE)throw new Error('图片不能超过 2MB');
      if(!file.tempFilePath)throw new Error('没有获取到所选收款码图片，请重试');
      const data=await readImage(file.tempFilePath),bytes=new Uint8Array(data);
      const png=bytes.length>=8&&bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71&&bytes[4]===13&&bytes[5]===10&&bytes[6]===26&&bytes[7]===10;
      const jpeg=bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!png&&!jpeg)throw new Error('只支持 PNG 或 JPEG 收款码图片');
      await api.request('/api/my/weekly-reward/qr?period='+encodeURIComponent(period),{
        method:'POST',data,json:false,header:{'Content-Type':png?'image/png':'image/jpeg'}
      });
      wx.showToast({title:'收款码已私密提交'});
      await this.load();
    }catch(err){
      const detail=err&&err.errMsg||'';
      if(/cancel/i.test(detail))return;
      if(!api.handleAuthError(err))wx.showToast({title:err.message||(detail?'选择图片失败，请检查权限后重试':'选择或提交图片失败，请重试'),icon:'none'});
    }finally{this.setData({uploading:false})}
  },
  onPullDownRefresh(){this.load().finally(()=>wx.stopPullDownRefresh())}
});
