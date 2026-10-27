(() => {
  document.querySelector('.shell').hidden=true;
  const originalFetch=window.fetch.bind(window);let allowed=false,lastStatusCheck=0,statusRefresh=null;window.sirisCloud=false;
  function screen(message,canLogin=false){
    document.querySelector('.shell').hidden=true;
    let panel=document.getElementById('auth-screen');if(!panel){panel=document.createElement('main');panel.id='auth-screen';panel.className='auth-screen';document.body.append(panel);}
    panel.replaceChildren();const title=document.createElement('h1');title.textContent='Siris Residences';const text=document.createElement('p');text.textContent=message;panel.append(title,text);
    if(canLogin){const link=document.createElement('a');link.className='auth-login';link.href='/api/auth/login';link.textContent='Đăng nhập bằng Lark';panel.append(link);}
  }
  function loseSession(){
    allowed=false;window.dispatchEvent(new Event('siris:session-lost'));
    for(const selector of ['#rows','#payment-list','#repair-list','#purchase-list','#asset-list','#company-fund-list','#calendar-grid','#reviews-ota-list','#reviews-google-list'])document.querySelector(selector)?.replaceChildren();
    for(const form of document.forms){for(const input of form.querySelectorAll('input,textarea')){input.value='';if(input.type==='checkbox')input.checked=false;}}
    for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
    screen('Đăng nhập bằng tài khoản Lark để tiếp tục.',true);
  }
  const readStatus=()=>navigator.locks?navigator.locks.request('siris-lark-session',()=>originalFetch('/api/auth/status',{cache:'no-store'})):originalFetch('/api/auth/status',{cache:'no-store'});
  async function checkSession(){
    if(statusRefresh)return statusRefresh;
    statusRefresh=(async()=>{const response=await readStatus();const status=await response.json();lastStatusCheck=Date.now();if(!response.ok||!status.authenticated)loseSession();})();
    try{await statusRefresh;}finally{statusRefresh=null;}
  }
  window.sirisReady=(async()=>{
    let response;try{response=await readStatus();}catch{screen('Không kết nối được máy chủ. Vui lòng tải lại trang.');return;}
    if(response.status===404){allowed=true;document.querySelector('.shell').hidden=false;return;}
    lastStatusCheck=Date.now();const status=await response.json();window.sirisCloud=Boolean(status.cloud);
    if(!status.configured){screen('Web đang được thiết lập kết nối Lark. Vui lòng quay lại sau.');return;}
    if(!status.authenticated){screen('Đăng nhập bằng tài khoản Lark để sử dụng web.',true);return;}
    allowed=true;document.querySelector('.shell').hidden=false;
    const bar=document.createElement('div');bar.className='session-bar';const name=document.createElement('span');name.textContent=status.user.name;const logout=document.createElement('button');logout.type='button';logout.textContent='Đăng xuất';
    logout.addEventListener('click',async()=>{logout.disabled=true;try{const r=await originalFetch('/api/auth/logout',{method:'POST'});if(!r.ok)throw new Error();loseSession();}catch{logout.disabled=false;name.textContent='Chưa đăng xuất được. Vui lòng thử lại.';}});
    bar.append(name,logout);document.querySelector('.sidebar').append(bar);
    const sync=document.querySelector('#reviews-sync-status');if(sync)sync.hidden=true;
    document.querySelector('#ota-errors-filter')?.setAttribute('hidden','');
  })();
  window.fetch=async(input,init)=>{
    const url=new URL(typeof input==='string'?input:input.url,location.href);
    if(url.origin!==location.origin||!url.pathname.startsWith('/api/')||url.pathname.startsWith('/api/auth/'))return originalFetch(input,init);
    await window.sirisReady;
    if(window.sirisCloud&&allowed&&Date.now()-lastStatusCheck>60000)await checkSession();
    if(!allowed)return new Response(JSON.stringify({error:'Vui lòng đăng nhập bằng Lark.'}),{status:401,headers:{'Content-Type':'application/json'}});
    const result=await originalFetch(input,init);if(result.status===401&&window.sirisCloud)loseSession();return result;
  };
})();
