Component({
  data:{visible:false},
  methods:{
    requestAuthorization(resolve){
      if(typeof this.pendingResolve==='function')this.pendingResolve({event:'disagree'});
      this.pendingResolve=resolve;
      this.setData({visible:true});
    },
    openContract(){
      wx.openPrivacyContract({fail:()=>wx.showToast({title:'暂时无法打开隐私指引',icon:'none'})});
    },
    agree(e){
      const resolve=this.pendingResolve;
      this.pendingResolve=null;
      this.setData({visible:false});
      if(resolve)resolve({event:'agree',buttonId:e&&e.detail&&e.detail.buttonId});
    },
    disagree(){
      const resolve=this.pendingResolve;
      this.pendingResolve=null;
      this.setData({visible:false});
      if(resolve)resolve({event:'disagree'});
    }
  },
  lifetimes:{
    detached(){
      const resolve=this.pendingResolve;
      this.pendingResolve=null;
      if(resolve)resolve({event:'disagree'});
    }
  }
});
