// Gestión de accesos por cartera. El servidor verifica la propiedad en cada cambio.
async function openAccessManager(){
 const owned=(state.portfolios||[]).filter(p=>p.user_id===session?.user?.id);
 if(!owned.length)return;
 document.getElementById('accessContents').textContent='Cargando accesos…';
 await renderAccessManager(owned);
}
async function renderAccessManager(owned=(state.portfolios||[]).filter(p=>p.user_id===session?.user?.id)){
 const container=document.getElementById('accessContents');if(!container)return;
 try{
  const viewers=await rpc('list_portfolio_viewers_v1',{});
  if(!document.getElementById('accessContents'))return;
  container.innerHTML=`<form id="viewerForm" class="auth-form" style="margin:12px 0"><label class="field">Cartera<select id="viewerPortfolio" class="search" required>${owned.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label><label class="field">Correo electrónico<input class="search" id="viewerEmail" type="email" autocomplete="email" placeholder="persona@ejemplo.com" required></label><button class="btn primary" type="submit">Invitar o conceder acceso</button></form><div class="muted" id="viewerStatus" role="status"></div><h3>Accesos concedidos</h3><div class="portfolio-list">${viewers.length?viewers.map(v=>`<div class="portfolio-row"><div><strong>${esc(v.email)}</strong><div class="muted">${esc(owned.find(p=>p.id===v.portfolio_id)?.name||'Cartera')}</div></div><button class="btn danger small" data-revoke-portfolio="${esc(v.portfolio_id)}" data-revoke-email="${esc(v.email)}">Quitar</button></div>`).join(''):'<div class="muted">Todavía no hay personas invitadas.</div>'}</div>`;
  document.getElementById('viewerForm').onsubmit=inviteViewer;
  container.querySelectorAll('[data-revoke-portfolio]').forEach(button=>button.onclick=()=>revokeViewer(button.dataset.revokePortfolio,button.dataset.revokeEmail));
 }catch(error){container.textContent='No se pudieron cargar los accesos: '+error.message}
}
async function inviteViewer(event){
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),email=document.getElementById('viewerEmail').value.trim(),portfolio_id=document.getElementById('viewerPortfolio').value,status=document.getElementById('viewerStatus');
 button.disabled=true;status.textContent='Preparando la invitación…';
 try{const result=await edge('invite-portfolio-viewer',{email,portfolio_id});status.textContent=result.invited?'Invitación enviada. La persona debe abrir el correo y elegir una contraseña.':'Acceso concedido a esta cuenta.';await renderAccessManager();const current=document.getElementById('viewerStatus');if(current)current.textContent=status.textContent}
 catch(error){status.textContent='No se pudo conceder acceso: '+error.message}
 finally{button.disabled=false}
}
async function revokeViewer(portfolio_id,email){
 if(!confirm(`¿Quitar a ${email} el acceso a esta cartera?`))return;
 try{await rpc('set_portfolio_viewer_v1',{p_portfolio_id:portfolio_id,p_email:email,p_enabled:false});await renderAccessManager()}
 catch(error){alert('No se pudo quitar el acceso: '+error.message)}
}
window.openAccessManager=openAccessManager;
