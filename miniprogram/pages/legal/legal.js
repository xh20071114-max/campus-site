const api=require('../../utils/api');
Page({
  data:{contact:''},
  onShow(){api.get('/api/settings').then(x=>this.setData({contact:x.contactInfo||''})).catch(()=>{})},
  agreeAndReturn(){
    const pages=typeof getCurrentPages==='function'?getCurrentPages():[];
    const login=pages[pages.length-2];
    if(login&&login.data&&Object.prototype.hasOwnProperty.call(login.data,'agreed')&&typeof login.setData==='function')login.setData({agreed:true,error:''});
    wx.navigateBack({delta:1});
  }
});
