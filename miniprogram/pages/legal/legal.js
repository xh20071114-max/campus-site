const api=require('../../utils/api');
Page({data:{contact:''},onShow(){api.get('/api/settings').then(x=>this.setData({contact:x.contactInfo||''})).catch(()=>{})}});
