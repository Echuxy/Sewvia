import { useState, useEffect, useRef, useCallback } from 'react'

// Safe localStorage wrapper — handles Edge Tracking Prevention blocking storage
const safeStorage = {
  get: (key) => { try { return localStorage.getItem(key); } catch { return null; } },
  set: (key, val) => { try { localStorage.setItem(key, val); } catch {} },
  remove: (key) => { try { localStorage.removeItem(key); } catch {} },
};


// ═══════════════════════════════════════════════════════════════════════════════
// SEWVIA v2.0 — AI Fashion Business Suite
// Landing · Multi-tenant Auth · Supabase · Paystack · 3D Prototype · AI Studio
// ═══════════════════════════════════════════════════════════════════════════════

const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_KEY = "YOUR_ANON_KEY";
const PAYSTACK_KEY = "pk_live_YOUR_PAYSTACK_KEY";
const CLAUDE_MODEL = "claude-sonnet-4-5";

// ── Supabase REST helpers ─────────────────────────────────────────────────────
const sb = {
  h:(e={})=>({ "Content-Type":"application/json", apikey:SUPABASE_KEY, ...e }),
  ah:(tk,e={})=>({ "Content-Type":"application/json", apikey:SUPABASE_KEY, Authorization:`Bearer ${tk}`, ...e }),
  async signUp(email,password,meta){const r=await fetch(`${SUPABASE_URL}/auth/v1/signup`,{method:"POST",headers:sb.h(),body:JSON.stringify({email,password,data:meta})});return r.json();},
  async signIn(email,password){const r=await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{method:"POST",headers:sb.h(),body:JSON.stringify({email,password})});return r.json();},
  async signOut(tk){await fetch(`${SUPABASE_URL}/auth/v1/logout`,{method:"POST",headers:sb.ah(tk)}).catch(()=>{});},
  async getProfile(tk){const r=await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*&limit=1`,{headers:sb.ah(tk)});const d=await r.json();return d[0]||null;},
  async list(tk,table,filter=""){const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*${filter}&order=created_at.desc`,{headers:sb.ah(tk)});return r.json();},
  async insert(tk,table,data){const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}`,{method:"POST",headers:sb.ah(tk,{Prefer:"return=representation"}),body:JSON.stringify(data)});const d=await r.json();return Array.isArray(d)?d[0]:d;},
  async update(tk,table,id,data){const r=await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"PATCH",headers:sb.ah(tk,{Prefer:"return=representation"}),body:JSON.stringify(data)});const d=await r.json();return Array.isArray(d)?d[0]:d;},
  async delete(tk,table,id){return fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`,{method:"DELETE",headers:sb.ah(tk)});},
  async insertWaitlist(email){const r=await fetch(`${SUPABASE_URL}/rest/v1/waitlist`,{method:"POST",headers:sb.h(),body:JSON.stringify({email,source:"landing"})});return r.status<300;},

  // ── Client portal helpers ──────────────────────────────────
  // Send magic link invite to a client email
  async sendMagicLink(email){
    const r=await fetch(`${SUPABASE_URL}/auth/v1/magiclink`,{method:"POST",headers:sb.h(),body:JSON.stringify({email,options:{emailRedirectTo:window.location.href}})});
    return r.ok;
  },
  // Look up a client_auth record by auth user id
  async getClientLink(tk,userId){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/client_auth?auth_user_id=eq.${userId}&select=*,clients(*)&limit=1`,{headers:sb.ah(tk)});
    const d=await r.json();return d[0]||null;
  },
  // Create client_auth link (tailor links a client record to an auth account)
  async createClientLink(tk,data){
    return sb.insert(tk,"client_auth",data);
  },
  // Fetch client's own orders (reads via client_id RLS policy)
  async clientOrders(tk,clientId){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/orders?client_id=eq.${clientId}&select=*&order=created_at.desc`,{headers:sb.ah(tk)});
    return r.json();
  },
  // Fetch client's own appointments
  async clientAppointments(tk,clientId){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/appointments?client_id=eq.${clientId}&select=*&order=date.asc`,{headers:sb.ah(tk)});
    return r.json();
  },
  // Fetch client's measurements
  async clientMeasurements(tk,clientId){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/measurements?client_id=eq.${clientId}&select=*&limit=1`,{headers:sb.ah(tk)});
    const d=await r.json();return d[0]||null;
  },
  // Messages thread
  async getMessages(tk,clientId){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/messages?client_id=eq.${clientId}&select=*&order=created_at.asc`,{headers:sb.ah(tk)});
    return r.json();
  },
  async sendMessage(tk,data){
    return sb.insert(tk,"messages",data);
  },
  // Pending invite lookup (before auth account is created)
  async getPendingInvite(clientId){
    const r=await fetch(`${SUPABASE_URL}/rest/v1/client_invites?client_id=eq.${clientId}&used=eq.false&select=*&limit=1`,{headers:sb.h()});
    const d=await r.json();return d[0]||null;
  },
  async markInviteUsed(inviteId){
    return fetch(`${SUPABASE_URL}/rest/v1/client_invites?id=eq.${inviteId}`,{method:"PATCH",headers:sb.h(),body:JSON.stringify({used:true})});
  },
};

async function callClaude(system,user){
  const r=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:CLAUDE_MODEL,max_tokens:8000,system,messages:[{role:"user",content:user}]})});
  if(!r.ok){const t=await r.text().catch(()=>"");throw new Error(`API ${r.status}: ${t.slice(0,200)}`);}
  const d=await r.json();
  if(d.error)throw new Error(d.error.message);
  const raw=d.content?.[0]?.text||"";
  if(!raw)throw new Error("Empty response");
  return raw;
}
function parseJSON(txt){
  const clean=txt.replace(/^```json\s*/,"").replace(/^```\s*/,"").replace(/```\s*$/,"").trim();
  const a=clean.indexOf("{"),b=clean.lastIndexOf("}");
  return JSON.parse(a>=0?clean.slice(a,b+1):clean);
}

const PLANS={
  free:{maxClients:3,maxOrders:5,ai:false,proto3d:false,inventory:false},
  needle:{maxClients:99999,maxOrders:99999,ai:false,proto3d:false,inventory:true},
  atelier:{maxClients:99999,maxOrders:99999,ai:true,proto3d:true,inventory:true},
  maison:{maxClients:99999,maxOrders:99999,ai:true,proto3d:true,inventory:true,multiStaff:true},
};

const STATUS_COLOR={Pending:"#c9a84c","In Progress":"#4c7ec9",Fitting:"#9c4cc9",Completed:"#4cc97e",Cancelled:"#c94c4c"};
const DRESS_TYPES=["Ankara / Aso-Oke Gown","Agbada & Senator","Kaftan","Ball Gown","A-Line Dress","Mermaid Gown","Wrap Dress","Shirt Dress","Jumpsuit / Palazzo","Pencil Skirt & Blouse","Wedding Gown","Cocktail Dress","Iro & Buba (Traditional)","Corporate Suit","Lace Evening Gown","Custom Design"];

const MEAS_SECTIONS=[
  {title:"Upper Body",icon:"◈",color:"#c9a84c",fields:[
    {key:"bust",label:"Bust / Chest",unit:"cm",hint:"Fullest part of chest"},
    {key:"waist",label:"Waist",unit:"cm",hint:"Narrowest part of torso"},
    {key:"shoulder",label:"Shoulder Width",unit:"cm",hint:"Shoulder to shoulder, across back"},
    {key:"chestWidth",label:"Chest Width",unit:"cm",hint:"Front, armhole to armhole"},
    {key:"backWidth",label:"Back Width",unit:"cm",hint:"Back, armhole to armhole"},
    {key:"neckCirc",label:"Neck Circumference",unit:"cm",hint:"Around base of neck"},
    {key:"armhole",label:"Armhole",unit:"cm",hint:"Around armhole opening"},
  ]},
  {title:"Arms & Sleeves",icon:"✦",color:"#4c7ec9",fields:[
    {key:"sleeveLength",label:"Sleeve Length",unit:"cm",hint:"Shoulder to wrist"},
    {key:"bicep",label:"Bicep",unit:"cm",hint:"Fullest part of upper arm"},
    {key:"elbow",label:"Elbow",unit:"cm",hint:"Around elbow, slightly bent"},
    {key:"wrist",label:"Wrist",unit:"cm",hint:"Around wrist bone"},
  ]},
  {title:"Lower Body",icon:"⧉",color:"#4cc97e",fields:[
    {key:"hips",label:"Hips",unit:"cm",hint:"Fullest part of hips"},
    {key:"seatCirc",label:"Seat / Bottom",unit:"cm",hint:"7–9 inches below waist"},
    {key:"thigh",label:"Thigh",unit:"cm",hint:"Fullest part of thigh"},
    {key:"knee",label:"Knee",unit:"cm",hint:"Around knee"},
    {key:"calf",label:"Calf",unit:"cm",hint:"Fullest part of calf"},
    {key:"ankle",label:"Ankle",unit:"cm",hint:"Around ankle bone"},
  ]},
  {title:"Lengths",icon:"◷",color:"#c94cc9",fields:[
    {key:"backLength",label:"Back Length",unit:"cm",hint:"Nape of neck to waist"},
    {key:"frontLength",label:"Front Length",unit:"cm",hint:"Shoulder to waist, front"},
    {key:"waistToHip",label:"Waist to Hip",unit:"cm",hint:"Waist to fullest hip"},
    {key:"waistToKnee",label:"Waist to Knee",unit:"cm",hint:"Waist down to knee"},
    {key:"waistToFloor",label:"Waist to Floor",unit:"cm",hint:"Waist to floor (no shoes)"},
    {key:"inseam",label:"Inseam",unit:"cm",hint:"Crotch to ankle (inside leg)"},
    {key:"outseam",label:"Outseam",unit:"cm",hint:"Waist to ankle (outside leg)"},
    {key:"crotchDepth",label:"Crotch Depth",unit:"cm",hint:"Waist to seat (seated)"},
  ]},
  {title:"Body Stats",icon:"◎",color:"#c97c4c",fields:[
    {key:"height",label:"Height",unit:"cm",hint:"Full standing height"},
    {key:"weight",label:"Weight",unit:"kg",hint:"Current body weight"},
    {key:"dressSize",label:"Dress Size",unit:"",hint:"e.g. UK 12, US 8"},
    {key:"braSize",label:"Bra Size",unit:"",hint:"e.g. 36B (optional)"},
  ]},
];
const ALL_MEAS=MEAS_SECTIONS.flatMap(s=>s.fields);

const C={
  gold:"#c9a84c",goldL:"#e8d9b0",goldD:"#8a6820",goldXL:"#f5ead0",
  bg:"#080704",bg2:"#0e0c08",bg3:"#15120c",bg4:"#1c1810",bg5:"#231f14",
  border:"#272014",borderL:"#352c1a",
  text:"#d8cdb5",textMuted:"#6e6450",textDim:"#3e3828",
  emerald:"#4cc97e",sapphire:"#4c7ec9",ruby:"#c94c4c",
};

// ═══════════════════════════════════════════════════════════════════════════════
// ROOT
// ═══════════════════════════════════════════════════════════════════════════════
function Sewvia(){
  const [view,setView]=useState("landing");
  const [auth,setAuth]=useState(null);
  const [loading,setLoading]=useState(true);
  const [clientRef,setClientRef]=useState(null);

  useEffect(()=>{
    const params=new URLSearchParams(window.location.search);
    const ref=params.get("ref"),tailor=params.get("tailor");
    if(ref&&tailor){setClientRef({clientId:ref,tailorId:tailor});setView("client-register");}
    try{
      const s=JSON.parse(safeStorage.get("sewvia_v2")||"null");
      if(s?.token&&s?.profile){setAuth(s);setView(s.profile?.role==="client"?"client-portal":"app");}
    }catch{}
    setLoading(false);
  },[]);

  const login=useCallback(async s=>{
    let role="tailor",clientData=null;
    try{const link=await sb.getClientLink(s.token,s.user?.id);if(link){role="client";clientData=link;}}catch{}
    const session={...s,profile:{...s.profile,role},clientData};
    safeStorage.set("sewvia_v2",JSON.stringify(session));
    setAuth(session);setView(role==="client"?"client-portal":"app");
  },[]);

  const logout=useCallback(async()=>{
    if(auth?.token)try{await sb.signOut(auth.token);}catch{}
    safeStorage.remove("sewvia_v2");setAuth(null);setView("landing");
  },[auth]);

  const updatePlan=useCallback(plan=>{
    const next={...auth,profile:{...auth.profile,plan}};
    safeStorage.set("sewvia_v2",JSON.stringify(next));setAuth(next);
  },[auth]);

  if(loading)return<Splash/>;
  if(view==="landing")return<LandingPage onSignUp={()=>setView("signup")} onSignIn={()=>setView("login")}/>;
  if(view==="login"||view==="signup")return<AuthScreen view={view} setView={setView} onLogin={login} onBack={()=>setView("landing")}/>;
  if(view==="client-register")return<ClientRegister clientRef={clientRef} onLogin={login} onBack={()=>setView("landing")}/>;
  if(view==="app"&&auth)return<AppShell auth={auth} onLogout={logout} onUpdatePlan={updatePlan}/>;
  if(view==="client-portal"&&auth)return<ClientPortal auth={auth} onLogout={logout}/>;
  return<Splash/>;
}

function Splash(){return<div style={{minHeight:"100vh",background:C.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Cormorant Garamond',Georgia,serif"}}><div style={{textAlign:"center"}}><div style={{fontSize:44,color:C.gold,marginBottom:14}}>✂</div><div style={{fontSize:18,letterSpacing:6,color:C.goldL,fontWeight:700}}>SEWVIA</div><div style={{fontSize:11,color:C.textMuted,letterSpacing:2,marginTop:6}}>Loading…</div></div></div>;}

// ═══════════════════════════════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════════════════════════════
function LandingPage({onSignUp,onSignIn}){
  const [email,setEmail]=useState("");
  const [waitDone,setWaitDone]=useState(false);
  const [waitLoading,setWaitLoading]=useState(false);

  const joinWaitlist=async()=>{if(!email.includes("@"))return;setWaitLoading(true);try{await sb.insertWaitlist(email);setWaitDone(true);}catch{}setWaitLoading(false);};

  const FEATURES=[
    {icon:"✂",title:"AI Pattern Cutting",desc:"Enter measurements, get a complete pattern guide — fabric quantities, piece dimensions, cutting sequence, tailoring tips — tailored to African and Western silhouettes.",color:C.gold},
    {icon:"👗",title:"AI Design Preview",desc:"Generate fashion illustrations with style briefs, colour palettes, fabric recommendations, and occasion suitability. Visualise before you cut.",color:C.sapphire},
    {icon:"🧊",title:"3D Prototype Studio",desc:"See your garment in interactive 3D. Switch fabrics, change colours, rotate the model — all before touching a needle.",color:C.emerald},
    {icon:"📐",title:"27-Point Measurements",desc:"Capture complete body measurements with step-by-step beginner guides, SVG body diagrams, and pro tips for every measurement.",color:"#c94cc9"},
    {icon:"⧉",title:"Order & Client Management",desc:"Track every garment from consultation to collection. Client profiles, order pipeline, status tracking, payment records.",color:"#c97c4c"},
    {icon:"◷",title:"Appointments & Inventory",desc:"Schedule fittings, consultations and pickups. Track fabrics, threads, notions with low-stock alerts and supplier records.",color:"#4cc9c9"},
  ];

  const TESTIMONIALS=[
    {name:"Adaeze Obi",role:"Bridal couturier, Enugu",text:"Sewvia replaced three different tools I was using. The AI pattern cutting alone saves me two hours on every new design."},
    {name:"Rasheeda Afolabi",role:"Fashion designer, Ibadan",text:"My clients love that I can show them a 3D preview before I start. I've doubled my conversion rate since I started using Sewvia."},
    {name:"Emeka Eze",role:"Men's tailor, Aba",text:"The measurement guides helped my apprentice learn faster than expected. I added 11 new clients in my first month."},
  ];

  const PRICING=[
    {id:"free",name:"Thread",price:0,tag:"FREE FOREVER",features:["3 clients","5 orders","Basic measurements","Appointments"],cta:"Start Free"},
    {id:"needle",name:"Needle",price:3500,annual:35000,tag:"STARTER",features:["Unlimited clients & orders","Full 27-point measurements","Inventory management","Appointment calendar"],cta:"Get Needle"},
    {id:"atelier",name:"Atelier",price:8500,annual:80000,tag:"PRO",popular:true,features:["Everything in Needle","AI pattern cutting","AI design preview","3D garment prototype","Priority support"],cta:"Get Atelier"},
    {id:"maison",name:"Maison",price:18000,tag:"STUDIO",features:["Everything in Atelier","Multi-staff logins","Branded client portal","API access","White-label option"],cta:"Contact Sales"},
  ];

  return(
    <div style={{fontFamily:"'Cormorant Garamond','Palatino Linotype',Georgia,serif",background:C.bg,color:C.text,minHeight:"100vh",overflowX:"hidden"}}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0}@keyframes fadeUp{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:translateY(0)}}@keyframes pulse2{0%,100%{opacity:.4;transform:scale(.95)}50%{opacity:1;transform:scale(1.05)}}.fu{animation:fadeUp .7s ease both}.d1{animation-delay:.1s}.d2{animation-delay:.2s}.d3{animation-delay:.3s}.hs:hover{transform:scale(1.015);transition:transform .2s}.btn-g:hover{background:${C.goldL}!important;color:${C.bg}!important}.btn-gh:hover{background:${C.gold}18!important;color:${C.goldL}!important}`}</style>

      {/* NAV */}
      <nav style={{position:"sticky",top:0,zIndex:100,background:C.bg+"ee",backdropFilter:"blur(12px)",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",padding:"13px 40px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}><span style={{fontSize:22,color:C.gold}}>✂</span><span style={{fontSize:15,letterSpacing:5,fontWeight:700,color:C.goldL}}>SEWVIA</span></div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-gh" onClick={onSignIn} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:7,padding:"8px 20px",color:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:13,transition:"all .2s"}}>Sign In</button>
          <button className="btn-g" onClick={onSignUp} style={{background:C.gold,border:"none",borderRadius:7,padding:"8px 22px",color:C.bg,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,transition:"all .2s"}}>Start Free →</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{minHeight:"92vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 32px 60px",textAlign:"center",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:"20%",left:"15%",width:400,height:400,borderRadius:"50%",background:`radial-gradient(circle,${C.gold}07 0%,transparent 70%)`,pointerEvents:"none"}}/>
        <div style={{position:"absolute",bottom:"20%",right:"15%",width:300,height:300,borderRadius:"50%",background:`radial-gradient(circle,${C.sapphire}07 0%,transparent 70%)`,pointerEvents:"none"}}/>

        <div className="fu" style={{display:"inline-flex",alignItems:"center",gap:8,background:C.gold+"12",border:`1px solid ${C.gold}33`,borderRadius:999,padding:"5px 16px",fontSize:11,letterSpacing:2,color:C.gold,marginBottom:28,textTransform:"uppercase"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:C.gold,animation:"pulse2 2s infinite"}}/>
          Africa's First AI Fashion Business Suite
        </div>

        <h1 className="fu d1" style={{fontSize:"clamp(36px,6vw,76px)",fontWeight:700,color:C.goldXL,lineHeight:1.08,marginBottom:20,letterSpacing:"-0.02em",maxWidth:800}}>
          Run your tailor<br/>business with AI
        </h1>

        <p className="fu d2" style={{fontSize:"clamp(14px,2vw,19px)",color:C.textMuted,maxWidth:560,lineHeight:1.75,marginBottom:36}}>
          Pattern cutting, 3D garment previews, client management, measurements, orders — all in one studio built for African fashion designers.
        </p>

        <div className="fu d3" style={{display:"flex",gap:10,flexWrap:"wrap",justifyContent:"center",marginBottom:56}}>
          <button className="btn-g" onClick={onSignUp} style={{background:C.gold,border:"none",borderRadius:9,padding:"14px 32px",color:C.bg,cursor:"pointer",fontFamily:"inherit",fontSize:15,fontWeight:700,transition:"all .2s"}}>Start Free — No Card Needed →</button>
          <button className="btn-gh" onClick={onSignIn} style={{background:"none",border:`1px solid ${C.borderL}`,borderRadius:9,padding:"14px 28px",color:C.text,cursor:"pointer",fontFamily:"inherit",fontSize:15,transition:"all .2s"}}>Sign In</button>
        </div>

        {/* Hero visual */}
        <div className="fu hs" style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:20,padding:32,maxWidth:680,width:"100%",boxShadow:`0 40px 100px rgba(0,0,0,.6),0 0 0 1px ${C.gold}11`}}>
          <svg viewBox="0 0 600 260" style={{width:"100%",maxWidth:600,display:"block",margin:"0 auto"}}>
            <defs>
              <linearGradient id="hg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#e8a03a"/><stop offset="100%" stopColor="#c9472b"/></linearGradient>
              <linearGradient id="hg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#4c7ec9"/><stop offset="100%" stopColor="#6b2c8a"/></linearGradient>
              <linearGradient id="hg3" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#2d8a4a"/><stop offset="100%" stopColor="#4cc97e"/></linearGradient>
            </defs>
            {/* Ankara Gown */}
            <g transform="translate(60,10)">
              <ellipse cx="60" cy="35" rx="14" ry="16" fill="#d4a574"/>
              <rect x="52" y="48" width="16" height="11" rx="3" fill="#d4a574"/>
              <path d="M38,58 Q30,75 32,110 L88,110 Q90,75 82,58 Q66,52 60,52 Q54,52 38,58Z" fill="url(#hg1)"/>
              <path d="M32,110 Q26,130 26,155 L94,155 Q94,130 88,110Z" fill="url(#hg1)" opacity=".9"/>
              <path d="M26,155 Q20,185 24,220 L96,220 Q100,185 94,155Z" fill="url(#hg1)" opacity=".8"/>
              <text x="60" y="238" textAnchor="middle" fill="#4e4538" fontSize="8" letterSpacing="1">ANKARA GOWN</text>
            </g>
            {/* Agbada */}
            <g transform="translate(210,10)">
              <ellipse cx="70" cy="35" rx="14" ry="16" fill="#d4a574"/>
              <rect x="62" y="48" width="16" height="11" rx="3" fill="#d4a574"/>
              <path d="M5,58 Q-10,90 -5,140 Q20,148 40,138 Q45,100 50,78Z" fill="url(#hg2)"/>
              <path d="M135,58 Q150,90 145,140 Q120,148 100,138 Q95,100 90,78Z" fill="url(#hg2)"/>
              <path d="M20,58 Q12,75 14,110 L126,110 Q128,75 120,58 Q100,50 70,50 Q40,50 20,58Z" fill="url(#hg2)" opacity=".85"/>
              <path d="M36,110 Q30,140 32,200 L108,200 Q110,140 104,110Z" fill="#f5f0e8" opacity=".9"/>
              <circle cx="70" cy="62" r="8" fill="none" stroke="#c9a84c" strokeWidth="2"/>
              <text x="70" y="238" textAnchor="middle" fill="#4e4538" fontSize="8" letterSpacing="1">AGBADA</text>
            </g>
            {/* Suit */}
            <g transform="translate(380,10)">
              <ellipse cx="70" cy="35" rx="14" ry="16" fill="#d4a574"/>
              <rect x="62" y="48" width="16" height="11" rx="3" fill="#d4a574"/>
              <path d="M38,58 Q30,75 32,115 L108,115 Q110,75 102,58 Q86,52 70,52 Q54,52 38,58Z" fill="url(#hg3)"/>
              <rect x="56" y="62" width="28" height="38" rx="2" fill="#fafafa" opacity=".9"/>
              <rect x="63" y="65" width="14" height="3" rx="1" fill="#c9a84c"/>
              <path d="M32,115 Q28,145 30,185 L56,185 Q54,165 54,145 L54,115Z" fill="url(#hg3)"/>
              <path d="M108,115 Q112,145 110,185 L84,185 Q86,165 86,145 L86,115Z" fill="url(#hg3)"/>
              <text x="70" y="238" textAnchor="middle" fill="#4e4538" fontSize="8" letterSpacing="1">CORPORATE SUIT</text>
            </g>
            <text x="300" y="254" textAnchor="middle" fill="#4e4538" fontSize="9" letterSpacing="3">3 OF 5 SILHOUETTES SHOWN · INTERACTIVE 3D IN APP</text>
          </svg>
        </div>
      </section>

      {/* FEATURES */}
      <section style={{padding:"100px 40px",maxWidth:1140,margin:"0 auto"}}>
        <div style={{textAlign:"center",marginBottom:60}}>
          <div style={{fontSize:10,letterSpacing:4,color:C.gold,textTransform:"uppercase",marginBottom:12}}>What's Inside</div>
          <h2 style={{fontSize:"clamp(28px,4vw,48px)",fontWeight:700,color:C.goldL}}>Everything a tailor needs</h2>
          <p style={{fontSize:15,color:C.textMuted,marginTop:12,maxWidth:480,margin:"12px auto 0"}}>No more switching between WhatsApp, notebooks, and Excel. Sewvia is one studio that covers it all.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:20}}>
          {FEATURES.map((f,i)=>(
            <div key={i} className="hs" style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:16,padding:"28px 24px",cursor:"default",transition:"all .25s"}}>
              <div style={{width:52,height:52,borderRadius:12,background:f.color+"18",border:`1px solid ${f.color}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:24,marginBottom:18}}>{f.icon}</div>
              <h3 style={{fontSize:17,fontWeight:700,color:C.goldL,marginBottom:9}}>{f.title}</h3>
              <p style={{fontSize:13,color:C.textMuted,lineHeight:1.75}}>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TESTIMONIALS */}
      <section style={{padding:"100px 40px",background:C.bg2,borderTop:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}>
        <div style={{maxWidth:1000,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:52}}>
            <div style={{fontSize:10,letterSpacing:4,color:C.gold,textTransform:"uppercase",marginBottom:10}}>From the Community</div>
            <h2 style={{fontSize:"clamp(24px,3.5vw,40px)",fontWeight:700,color:C.goldL}}>Tailors who use Sewvia</h2>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:20}}>
            {TESTIMONIALS.map((t,i)=>(
              <div key={i} style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:"24px 22px"}}>
                <div style={{fontSize:28,color:C.gold,marginBottom:14,opacity:.5}}>"</div>
                <p style={{fontSize:14,color:C.text,lineHeight:1.75,marginBottom:20,fontStyle:"italic"}}>{t.text}</p>
                <div style={{display:"flex",alignItems:"center",gap:12}}>
                  <div style={{width:36,height:36,borderRadius:"50%",background:C.gold+"22",border:`1px solid ${C.gold}44`,display:"flex",alignItems:"center",justifyContent:"center",color:C.gold,fontWeight:700,fontSize:14}}>{t.name[0]}</div>
                  <div><div style={{fontSize:13,color:C.goldL,fontWeight:600}}>{t.name}</div><div style={{fontSize:11,color:C.textMuted}}>{t.role}</div></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section style={{padding:"100px 40px",background:C.bg}}>
        <div style={{maxWidth:1100,margin:"0 auto"}}>
          <div style={{textAlign:"center",marginBottom:60}}>
            <div style={{fontSize:10,letterSpacing:4,color:C.gold,textTransform:"uppercase",marginBottom:12}}>Pricing</div>
            <h2 style={{fontSize:"clamp(24px,3.5vw,44px)",fontWeight:700,color:C.goldL}}>Start free. Scale as you grow.</h2>
            <p style={{fontSize:14,color:C.textMuted,marginTop:10}}>All plans include core features. Upgrade when you're ready for AI and 3D.</p>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:16}}>
            {PRICING.map(p=>(
              <div key={p.id} style={{background:C.bg3,border:`${p.popular?2:1}px solid ${p.popular?C.gold:C.border}`,borderRadius:16,padding:"28px 22px",display:"flex",flexDirection:"column",position:"relative"}}>
                {p.popular&&<div style={{position:"absolute",top:-13,left:"50%",transform:"translateX(-50%)",background:C.gold,color:C.bg,fontSize:9,fontWeight:700,letterSpacing:2,padding:"4px 14px",borderRadius:999,whiteSpace:"nowrap"}}>MOST POPULAR</div>}
                <div style={{fontSize:9,letterSpacing:3,color:C.textMuted,marginBottom:5,textTransform:"uppercase"}}>{p.tag}</div>
                <div style={{fontSize:20,fontWeight:700,color:C.goldL,marginBottom:5}}>{p.name}</div>
                <div style={{fontSize:27,fontWeight:700,color:C.gold,marginBottom:3}}>{p.price===0?"₦0":`₦${p.price.toLocaleString()}`}<span style={{fontSize:13,color:C.textMuted,fontWeight:400}}>{p.price===0?" / forever":" / month"}</span></div>
                {p.annual&&<div style={{fontSize:11,color:C.textMuted,marginBottom:18}}>₦{p.annual.toLocaleString()}/yr — save 2 months</div>}
                <ul style={{listStyle:"none",flex:1,display:"flex",flexDirection:"column",gap:8,marginBottom:22,marginTop:p.annual?0:18}}>
                  {p.features.map((f,i)=><li key={i} style={{fontSize:12.5,color:C.text,display:"flex",gap:8}}><span style={{color:C.gold,fontSize:9,marginTop:3}}>✦</span>{f}</li>)}
                </ul>
                <button className="btn-g" onClick={onSignUp} style={{width:"100%",background:p.popular?C.gold:"none",border:`1px solid ${p.popular?C.gold:C.borderL}`,borderRadius:8,padding:"11px",color:p.popular?C.bg:C.text,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,transition:"all .2s"}}>{p.cta}</button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* EMAIL CAPTURE */}
      <section style={{padding:"100px 40px",maxWidth:640,margin:"0 auto",textAlign:"center"}}>
        <div style={{fontSize:10,letterSpacing:4,color:C.gold,textTransform:"uppercase",marginBottom:16}}>Early Access</div>
        <h2 style={{fontSize:"clamp(24px,3.5vw,42px)",fontWeight:700,color:C.goldL,marginBottom:14}}>Join the waitlist</h2>
        <p style={{fontSize:14,color:C.textMuted,lineHeight:1.7,marginBottom:32}}>Get early access, free 30-day Atelier trial, and a spot in our founding tailor community.</p>
        {waitDone?(
          <div style={{background:C.emerald+"18",border:`1px solid ${C.emerald}44`,borderRadius:10,padding:"18px 24px",color:C.emerald,fontSize:15}}>✦ You're on the list! We'll be in touch soon.</div>
        ):(
          <div style={{display:"flex",gap:8,maxWidth:420,margin:"0 auto",flexWrap:"wrap",justifyContent:"center"}}>
            <input value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&joinWaitlist()} placeholder="your@email.com" type="email" style={{flex:1,minWidth:200,background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:8,padding:"12px 16px",color:C.text,fontFamily:"inherit",fontSize:14,outline:"none"}}/>
            <button className="btn-g" onClick={joinWaitlist} disabled={waitLoading} style={{background:C.gold,border:"none",borderRadius:8,padding:"12px 24px",color:C.bg,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,opacity:waitLoading?.6:1}}>{waitLoading?"…":"Join →"}</button>
          </div>
        )}
      </section>

      {/* FOOTER */}
      <footer style={{borderTop:`1px solid ${C.border}`,padding:"28px 40px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:18,color:C.gold}}>✂</span><span style={{fontSize:13,letterSpacing:4,color:C.textMuted}}>SEWVIA</span></div>
        <div style={{fontSize:12,color:C.textDim}}>© 2026 Sewvia Technologies Limited · Lagos, Nigeria</div>
        <div style={{display:"flex",gap:16}}>{["Privacy","Terms","Contact"].map(t=><span key={t} style={{fontSize:12,color:C.textMuted,cursor:"pointer"}}>{t}</span>)}</div>
      </footer>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function AuthScreen({view,setView,onLogin,onBack}){
  const isLogin=view==="login";
  const [form,setForm]=useState({name:"",businessName:"",email:"",password:""});
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);

  const set=k=>e=>setForm(f=>({...f,[k]:e.target.value}));

  const submit=async()=>{
    setErr("");setLoading(true);
    try{
      if(isLogin){
        const r=await sb.signIn(form.email,form.password);
        if(r.error)throw new Error(r.error.message||"Login failed");
        const profile=await sb.getProfile(r.access_token);
        onLogin({token:r.access_token,profile});
      } else {
        if(!form.name||!form.email||!form.password)throw new Error("Please fill all fields");
        if(form.password.length<6)throw new Error("Password must be at least 6 characters");
        const r=await sb.signUp(form.email,form.password,{full_name:form.name,business_name:form.businessName});
        if(r.error)throw new Error(r.error.message||"Signup failed");
        // Auto login after signup
        const lr=await sb.signIn(form.email,form.password);
        if(lr.error)throw new Error("Account created! Please sign in.");
        const profile=await sb.getProfile(lr.access_token);
        onLogin({token:lr.access_token,profile:{...profile,full_name:form.name,business_name:form.businessName}});
      }
    }catch(e){setErr(e.message);}
    setLoading(false);
  };

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Cormorant Garamond','Palatino Linotype',Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:420}}>
        {/* Header */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{fontSize:36,color:C.gold,marginBottom:10}}>✂</div>
          <div style={{fontSize:20,letterSpacing:5,fontWeight:700,color:C.goldL}}>SEWVIA</div>
          <div style={{fontSize:13,color:C.textMuted,marginTop:10}}>{isLogin?"Welcome back, designer":"Start your free tailor studio"}</div>
        </div>

        {/* Card */}
        <div style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:16,padding:"32px 28px"}}>
          {/* Toggle */}
          <div style={{display:"flex",background:C.bg4,borderRadius:8,padding:4,marginBottom:24}}>
            {["login","signup"].map(v=>(
              <button key={v} onClick={()=>setView(v)} style={{flex:1,padding:"9px 0",borderRadius:6,border:"none",background:view===v?C.gold:"none",color:view===v?C.bg:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,transition:"all .2s"}}>{v==="login"?"Sign In":"Create Account"}</button>
            ))}
          </div>

          {/* Fields */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {!isLogin&&<Field label="Your Name" value={form.name} onChange={set("name")} placeholder="Ada Obi"/>}
            {!isLogin&&<Field label="Business Name (optional)" value={form.businessName} onChange={set("businessName")} placeholder="Ada Couture"/>}
            <Field label="Email" value={form.email} onChange={set("email")} placeholder="you@example.com" type="email"/>
            <Field label="Password" value={form.password} onChange={set("password")} placeholder="At least 6 characters" type="password"/>
          </div>

          {err&&<div style={{marginTop:14,padding:"10px 14px",background:C.ruby+"18",border:`1px solid ${C.ruby}44`,borderRadius:7,color:C.ruby,fontSize:12}}>{err}</div>}

          <button onClick={submit} disabled={loading} style={{marginTop:20,width:"100%",padding:"13px",background:C.gold,border:"none",borderRadius:8,color:C.bg,cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:700,opacity:loading?.6:1,transition:"all .2s"}}>
            {loading?"…":isLogin?"Sign In →":"Create Free Account →"}
          </button>

          {!isLogin&&<p style={{textAlign:"center",fontSize:11,color:C.textMuted,marginTop:16,lineHeight:1.6}}>By creating an account you agree to our Terms of Service and Privacy Policy. Your first 3 clients and 5 orders are always free.</p>}
        </div>

        <button onClick={onBack} style={{display:"block",margin:"16px auto 0",background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:13}}>← Back to Sewvia</button>
      </div>
    </div>
  );
}

function Field({label,value,onChange,placeholder,type="text"}){
  const [focused,setFocused]=useState(false);
  return(
    <div>
      <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>{label}</label>
      <input value={value} onChange={onChange} placeholder={placeholder} type={type} onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
        style={{width:"100%",background:C.bg4,border:`1px solid ${focused?C.gold:C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:14,outline:"none",transition:"border-color .2s"}}/>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APP SHELL
// ═══════════════════════════════════════════════════════════════════════════════
const PAGES=[
  {id:"dashboard",icon:"◈",label:"Command Centre"},
  {id:"clients",icon:"⧈",label:"Clients"},
  {id:"orders",icon:"◷",label:"Orders"},
  {id:"appointments",icon:"◎",label:"Appointments"},
  {id:"inventory",icon:"⊞",label:"Inventory"},
  {id:"measurements",icon:"📐",label:"Measurements"},
  {id:"pattern",icon:"✂",label:"AI Pattern"},
  {id:"preview",icon:"👗",label:"AI Design"},
  {id:"proto3d",icon:"🧊",label:"3D Studio"},
  {id:"billing",icon:"✦",label:"Plans & Billing"},
];

function AppShell({auth,onLogout,onUpdatePlan}){
  const [page,setPage]=useState("dashboard");
  const [sideOpen,setSideOpen]=useState(true);
  const plan=auth?.profile?.plan||"free";
  const limits=PLANS[plan]||PLANS.free;

  const navTo=p=>setPage(p);
  const pageProps={auth,plan,limits,navTo,onUpdatePlan};

  return(
    <div style={{display:"flex",minHeight:"100vh",background:C.bg,fontFamily:"'Cormorant Garamond','Palatino Linotype',Georgia,serif",color:C.text}}>
      {/* Sidebar */}
      <nav style={{width:sideOpen?220:64,transition:"width .25s",background:C.bg2,borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",flexShrink:0,position:"sticky",top:0,height:"100vh",overflowY:"auto",overflowX:"hidden"}}>
        {/* Logo row */}
        <div style={{padding:"18px 16px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          {sideOpen&&<div style={{display:"flex",alignItems:"center",gap:8}}><span style={{color:C.gold,fontSize:16}}>✂</span><span style={{fontSize:12,letterSpacing:4,fontWeight:700,color:C.goldL}}>SEWVIA</span></div>}
          <button onClick={()=>setSideOpen(o=>!o)} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:16,padding:4,flexShrink:0}}>☰</button>
        </div>

        {/* Plan badge */}
        {sideOpen&&<div style={{margin:"12px 12px 4px",padding:"6px 12px",background:C.gold+"18",border:`1px solid ${C.gold}33`,borderRadius:6,fontSize:10,letterSpacing:2,color:C.gold,textTransform:"uppercase",textAlign:"center"}}>{plan.toUpperCase()}</div>}

        {/* Nav items */}
        <div style={{flex:1,padding:"8px 0"}}>
          {PAGES.map(p=>{
            const locked=((p.id==="pattern"||p.id==="preview"||p.id==="proto3d")&&!limits.ai&&!limits.proto3d)||
                         (p.id==="inventory"&&!limits.inventory);
            return(
              <button key={p.id} onClick={()=>navTo(p.id)} title={p.label}
                style={{width:"100%",display:"flex",alignItems:"center",gap:12,padding:"10px 16px",background:page===p.id?C.gold+"18":"none",border:"none",borderLeft:`2px solid ${page===p.id?C.gold:"transparent"}`,color:page===p.id?C.gold:locked?C.textDim:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:13,textAlign:"left",transition:"all .15s",whiteSpace:"nowrap",overflow:"hidden"}}>
                <span style={{fontSize:15,flexShrink:0}}>{p.icon}</span>
                {sideOpen&&<><span style={{flex:1}}>{p.label}</span>{locked&&<span style={{fontSize:9,color:C.textDim}}>🔒</span>}</>}
              </button>
            );
          })}
        </div>

        {/* User / logout */}
        {sideOpen&&(
          <div style={{padding:"12px 16px",borderTop:`1px solid ${C.border}`}}>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:4,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{auth?.profile?.full_name||auth?.profile?.email||"Tailor"}</div>
            <button onClick={onLogout} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:11,padding:0,letterSpacing:1}}>Sign out →</button>
          </div>
        )}
      </nav>

      {/* Main content */}
      <main style={{flex:1,overflowY:"auto",minHeight:"100vh"}}>
        {page==="dashboard"&&<Dashboard {...pageProps}/>}
        {page==="clients"&&<Clients {...pageProps}/>}
        {page==="orders"&&<Orders {...pageProps}/>}
        {page==="appointments"&&<Appointments {...pageProps}/>}
        {page==="inventory"&&<InventoryPage {...pageProps}/>}
        {page==="measurements"&&<MeasurementsPage {...pageProps}/>}
        {page==="pattern"&&<PatternPage {...pageProps}/>}
        {page==="preview"&&<DesignPreviewPage {...pageProps}/>}
        {page==="proto3d"&&<Proto3DPage {...pageProps}/>}
        {page==="billing"&&<BillingPage {...pageProps}/>}
      </main>
    </div>
  );
}

// ── Shared primitives ─────────────────────────────────────────────────────────
function PageWrap({title,subtitle,action,children}){
  return(
    <div style={{padding:"28px 32px",maxWidth:1200,margin:"0 auto"}}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:28,gap:12,flexWrap:"wrap"}}>
        <div>
          <h1 style={{fontSize:26,fontWeight:700,color:C.goldL,letterSpacing:"-0.01em"}}>{title}</h1>
          {subtitle&&<p style={{fontSize:13,color:C.textMuted,marginTop:4}}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function KPI({label,value,icon,color=C.gold}){
  return(
    <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px 20px",display:"flex",alignItems:"center",gap:14}}>
      <div style={{width:40,height:40,borderRadius:10,background:color+"18",border:`1px solid ${color}33`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{icon}</div>
      <div><div style={{fontSize:11,color:C.textMuted,letterSpacing:1.5,textTransform:"uppercase"}}>{label}</div><div style={{fontSize:22,fontWeight:700,color:C.goldL,marginTop:2}}>{value}</div></div>
    </div>
  );
}

function Btn({onClick,children,variant="primary",small,disabled}){
  const bg=variant==="primary"?C.gold:variant==="danger"?C.ruby:"none";
  const tc=variant==="ghost"?C.text:C.bg;
  const bd=variant==="ghost"?`1px solid ${C.borderL}`:"none";
  return(
    <button onClick={onClick} disabled={disabled}
      style={{background:bg,border:bd,borderRadius:7,padding:small?"7px 14px":"10px 20px",color:tc,cursor:"pointer",fontFamily:"inherit",fontSize:small?12:13,fontWeight:700,opacity:disabled?.5:1,transition:"all .15s",whiteSpace:"nowrap"}}>
      {children}
    </button>
  );
}

function Modal({open,onClose,title,children,wide}){
  if(!open)return null;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}} onClick={e=>{if(e.target===e.currentTarget)onClose();}}>
      <div style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:16,padding:28,width:"100%",maxWidth:wide?700:480,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h2 style={{fontSize:18,fontWeight:700,color:C.goldL}}>{title}</h2>
          <button onClick={onClose} style={{background:"none",border:"none",color:C.textMuted,cursor:"pointer",fontSize:20,lineHeight:1}}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({status}){
  const color=STATUS_COLOR[status]||C.textMuted;
  return<span style={{fontSize:10,fontWeight:700,letterSpacing:1,color,background:color+"22",border:`1px solid ${color}44`,borderRadius:4,padding:"2px 8px",whiteSpace:"nowrap"}}>{status}</span>;
}

function LockGate({feature,plan,navTo,children}){
  if(feature==="ai"&&!PLANS[plan]?.ai){
    return(
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:400,gap:16,padding:40}}>
        <div style={{fontSize:48}}>🔒</div>
        <h2 style={{color:C.goldL,fontSize:20,fontWeight:700}}>Atelier Plan Required</h2>
        <p style={{color:C.textMuted,fontSize:14,textAlign:"center",maxWidth:360,lineHeight:1.7}}>AI features are available on the Atelier and Maison plans. Upgrade to unlock AI pattern cutting, design previews, and 3D prototyping.</p>
        <Btn onClick={()=>navTo("billing")}>Upgrade Now →</Btn>
      </div>
    );
  }
  return children;
}


// ═══════════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function Dashboard({auth,plan,navTo}){
  const [stats,setStats]=useState({clients:0,orders:0,revenue:0,appointments:0});
  const [recent,setRecent]=useState([]);
  const [upcomingAppts,setUpcomingAppts]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    (async()=>{
      try{
        const [clients,orders,appts]=await Promise.all([
          sb.list(auth.token,"clients","&select=id"),
          sb.list(auth.token,"orders","&select=id,status,total_amount,created_at,clients(full_name)"),
          sb.list(auth.token,"appointments","&select=id,date,time,type,clients(full_name)&order=date.asc"),
        ]);
        const revenue=(orders||[]).filter(o=>o.status==="Completed").reduce((s,o)=>s+(parseFloat(o.total_amount)||0),0);
        setStats({clients:(clients||[]).length,orders:(orders||[]).length,revenue,appointments:(appts||[]).length});
        setRecent((orders||[]).slice(0,5));
        const today=new Date().toISOString().slice(0,10);
        setUpcomingAppts((appts||[]).filter(a=>a.date>=today).slice(0,4));
      }catch{}
      setLoading(false);
    })();
  },[auth.token]);

  if(loading)return<Spinner/>;

  const name=auth?.profile?.full_name?.split(" ")[0]||"Designer";

  return(
    <PageWrap title={`Welcome back, ${name} ✦`} subtitle={`Your studio overview · ${new Date().toLocaleDateString("en-NG",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}`}>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:14,marginBottom:24}}>
        <KPI label="Total Clients" value={stats.clients} icon="⧈" color={C.sapphire}/>
        <KPI label="Active Orders" value={stats.orders} icon="◷" color={C.gold}/>
        <KPI label="Revenue Earned" value={`₦${stats.revenue.toLocaleString()}`} icon="✦" color={C.emerald}/>
        <KPI label="Appointments" value={stats.appointments} icon="◎" color="#c94cc9"/>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 340px",gap:16,flexWrap:"wrap"}}>
        {/* Recent orders */}
        <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:700,color:C.goldL}}>Recent Orders</h3>
            <Btn variant="ghost" small onClick={()=>navTo("orders")}>View all</Btn>
          </div>
          {recent.length===0?<Empty text="No orders yet"/>:(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {recent.map(o=>(
                <div key={o.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:C.bg4,borderRadius:8}}>
                  <div>
                    <div style={{fontSize:13,color:C.text}}>{o.clients?.full_name||"Unknown client"}</div>
                    <div style={{fontSize:11,color:C.textMuted}}>{new Date(o.created_at).toLocaleDateString()}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {o.total_amount&&<span style={{fontSize:13,color:C.gold}}>₦{parseFloat(o.total_amount).toLocaleString()}</span>}
                    <StatusBadge status={o.status}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming appointments */}
        <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <h3 style={{fontSize:14,fontWeight:700,color:C.goldL}}>Upcoming</h3>
            <Btn variant="ghost" small onClick={()=>navTo("appointments")}>All</Btn>
          </div>
          {upcomingAppts.length===0?<Empty text="No upcoming appointments"/>:(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {upcomingAppts.map(a=>(
                <div key={a.id} style={{padding:"10px 12px",background:C.bg4,borderRadius:8}}>
                  <div style={{fontSize:13,color:C.gold}}>{a.clients?.full_name||"Client"}</div>
                  <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{a.date} · {a.time} · {a.type}</div>
                </div>
              ))}
            </div>
          )}

          {/* Quick actions */}
          <div style={{marginTop:20,borderTop:`1px solid ${C.border}`,paddingTop:16}}>
            <div style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,marginBottom:10,textTransform:"uppercase"}}>Quick Actions</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {[["New Client","clients"],["New Order","orders"],["AI Pattern","pattern"],["3D Studio","proto3d"]].map(([l,p])=>(
                <button key={p} onClick={()=>navTo(p)} style={{padding:"8px 10px",background:C.bg5,border:`1px solid ${C.border}`,borderRadius:7,color:C.text,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,transition:"all .15s"}}>{l}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Plan banner if on free */}
      {plan==="free"&&(
        <div style={{marginTop:16,background:C.gold+"10",border:`1px solid ${C.gold}33`,borderRadius:12,padding:"16px 20px",display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:13,fontWeight:700,color:C.goldL}}>You're on the free Thread plan</div>
            <div style={{fontSize:12,color:C.textMuted,marginTop:3}}>Upgrade to unlock AI pattern cutting, 3D prototyping, and unlimited clients.</div>
          </div>
          <Btn onClick={()=>navTo("billing")}>Upgrade →</Btn>
        </div>
      )}
    </PageWrap>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ═══════════════════════════════════════════════════════════════════════════════
function Clients({auth,plan,limits}){
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showModal,setShowModal]=useState(false);
  const [inviteModal,setInviteModal]=useState(null); // client object
  const [form,setForm]=useState({full_name:"",phone:"",email:"",address:"",notes:""});
  const [saving,setSaving]=useState(false);
  const [inviteSending,setInviteSending]=useState(false);
  const [inviteMsg,setInviteMsg]=useState("");
  const [search,setSearch]=useState("");

  const load=async()=>{const d=await sb.list(auth.token,"clients","");setClients(d||[]);setLoading(false);};
  useEffect(()=>{load();},[]);

  const save=async()=>{
    if(!form.full_name)return;
    setSaving(true);
    await sb.insert(auth.token,"clients",form);
    setSaving(false);setShowModal(false);setForm({full_name:"",phone:"",email:"",address:"",notes:""});
    load();
  };

  const sendInvite=async(client,inviteEmail)=>{
    if(!inviteEmail||!inviteEmail.includes("@")){setInviteMsg("Please enter a valid email address.");return;}
    setInviteSending(true);setInviteMsg("");
    try{
      // 1. Create a client_invites record so we can link auth → client on registration
      await sb.insert(auth.token,"client_invites",{
        client_id:client.id,
        tailor_user_id:auth.user?.id||auth.profile?.id,
        invite_email:inviteEmail,
        used:false,
      });
      // 2. Build the magic-link style invite URL (client clicks → pre-fills their ref)
      const base=window.location.origin+window.location.pathname;
      const inviteUrl=`${base}?ref=${client.id}&tailor=${auth.user?.id||auth.profile?.id}`;
      // 3. Send magic link via Supabase (emails them a login link)
      await sb.sendMagicLink(inviteEmail);
      setInviteMsg(`✦ Invite sent to ${inviteEmail}!

Also share this direct link:
${inviteUrl}`);
    }catch(e){setInviteMsg("Failed to send invite. Please try again.");}
    setInviteSending(false);
  };

  const filtered=clients.filter(c=>!search||c.full_name?.toLowerCase().includes(search.toLowerCase())||c.phone?.includes(search));
  const atLimit=clients.length>=limits.maxClients;

  return(
    <PageWrap title="Clients" subtitle={`${clients.length} clients in your studio`}
      action={<Btn onClick={()=>setShowModal(true)} disabled={atLimit}>+ New Client</Btn>}>
      {atLimit&&<div style={{marginBottom:16,padding:"10px 14px",background:C.ruby+"18",border:`1px solid ${C.ruby}44`,borderRadius:8,fontSize:12,color:C.ruby}}>Free plan limit reached. Upgrade to add unlimited clients.</div>}

      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search clients…"
        style={{width:"100%",maxWidth:360,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:8,padding:"10px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none",marginBottom:16}}/>

      {loading?<Spinner/>:filtered.length===0?<Empty text="No clients yet. Add your first client!"/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
          {filtered.map(c=>(
            <div key={c.id} style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:"18px 16px"}}>
              <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:10}}>
                <div style={{width:40,height:40,borderRadius:"50%",background:C.gold+"22",border:`1px solid ${C.gold}44`,display:"flex",alignItems:"center",justifyContent:"center",color:C.gold,fontWeight:700,fontSize:16,flexShrink:0}}>{c.full_name?.[0]||"?"}</div>
                <div><div style={{fontSize:14,fontWeight:700,color:C.goldL}}>{c.full_name}</div><div style={{fontSize:11,color:C.textMuted}}>{c.phone||"No phone"}</div></div>
              </div>
              {c.email&&<div style={{fontSize:12,color:C.textMuted,marginBottom:4}}>✉ {c.email}</div>}
              {c.address&&<div style={{fontSize:12,color:C.textMuted}}>📍 {c.address}</div>}
              {c.notes&&<div style={{fontSize:11,color:C.textMuted,marginTop:8,fontStyle:"italic",borderTop:`1px solid ${C.border}`,paddingTop:8}}>{c.notes}</div>}
              {/* Invite button */}
              <button onClick={()=>{setInviteModal(c);setInviteMsg("");}}
                style={{marginTop:10,width:"100%",padding:"6px 12px",background:"none",border:`1px solid ${C.gold}44`,borderRadius:6,color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700,letterSpacing:.5,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                🔗 Invite to Client Portal
              </button>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={()=>setShowModal(false)} title="New Client">
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Field label="Full Name *" value={form.full_name} onChange={e=>setForm(f=>({...f,full_name:e.target.value}))} placeholder="Ada Obi"/>
          <Field label="Phone Number" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="+234 806 000 0000"/>
          <Field label="Email Address" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} placeholder="ada@example.com" type="email"/>
          <Field label="Address" value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} placeholder="15 Aba Road, Port Harcourt"/>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Notes</label>
            <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Style preferences, allergies, referral source…"
              style={{width:"100%",height:80,background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"10px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none",resize:"vertical"}}/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:4}}>
            <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Client"}</Btn>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
          </div>
        </div>
      </Modal>

      {/* Invite to Portal Modal */}
      <InviteModal
        client={inviteModal}
        onClose={()=>{setInviteModal(null);setInviteMsg("");}}
        onSend={sendInvite}
        sending={inviteSending}
        message={inviteMsg}
        tailorId={auth.user?.id||auth.profile?.id}
      />
    </PageWrap>
  );
}

function InviteModal({client,onClose,onSend,sending,message,tailorId}){
  const [email,setEmail]=useState("");
  if(!client)return null;
  const base=window.location.origin+window.location.pathname;
  const directLink=`${base}?ref=${client.id}&tailor=${tailorId}`;
  return(
    <Modal open={true} onClose={onClose} title={`Invite ${client.full_name} to Client Portal`}>
      <div style={{display:"flex",flexDirection:"column",gap:14}}>
        {/* What the client will see */}
        <div style={{background:C.bg4,border:`1px solid ${C.gold}33`,borderRadius:9,padding:"12px 16px"}}>
          <div style={{fontSize:11,letterSpacing:1.5,color:C.gold,marginBottom:6,textTransform:"uppercase"}}>What your client gets</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
            {["View their orders & status","See upcoming fittings","View their measurements","See invoice & payment summary","Message you directly"].map((f,i)=>(
              <div key={i} style={{fontSize:12,color:C.text,display:"flex",gap:6}}><span style={{color:C.emerald}}>✦</span>{f}</div>
            ))}
          </div>
        </div>

        {/* Option 1: Email magic link */}
        <div>
          <div style={{fontSize:12,fontWeight:700,color:C.goldL,marginBottom:8}}>Option 1 — Send email invite</div>
          <div style={{display:"flex",gap:8}}>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder={client.email||"client@email.com"} type="email"
              style={{flex:1,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:7,padding:"10px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}/>
            <Btn onClick={()=>onSend(client,email||client.email)} disabled={sending}>{sending?"Sending…":"Send Invite"}</Btn>
          </div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:5}}>Client receives a magic-link email. One click — they're in, no password needed.</div>
        </div>

        {/* Option 2: Direct link */}
        <div>
          <div style={{fontSize:12,fontWeight:700,color:C.goldL,marginBottom:8}}>Option 2 — Share link directly (WhatsApp, SMS)</div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{flex:1,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:7,padding:"10px 14px",fontSize:11,color:C.textMuted,fontFamily:"monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {directLink}
            </div>
            <Btn variant="ghost" onClick={()=>{navigator.clipboard?.writeText(directLink);alert("Link copied!");}}>Copy</Btn>
          </div>
          <div style={{fontSize:11,color:C.textMuted,marginTop:5}}>Client opens this link → creates a password → sees their portal. Pre-linked to their profile.</div>
        </div>

        {message&&(
          <div style={{background:message.includes("✦")?C.emerald+"18":C.ruby+"18",border:`1px solid ${message.includes("✦")?C.emerald:C.ruby}44`,borderRadius:7,padding:"10px 14px",fontSize:12,color:message.includes("✦")?C.emerald:C.ruby,whiteSpace:"pre-line"}}>
            {message}
          </div>
        )}

        <Btn variant="ghost" onClick={onClose}>Close</Btn>
      </div>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════════════════
function Orders({auth,plan,limits}){
  const [orders,setOrders]=useState([]);
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showModal,setShowModal]=useState(false);
  const [form,setForm]=useState({client_id:"",garment_type:"",description:"",measurements_used:"",total_amount:"",deposit_paid:"",status:"Pending",due_date:"",notes:""});
  const [saving,setSaving]=useState(false);
  const [filterStatus,setFilterStatus]=useState("All");

  const load=async()=>{
    const [o,c]=await Promise.all([sb.list(auth.token,"orders","&select=*,clients(full_name)"),sb.list(auth.token,"clients","")]);
    setOrders(o||[]);setClients(c||[]);setLoading(false);
  };
  useEffect(()=>{load();},[]);

  const save=async()=>{
    if(!form.client_id||!form.garment_type)return;
    setSaving(true);
    await sb.insert(auth.token,"orders",form);
    setSaving(false);setShowModal(false);load();
  };

  const updateStatus=async(id,status)=>{await sb.update(auth.token,"orders",id,{status});load();};

  const filtered=orders.filter(o=>filterStatus==="All"||o.status===filterStatus);
  const atLimit=orders.length>=limits.maxOrders;
  const statuses=["All","Pending","In Progress","Fitting","Completed","Cancelled"];

  return(
    <PageWrap title="Orders" subtitle={`${orders.length} orders total`}
      action={<Btn onClick={()=>setShowModal(true)} disabled={atLimit}>+ New Order</Btn>}>
      {atLimit&&<div style={{marginBottom:16,padding:"10px 14px",background:C.ruby+"18",border:`1px solid ${C.ruby}44`,borderRadius:8,fontSize:12,color:C.ruby}}>Free plan limit reached. Upgrade for unlimited orders.</div>}

      {/* Status filter */}
      <div style={{display:"flex",gap:6,marginBottom:16,flexWrap:"wrap"}}>
        {statuses.map(s=>(
          <button key={s} onClick={()=>setFilterStatus(s)}
            style={{padding:"5px 12px",borderRadius:999,border:`1px solid ${filterStatus===s?C.gold:C.border}`,background:filterStatus===s?C.gold+"18":"none",color:filterStatus===s?C.gold:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700,letterSpacing:0.5}}>
            {s}
          </button>
        ))}
      </div>

      {loading?<Spinner/>:filtered.length===0?<Empty text={`No ${filterStatus!=="All"?filterStatus.toLowerCase():""} orders`}/>:(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {filtered.map(o=>(
            <div key={o.id} style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:"16px 18px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap"}}>
                <div>
                  <div style={{fontSize:15,fontWeight:700,color:C.goldL}}>{o.clients?.full_name||"Unknown"}</div>
                  <div style={{fontSize:12,color:C.textMuted,marginTop:2}}>{o.garment_type}</div>
                  {o.due_date&&<div style={{fontSize:11,color:C.textDim,marginTop:2}}>Due: {o.due_date}</div>}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  {o.total_amount&&<div style={{fontSize:14,color:C.gold}}>₦{parseFloat(o.total_amount).toLocaleString()}</div>}
                  <StatusBadge status={o.status}/>
                </div>
              </div>
              {o.description&&<div style={{fontSize:12,color:C.textMuted,marginTop:8,lineHeight:1.5}}>{o.description}</div>}
              {/* Status update */}
              <div style={{display:"flex",gap:6,marginTop:10,flexWrap:"wrap"}}>
                {["Pending","In Progress","Fitting","Completed","Cancelled"].map(s=>(
                  <button key={s} onClick={()=>updateStatus(o.id,s)} disabled={o.status===s}
                    style={{padding:"3px 10px",borderRadius:4,border:`1px solid ${STATUS_COLOR[s]||C.border}`,background:"none",color:o.status===s?STATUS_COLOR[s]:C.textMuted,cursor:o.status===s?"default":"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,opacity:o.status===s?1:.6}}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={()=>setShowModal(false)} title="New Order" wide>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Client *</label>
            <select value={form.client_id} onChange={e=>setForm(f=>({...f,client_id:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:form.client_id?C.text:C.textMuted,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              <option value="">Select client</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Garment Type *</label>
            <select value={form.garment_type} onChange={e=>setForm(f=>({...f,garment_type:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:form.garment_type?C.text:C.textMuted,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              <option value="">Select garment</option>
              {DRESS_TYPES.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Description</label>
            <textarea value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Fabric colour, style details, client requests…"
              style={{width:"100%",height:70,background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"10px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none",resize:"vertical"}}/>
          </div>
          <Field label="Total Amount (₦)" value={form.total_amount} onChange={e=>setForm(f=>({...f,total_amount:e.target.value}))} placeholder="45000"/>
          <Field label="Deposit Paid (₦)" value={form.deposit_paid} onChange={e=>setForm(f=>({...f,deposit_paid:e.target.value}))} placeholder="15000"/>
          <Field label="Due Date" value={form.due_date} onChange={e=>setForm(f=>({...f,due_date:e.target.value}))} type="date"/>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Status</label>
            <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              {["Pending","In Progress","Fitting","Completed","Cancelled"].map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Order"}</Btn>
          <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
        </div>
      </Modal>
    </PageWrap>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// APPOINTMENTS
// ═══════════════════════════════════════════════════════════════════════════════
function Appointments({auth}){
  const [appts,setAppts]=useState([]);
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showModal,setShowModal]=useState(false);
  const [form,setForm]=useState({client_id:"",date:"",time:"",type:"Consultation",duration:60,notes:""});
  const [saving,setSaving]=useState(false);

  const load=async()=>{
    const [a,c]=await Promise.all([sb.list(auth.token,"appointments","&select=*,clients(full_name)&order=date.asc,time.asc"),sb.list(auth.token,"clients","")]);
    setAppts(a||[]);setClients(c||[]);setLoading(false);
  };
  useEffect(()=>{load();},[]);

  const save=async()=>{
    if(!form.client_id||!form.date||!form.time)return;
    setSaving(true);await sb.insert(auth.token,"appointments",form);setSaving(false);setShowModal(false);load();
  };

  const today=new Date().toISOString().slice(0,10);
  const upcoming=appts.filter(a=>a.date>=today);
  const past=appts.filter(a=>a.date<today);
  const apptTypes=["Consultation","Initial Fitting","Second Fitting","Final Fitting","Pickup","Alteration","Measurement Session"];

  return(
    <PageWrap title="Appointments" subtitle="Schedule fittings, consultations and pickups"
      action={<Btn onClick={()=>setShowModal(true)}>+ New Appointment</Btn>}>
      {loading?<Spinner/>:(
        <>
          {upcoming.length>0&&(
            <>
              <h3 style={{fontSize:13,fontWeight:700,color:C.gold,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Upcoming ({upcoming.length})</h3>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10,marginBottom:24}}>
                {upcoming.map(a=>(
                  <div key={a.id} style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:12,padding:"14px 16px",borderLeft:`3px solid ${C.gold}`}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.goldL}}>{a.clients?.full_name}</div>
                    <div style={{fontSize:13,color:C.gold,marginTop:4}}>{a.date} · {a.time}</div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:4}}>{a.type} · {a.duration||60} min</div>
                    {a.notes&&<div style={{fontSize:11,color:C.textMuted,marginTop:6,fontStyle:"italic"}}>{a.notes}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          {past.length>0&&(
            <>
              <h3 style={{fontSize:13,fontWeight:700,color:C.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Past ({past.length})</h3>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:8}}>
                {past.slice(0,12).map(a=>(
                  <div key={a.id} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"}}>
                    <div style={{fontSize:13,color:C.text}}>{a.clients?.full_name}</div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:3}}>{a.date} · {a.type}</div>
                  </div>
                ))}
              </div>
            </>
          )}
          {appts.length===0&&<Empty text="No appointments yet. Schedule your first fitting!"/>}
        </>
      )}

      <Modal open={showModal} onClose={()=>setShowModal(false)} title="New Appointment">
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Client *</label>
            <select value={form.client_id} onChange={e=>setForm(f=>({...f,client_id:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:form.client_id?C.text:C.textMuted,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              <option value="">Select client</option>
              {clients.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Appointment Type</label>
            <select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              {apptTypes.map(t=><option key={t}>{t}</option>)}
            </select>
          </div>
          <Field label="Date *" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} type="date"/>
          <Field label="Time *" value={form.time} onChange={e=>setForm(f=>({...f,time:e.target.value}))} type="time"/>
          <Field label="Duration (minutes)" value={form.duration} onChange={e=>setForm(f=>({...f,duration:e.target.value}))} placeholder="60"/>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Notes</label>
            <textarea value={form.notes} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="Bring fabric swatches, style reference photos…"
              style={{width:"100%",height:70,background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"10px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none",resize:"vertical"}}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Appointment"}</Btn>
            <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
          </div>
        </div>
      </Modal>
    </PageWrap>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════════════════════════════════════
function InventoryPage({auth,plan,limits,navTo}){
  if(!limits.inventory)return(
    <PageWrap title="Inventory">
      <LockGate feature="inventory" plan={plan} navTo={navTo}>null</LockGate>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",minHeight:400,gap:16,padding:40}}>
        <div style={{fontSize:48}}>🔒</div>
        <h2 style={{color:C.goldL,fontSize:20,fontWeight:700}}>Needle Plan Required</h2>
        <p style={{color:C.textMuted,fontSize:14,textAlign:"center",maxWidth:360,lineHeight:1.7}}>Inventory management is available on the Needle, Atelier, and Maison plans.</p>
        <Btn onClick={()=>navTo("billing")}>Upgrade Now →</Btn>
      </div>
    </PageWrap>
  );

  const [items,setItems]=useState([]);
  const [loading,setLoading]=useState(true);
  const [showModal,setShowModal]=useState(false);
  const [form,setForm]=useState({name:"",category:"Fabric",quantity:"",unit:"metres",unit_cost:"",supplier:"",reorder_level:"",notes:""});
  const [saving,setSaving]=useState(false);

  const load=async()=>{const d=await sb.list(auth.token,"inventory","");setItems(d||[]);setLoading(false);};
  useEffect(()=>{load();},[]);

  const save=async()=>{
    if(!form.name)return;
    setSaving(true);await sb.insert(auth.token,"inventory",form);setSaving(false);setShowModal(false);load();
  };

  const categories=["Fabric","Thread","Buttons","Zippers","Interfacing","Lining","Elastic","Lace","Beads","Notions","Equipment","Other"];
  const lowStock=items.filter(i=>i.reorder_level&&parseFloat(i.quantity)<=parseFloat(i.reorder_level));

  return(
    <PageWrap title="Inventory" subtitle={`${items.length} items tracked`} action={<Btn onClick={()=>setShowModal(true)}>+ Add Item</Btn>}>
      {lowStock.length>0&&(
        <div style={{marginBottom:16,padding:"12px 16px",background:C.ruby+"12",border:`1px solid ${C.ruby}33`,borderRadius:10}}>
          <div style={{fontSize:12,fontWeight:700,color:C.ruby,marginBottom:6}}>⚠ Low Stock Alert ({lowStock.length} items)</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{lowStock.map(i=><span key={i.id} style={{fontSize:11,color:C.ruby,background:C.ruby+"18",padding:"2px 8px",borderRadius:4}}>{i.name}: {i.quantity} {i.unit}</span>)}</div>
        </div>
      )}
      {loading?<Spinner/>:items.length===0?<Empty text="No inventory items yet"/>:(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
          {items.map(i=>{
            const low=i.reorder_level&&parseFloat(i.quantity)<=parseFloat(i.reorder_level);
            return(
              <div key={i.id} style={{background:C.bg3,border:`1px solid ${low?C.ruby:C.border}`,borderRadius:11,padding:"14px 16px"}}>
                <div style={{fontSize:13,fontWeight:700,color:C.goldL}}>{i.name}</div>
                <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{i.category}</div>
                <div style={{fontSize:18,fontWeight:700,color:low?C.ruby:C.emerald,marginTop:8}}>{i.quantity} <span style={{fontSize:11,color:C.textMuted}}>{i.unit}</span></div>
                {i.unit_cost&&<div style={{fontSize:11,color:C.textMuted,marginTop:2}}>₦{parseFloat(i.unit_cost).toLocaleString()} / {i.unit}</div>}
                {i.supplier&&<div style={{fontSize:11,color:C.textMuted,marginTop:3}}>📦 {i.supplier}</div>}
                {low&&<div style={{fontSize:10,color:C.ruby,marginTop:6,fontWeight:700}}>REORDER NEEDED</div>}
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showModal} onClose={()=>setShowModal(false)} title="Add Inventory Item">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div style={{gridColumn:"1/-1"}}><Field label="Item Name *" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="White lace fabric"/></div>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Category</label>
            <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              {categories.map(c=><option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Unit</label>
            <select value={form.unit} onChange={e=>setForm(f=>({...f,unit:e.target.value}))}
              style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
              {["metres","yards","pieces","spools","packs","kg","g","rolls"].map(u=><option key={u}>{u}</option>)}
            </select>
          </div>
          <Field label="Quantity" value={form.quantity} onChange={e=>setForm(f=>({...f,quantity:e.target.value}))} placeholder="10"/>
          <Field label="Unit Cost (₦)" value={form.unit_cost} onChange={e=>setForm(f=>({...f,unit_cost:e.target.value}))} placeholder="3500"/>
          <Field label="Supplier" value={form.supplier} onChange={e=>setForm(f=>({...f,supplier:e.target.value}))} placeholder="Aba Market supplier"/>
          <Field label="Reorder Level" value={form.reorder_level} onChange={e=>setForm(f=>({...f,reorder_level:e.target.value}))} placeholder="2"/>
        </div>
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save Item"}</Btn>
          <Btn variant="ghost" onClick={()=>setShowModal(false)}>Cancel</Btn>
        </div>
      </Modal>
    </PageWrap>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MEASUREMENTS
// ═══════════════════════════════════════════════════════════════════════════════
function MeasurementsPage({auth}){
  const [clients,setClients]=useState([]);
  const [selectedClient,setSelectedClient]=useState("");
  const [meas,setMeas]=useState({});
  const [loading,setLoading]=useState(false);
  const [saving,setSaving]=useState(false);
  const [saved,setSaved]=useState(false);
  const [existingId,setExistingId]=useState(null);
  const [activeSection,setActiveSection]=useState(0);

  useEffect(()=>{sb.list(auth.token,"clients","").then(d=>setClients(d||[]));},[]);

  const loadMeas=async(clientId)=>{
    setLoading(true);setMeas({});setExistingId(null);
    try{
      const d=await sb.list(auth.token,"measurements",`&client_id=eq.${clientId}&limit=1`);
      if(d&&d[0]){setMeas(JSON.parse(d[0].data||"{}")||{});setExistingId(d[0].id);}
    }catch{}
    setLoading(false);
  };

  const saveMeas=async()=>{
    if(!selectedClient)return;
    setSaving(true);
    const payload={client_id:selectedClient,data:JSON.stringify(meas),updated_at:new Date().toISOString()};
    if(existingId)await sb.update(auth.token,"measurements",existingId,payload);
    else{const r=await sb.insert(auth.token,"measurements",payload);if(r?.id)setExistingId(r.id);}
    setSaved(true);setTimeout(()=>setSaved(false),3000);
    setSaving(false);
  };

  const set=k=>e=>setMeas(m=>({...m,[k]:e.target.value}));
  const completed=ALL_MEAS.filter(f=>meas[f.key]).length;

  return(
    <PageWrap title="27-Point Measurements" subtitle="Professional body measurements with guided instructions">
      {/* Client picker */}
      <div style={{display:"flex",gap:12,marginBottom:24,flexWrap:"wrap",alignItems:"center"}}>
        <select value={selectedClient} onChange={e=>{setSelectedClient(e.target.value);if(e.target.value)loadMeas(e.target.value);}}
          style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:8,padding:"11px 16px",color:selectedClient?C.text:C.textMuted,fontFamily:"inherit",fontSize:14,outline:"none",minWidth:220}}>
          <option value="">Select a client</option>
          {clients.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
        {selectedClient&&(
          <>
            <div style={{fontSize:12,color:C.textMuted}}>{completed} / {ALL_MEAS.length} completed</div>
            <Btn onClick={saveMeas} disabled={saving||!selectedClient}>{saving?"Saving…":saved?"✦ Saved!":"Save Measurements"}</Btn>
          </>
        )}
      </div>

      {!selectedClient?<Empty text="Select a client to enter measurements"/>:loading?<Spinner/>:(
        <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:16}}>
          {/* Section tabs */}
          <div style={{display:"flex",flexDirection:"column",gap:4}}>
            {MEAS_SECTIONS.map((s,i)=>(
              <button key={i} onClick={()=>setActiveSection(i)}
                style={{padding:"10px 14px",borderRadius:8,border:"none",borderLeft:`3px solid ${activeSection===i?s.color:"transparent"}`,background:activeSection===i?s.color+"18":C.bg3,color:activeSection===i?s.color:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,textAlign:"left",display:"flex",alignItems:"center",gap:8,transition:"all .15s"}}>
                <span>{s.icon}</span><span>{s.title}</span>
                <span style={{marginLeft:"auto",fontSize:10,color:activeSection===i?s.color:C.textDim}}>{s.fields.filter(f=>meas[f.key]).length}/{s.fields.length}</span>
              </button>
            ))}
          </div>

          {/* Fields */}
          <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:24}}>
            {MEAS_SECTIONS[activeSection]&&(
              <>
                <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
                  <span style={{fontSize:22,color:MEAS_SECTIONS[activeSection].color}}>{MEAS_SECTIONS[activeSection].icon}</span>
                  <h3 style={{fontSize:16,fontWeight:700,color:C.goldL}}>{MEAS_SECTIONS[activeSection].title}</h3>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:14}}>
                  {MEAS_SECTIONS[activeSection].fields.map(f=>(
                    <div key={f.key}>
                      <label style={{fontSize:11,letterSpacing:1.5,color:meas[f.key]?MEAS_SECTIONS[activeSection].color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:4}}>{f.label} {f.unit&&<span style={{color:C.textDim,fontWeight:400}}>({f.unit})</span>}</label>
                      <input value={meas[f.key]||""} onChange={set(f.key)} placeholder={f.hint}
                        style={{width:"100%",background:C.bg4,border:`1px solid ${meas[f.key]?MEAS_SECTIONS[activeSection].color+"55":C.border}`,borderRadius:7,padding:"9px 12px",color:C.text,fontFamily:"inherit",fontSize:14,outline:"none",transition:"border-color .2s"}}/>
                      <div style={{fontSize:10,color:C.textDim,marginTop:3}}>{f.hint}</div>
                    </div>
                  ))}
                </div>

                {/* Navigation */}
                <div style={{display:"flex",justifyContent:"space-between",marginTop:20,paddingTop:16,borderTop:`1px solid ${C.border}`}}>
                  <Btn variant="ghost" onClick={()=>setActiveSection(i=>Math.max(0,i-1))} disabled={activeSection===0}>← Previous</Btn>
                  {activeSection<MEAS_SECTIONS.length-1?(
                    <Btn onClick={()=>setActiveSection(i=>i+1)}>Next →</Btn>
                  ):(
                    <Btn onClick={saveMeas} disabled={saving}>{saving?"Saving…":"Save All Measurements"}</Btn>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </PageWrap>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// AI PATTERN CUTTING
// ═══════════════════════════════════════════════════════════════════════════════
function PatternPage({auth,plan,limits,navTo}){
  return(
    <PageWrap title="AI Pattern Cutting" subtitle="Generate complete pattern guides from measurements">
      <LockGate feature="ai" plan={plan} navTo={navTo}>
        <PatternInner auth={auth}/>
      </LockGate>
    </PageWrap>
  );
}

function PatternInner({auth}){
  const [clients,setClients]=useState([]);
  const [selectedClient,setSelectedClient]=useState("");
  const [meas,setMeas]=useState(null);
  const [garmentType,setGarmentType]=useState(DRESS_TYPES[0]);
  const [fabric,setFabric]=useState("");
  const [notes,setNotes]=useState("");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");

  useEffect(()=>{sb.list(auth.token,"clients","").then(d=>setClients(d||[]));},[]);

  const loadMeas=async(cid)=>{
    const d=await sb.list(auth.token,"measurements",`&client_id=eq.${cid}&limit=1`);
    if(d&&d[0])setMeas(JSON.parse(d[0].data||"{}"));else setMeas({});
  };

  const generate=async()=>{
    setLoading(true);setErr("");setResult(null);
    try{
      const measStr=meas?Object.entries(meas).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}cm`).join(", "):"No measurements recorded";
      const system=`You are an expert African fashion pattern-making specialist. Return ONLY valid JSON, no markdown. Output a complete pattern guide with these exact fields: {"patternName": string, "totalFabricNeeded": string, "seam_allowance": string, "interfacingNeeded": boolean, "grainlineNote": string, "pieces": [{"name": string, "qty": number, "width": string, "length": string, "shape": string, "notes": string}], "cuttingSequence": [string], "tailoringTips": [string]}`;
      const user=`Garment: ${garmentType}\nMeasurements: ${measStr}\nFabric: ${fabric||"not specified"}\nSpecial notes: ${notes||"none"}\n\nGenerate a complete pattern guide for a Nigerian/African tailor.`;
      const raw=await callClaude(system,user);
      setResult(parseJSON(raw));
    }catch(e){setErr("AI generation failed. Check your internet connection or try again. "+e.message);}
    setLoading(false);
  };

  return(
    <div>
      {/* Controls */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:24,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:20}}>
        <div>
          <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Client (for measurements)</label>
          <select value={selectedClient} onChange={e=>{setSelectedClient(e.target.value);if(e.target.value)loadMeas(e.target.value);}}
            style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:selectedClient?C.text:C.textMuted,fontFamily:"inherit",fontSize:13,outline:"none"}}>
            <option value="">General / custom</option>
            {clients.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Garment Type</label>
          <select value={garmentType} onChange={e=>setGarmentType(e.target.value)}
            style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
            {DRESS_TYPES.map(d=><option key={d}>{d}</option>)}
          </select>
        </div>
        <Field label="Fabric Type" value={fabric} onChange={e=>setFabric(e.target.value)} placeholder="e.g. Ankara cotton, chiffon"/>
        <Field label="Special Notes" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Pockets, embroidery, overlay…"/>
      </div>

      <Btn onClick={generate} disabled={loading}>{loading?"Generating pattern…":"✂ Generate Pattern →"}</Btn>
      {err&&<div style={{marginTop:14,padding:"12px 16px",background:C.ruby+"18",border:`1px solid ${C.ruby}44`,borderRadius:8,color:C.ruby,fontSize:12}}>{err}</div>}

      {loading&&<div style={{textAlign:"center",padding:60}}><div style={{fontSize:32,color:C.gold,animation:"pulse2 1.5s infinite"}}>✂</div><div style={{fontSize:14,color:C.textMuted,marginTop:12}}>AI is cutting your pattern…</div></div>}

      {result&&(
        <div style={{marginTop:24}}>
          {/* Header */}
          <div style={{background:C.gold+"10",border:`1px solid ${C.gold}33`,borderRadius:14,padding:"18px 20px",marginBottom:16}}>
            <h2 style={{fontSize:20,fontWeight:700,color:C.goldL}}>{result.patternName}</h2>
            <div style={{display:"flex",gap:24,marginTop:8,flexWrap:"wrap"}}>
              <div style={{fontSize:12,color:C.textMuted}}>📏 Fabric needed: <span style={{color:C.gold}}>{result.totalFabricNeeded}</span></div>
              <div style={{fontSize:12,color:C.textMuted}}>⊕ Seam allowance: <span style={{color:C.gold}}>{result.seam_allowance}</span></div>
              <div style={{fontSize:12,color:C.textMuted}}>Interfacing: <span style={{color:result.interfacingNeeded?C.ruby:C.emerald}}>{result.interfacingNeeded?"Required":"Not required"}</span></div>
              <div style={{fontSize:12,color:C.textMuted}}>Grain: <span style={{color:C.text}}>{result.grainlineNote}</span></div>
            </div>
          </div>

          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            {/* Pattern pieces */}
            <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
              <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:14}}>Pattern Pieces ({result.pieces?.length||0})</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(result.pieces||[]).map((p,i)=>(
                  <div key={i} style={{background:C.bg4,borderRadius:8,padding:"10px 12px"}}>
                    <div style={{display:"flex",justifyContent:"space-between"}}>
                      <span style={{fontSize:13,fontWeight:700,color:C.text}}>{p.name}</span>
                      <span style={{fontSize:11,color:C.gold}}>×{p.qty}</span>
                    </div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:3}}>{p.width} × {p.length} · {p.shape}</div>
                    {p.notes&&<div style={{fontSize:11,color:C.textDim,marginTop:3,fontStyle:"italic"}}>{p.notes}</div>}
                  </div>
                ))}
              </div>
            </div>

            <div style={{display:"flex",flexDirection:"column",gap:16}}>
              {/* Cutting sequence */}
              <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
                <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:12}}>Cutting Sequence</h3>
                <ol style={{paddingLeft:20,display:"flex",flexDirection:"column",gap:6}}>
                  {(result.cuttingSequence||[]).map((s,i)=>(
                    <li key={i} style={{fontSize:12,color:C.text,lineHeight:1.5}}>{s}</li>
                  ))}
                </ol>
              </div>

              {/* Tips */}
              <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
                <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:12}}>Tailoring Tips</h3>
                <ul style={{paddingLeft:20,display:"flex",flexDirection:"column",gap:6}}>
                  {(result.tailoringTips||[]).map((t,i)=>(
                    <li key={i} style={{fontSize:12,color:C.text,lineHeight:1.5}}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AI DESIGN PREVIEW
// ═══════════════════════════════════════════════════════════════════════════════
function DesignPreviewPage({auth,plan,limits,navTo}){
  return(
    <PageWrap title="AI Design Preview" subtitle="Generate fashion illustrations and style briefs">
      <LockGate feature="ai" plan={plan} navTo={navTo}>
        <DesignInner auth={auth}/>
      </LockGate>
    </PageWrap>
  );
}

function DesignInner({auth}){
  const [garmentType,setGarmentType]=useState(DRESS_TYPES[0]);
  const [occasion,setOccasion]=useState("Wedding guest");
  const [budget,setBudget]=useState("Mid-range");
  const [preferences,setPreferences]=useState("");
  const [result,setResult]=useState(null);
  const [loading,setLoading]=useState(false);
  const [err,setErr]=useState("");

  const generate=async()=>{
    setLoading(true);setErr("");setResult(null);
    try{
      const system=`You are an expert African fashion stylist and designer. Return ONLY valid JSON with these exact fields: {"designTitle": string, "styleDescription": string, "keyFeatures": [string], "fabricRecommendations": [{"fabric": string, "reason": string, "cost": string}], "colorPalette": [{"color": string, "hex": string, "role": string}], "accessories": [string], "occasionSuitability": string, "tailoringNotes": string, "estimatedFabric": string}`;
      const user=`Design a ${garmentType} for ${occasion}. Budget: ${budget}. Preferences: ${preferences||"classic African-modern fusion"}. Focus on Nigerian/West African fashion sensibility.`;
      const raw=await callClaude(system,user);
      setResult(parseJSON(raw));
    }catch(e){setErr("Design generation failed. "+e.message);}
    setLoading(false);
  };

  const occasions=["Wedding guest","Bridal","Church/Sunday","Work/Corporate","Evening gala","Traditional ceremony","Casual outing","Photoshoot","Red carpet"];
  const budgets=["Budget-friendly (₦15k–₦40k)","Mid-range (₦40k–₦120k)","Premium (₦120k–₦350k)","Luxury (₦350k+)"];

  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:12,marginBottom:20,background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:20}}>
        <div>
          <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Garment</label>
          <select value={garmentType} onChange={e=>setGarmentType(e.target.value)}
            style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
            {DRESS_TYPES.map(d=><option key={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Occasion</label>
          <select value={occasion} onChange={e=>setOccasion(e.target.value)}
            style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
            {occasions.map(o=><option key={o}>{o}</option>)}
          </select>
        </div>
        <div>
          <label style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase",display:"block",marginBottom:5}}>Budget Range</label>
          <select value={budget} onChange={e=>setBudget(e.target.value)}
            style={{width:"100%",background:C.bg4,border:`1px solid ${C.border}`,borderRadius:7,padding:"11px 14px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}>
            {budgets.map(b=><option key={b}>{b}</option>)}
          </select>
        </div>
        <Field label="Style Preferences" value={preferences} onChange={e=>setPreferences(e.target.value)} placeholder="Bold prints, off-shoulder, modest…"/>
      </div>

      <Btn onClick={generate} disabled={loading}>{loading?"Designing…":"👗 Generate Design →"}</Btn>
      {err&&<div style={{marginTop:14,padding:"12px",background:C.ruby+"18",border:`1px solid ${C.ruby}44`,borderRadius:8,color:C.ruby,fontSize:12}}>{err}</div>}

      {loading&&<div style={{textAlign:"center",padding:60}}><div style={{fontSize:32,color:C.gold,animation:"pulse2 1.5s infinite"}}>👗</div><div style={{fontSize:14,color:C.textMuted,marginTop:12}}>AI is designing your garment…</div></div>}

      {result&&(
        <div style={{marginTop:24,display:"grid",gridTemplateColumns:"1fr 320px",gap:16}}>
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            {/* Design title */}
            <div style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:14,padding:20}}>
              <h2 style={{fontSize:22,fontWeight:700,color:C.goldL,marginBottom:10}}>{result.designTitle}</h2>
              <p style={{fontSize:14,color:C.text,lineHeight:1.75,marginBottom:14}}>{result.styleDescription}</p>
              <div style={{fontSize:11,color:C.textMuted,marginBottom:8,letterSpacing:1,textTransform:"uppercase"}}>Key Features</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {(result.keyFeatures||[]).map((f,i)=>(
                  <span key={i} style={{fontSize:11,color:C.gold,background:C.gold+"15",border:`1px solid ${C.gold}33`,borderRadius:4,padding:"3px 10px"}}>{f}</span>
                ))}
              </div>
            </div>

            {/* Fabric recommendations */}
            <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
              <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:12}}>Fabric Recommendations</h3>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {(result.fabricRecommendations||[]).map((f,i)=>(
                  <div key={i} style={{background:C.bg4,borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontSize:13,fontWeight:700,color:C.text}}>{f.fabric} <span style={{fontSize:11,color:C.gold}}>— {f.cost}</span></div>
                    <div style={{fontSize:11,color:C.textMuted,marginTop:2}}>{f.reason}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tailoring notes */}
            <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
              <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:8}}>Tailoring Notes</h3>
              <p style={{fontSize:13,color:C.text,lineHeight:1.7}}>{result.tailoringNotes}</p>
              {result.estimatedFabric&&<div style={{marginTop:8,fontSize:12,color:C.gold}}>Estimated fabric: {result.estimatedFabric}</div>}
              <div style={{marginTop:6,fontSize:12,color:C.textMuted}}>Occasion: {result.occasionSuitability}</div>
            </div>
          </div>

          {/* Color palette & accessories */}
          <div style={{display:"flex",flexDirection:"column",gap:14}}>
            <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
              <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:14}}>Colour Palette</h3>
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                {(result.colorPalette||[]).map((c,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{width:40,height:40,borderRadius:8,background:c.hex,border:`1px solid ${C.borderL}`,flexShrink:0}}/>
                    <div>
                      <div style={{fontSize:13,color:C.text,fontWeight:600}}>{c.color}</div>
                      <div style={{fontSize:10,color:C.textMuted}}>{c.hex} · {c.role}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:18}}>
              <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:10}}>Accessories</h3>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {(result.accessories||[]).map((a,i)=>(
                  <div key={i} style={{fontSize:12,color:C.text,display:"flex",gap:8}}><span style={{color:C.gold}}>✦</span>{a}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// 3D PROTOTYPE STUDIO
// ═══════════════════════════════════════════════════════════════════════════════
function Proto3DPage({auth,plan,limits,navTo}){
  return(
    <PageWrap title="3D Prototype Studio" subtitle="Interactive 3D garment preview — rotate, zoom, change colours">
      <LockGate feature="ai" plan={plan} navTo={navTo}>
        <Proto3DInner/>
      </LockGate>
    </PageWrap>
  );
}

function Proto3DInner(){
  const canvasRef=useRef(null);
  const rendererRef=useRef(null);
  const sceneRef=useRef(null);
  const cameraRef=useRef(null);
  const garmentRef=useRef(null);
  const animRef=useRef(null);
  const mouseRef=useRef({down:false,x:0,y:0,rotX:0,rotY:0});

  const [garmentType,setGarmentType]=useState("Ankara Gown");
  const [fabricColor,setFabricColor]=useState("#c9472b");
  const [trimColor,setTrimColor]=useState("#c9a84c");
  const [autoRotate,setAutoRotate]=useState(true);
  const [built,setBuilt]=useState(false);

  const GARMENT_PRESETS={
    "Ankara Gown":{primaryColor:"#c9472b",accentColor:"#e8a03a",shape:"gown"},
    "Agbada & Senator":{primaryColor:"#1a4a8a",accentColor:"#c9a84c",shape:"agbada"},
    "Kaftan":{primaryColor:"#2a7a3a",accentColor:"#ffffff",shape:"kaftan"},
    "Corporate Suit":{primaryColor:"#1c2a3c",accentColor:"#c9a84c",shape:"suit"},
    "Mermaid Gown":{primaryColor:"#6a2a8a",accentColor:"#e8d9b0",shape:"mermaid"},
  };

  const changeGarment=(type)=>{
    setGarmentType(type);
    const preset=GARMENT_PRESETS[type]||GARMENT_PRESETS["Ankara Gown"];
    setFabricColor(preset.primaryColor);
    setTrimColor(preset.accentColor);
  };

  useEffect(()=>{
    const THREE=window.THREE;
    if(!THREE||!canvasRef.current)return;

    // Scene setup
    const scene=new THREE.Scene();
    scene.background=new THREE.Color(0x080704);
    sceneRef.current=scene;

    const w=canvasRef.current.clientWidth||500;
    const h=canvasRef.current.clientHeight||500;
    const camera=new THREE.PerspectiveCamera(45,w/h,0.1,100);
    camera.position.set(0,1.2,4.5);
    cameraRef.current=camera;

    const renderer=new THREE.WebGLRenderer({canvas:canvasRef.current,antialias:true,alpha:true});
    renderer.setSize(w,h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
    renderer.shadowMap.enabled=true;
    rendererRef.current=renderer;

    // Lighting
    scene.add(new THREE.AmbientLight(0xfff8e7,0.6));
    const dir=new THREE.DirectionalLight(0xfff8e7,1.2);
    dir.position.set(5,10,5);dir.castShadow=true;scene.add(dir);
    const fill=new THREE.DirectionalLight(0xc9a84c,0.3);
    fill.position.set(-5,3,-3);scene.add(fill);
    const back=new THREE.PointLight(0x4c7ec9,0.4);
    back.position.set(0,4,-4);scene.add(back);

    // Platform
    const platGeo=new THREE.CylinderGeometry(1.2,1.3,0.1,32);
    const platMat=new THREE.MeshStandardMaterial({color:0x1c1810,metalness:.4,roughness:.7});
    const plat=new THREE.Mesh(platGeo,platMat);
    plat.position.y=-1.95;scene.add(plat);
    const ringGeo=new THREE.TorusGeometry(1.2,0.03,8,48);
    const ringMat=new THREE.MeshStandardMaterial({color:0xc9a84c,metalness:.9,roughness:.1});
    const ring=new THREE.Mesh(ringGeo,ringMat);
    ring.rotation.x=Math.PI/2;ring.position.y=-1.9;scene.add(ring);

    setBuilt(false);

    return()=>{cancelAnimationFrame(animRef.current);renderer.dispose();};
  },[]);

  // Build garment when color/type changes
  useEffect(()=>{
    const THREE=window.THREE;
    const scene=sceneRef.current;
    if(!THREE||!scene)return;

    // Remove old garment
    if(garmentRef.current){scene.remove(garmentRef.current);garmentRef.current=null;}

    const group=new THREE.Group();
    const pCol=new THREE.Color(fabricColor);
    const sCol=new THREE.Color(trimColor);
    const skinCol=new THREE.Color(0xd4a574);
    const mkMat=c=>new THREE.MeshStandardMaterial({color:c,roughness:.7,metalness:.05});
    const skinMat=mkMat(skinCol);
    const primMat=mkMat(pCol);
    const secMat=mkMat(sCol);

    // Mannequin: head + neck + torso
    const head=new THREE.Mesh(new THREE.SphereGeometry(.18,16,16),skinMat);
    head.position.y=1.6;group.add(head);
    const neck=new THREE.Mesh(new THREE.CylinderGeometry(.07,.09,.2,12),skinMat);
    neck.position.y=1.41;group.add(neck);

    const shape=GARMENT_PRESETS[garmentType]?.shape||"gown";

    if(shape==="agbada"){
      // Wide flowing agbada robe
      const bodyGeo=new THREE.CylinderGeometry(.6,.5,.95,16);
      group.add(Object.assign(new THREE.Mesh(bodyGeo,primMat),{position:{y:.55}}));
      // Wide sleeves
      const sleeveGeo=new THREE.CylinderGeometry(.12,.1,1.8,12);
      const lSleeve=new THREE.Mesh(sleeveGeo,primMat);
      lSleeve.rotation.z=Math.PI/3;lSleeve.position.set(-.85,.6,0);group.add(lSleeve);
      const rSleeve=new THREE.Mesh(sleeveGeo,primMat);
      rSleeve.rotation.z=-Math.PI/3;rSleeve.position.set(.85,.6,0);group.add(rSleeve);
      // Under-trousers
      const trGeo=new THREE.CylinderGeometry(.22,.18,1.2,12);
      const lTr=new THREE.Mesh(trGeo,secMat);lTr.position.set(-.18,-.4,0);group.add(lTr);
      const rTr=new THREE.Mesh(trGeo,secMat);rTr.position.set(.18,-.4,0);group.add(rTr);
      // Collar
      const colGeo=new THREE.TorusGeometry(.12,.03,8,16);
      const col=new THREE.Mesh(colGeo,secMat);col.position.y=1.2;group.add(col);

    } else if(shape==="kaftan"){
      const bodyGeo=new THREE.CylinderGeometry(.42,.55,2.1,16);
      group.add(Object.assign(new THREE.Mesh(bodyGeo,primMat),{position:{y:.0}}));
      const sGeo=new THREE.CylinderGeometry(.08,.07,1.1,10);
      const lS=new THREE.Mesh(sGeo,primMat);lS.rotation.z=Math.PI/6;lS.position.set(-.54,.5,0);group.add(lS);
      const rS=new THREE.Mesh(sGeo,primMat);rS.rotation.z=-Math.PI/6;rS.position.set(.54,.5,0);group.add(rS);
      // Belt
      const bltGeo=new THREE.CylinderGeometry(.45,.45,.06,16);
      group.add(Object.assign(new THREE.Mesh(bltGeo,secMat),{position:{y:.35}}));

    } else if(shape==="suit"){
      // Jacket body
      const jGeo=new THREE.CylinderGeometry(.38,.32,.9,14);
      group.add(Object.assign(new THREE.Mesh(jGeo,primMat),{position:{y:.55}}));
      // Lapels
      const lapGeo=new THREE.BoxGeometry(.12,.3,.06);
      const lLap=new THREE.Mesh(lapGeo,secMat);lLap.position.set(-.1,.82,.3);group.add(lLap);
      const rLap=new THREE.Mesh(lapGeo,secMat);rLap.position.set(.1,.82,.3);group.add(rLap);
      // Sleeves
      const sGeo=new THREE.CylinderGeometry(.09,.08,.9,10);
      const lS=new THREE.Mesh(sGeo,primMat);lS.position.set(-.48,.5,0);group.add(lS);
      const rS=new THREE.Mesh(sGeo,primMat);rS.position.set(.48,.5,0);group.add(rS);
      // Trousers
      const tGeo=new THREE.CylinderGeometry(.2,.15,1.2,12);
      const lT=new THREE.Mesh(tGeo,primMat);lT.position.set(-.15,-.55,0);group.add(lT);
      const rT=new THREE.Mesh(tGeo,primMat);rT.position.set(.15,-.55,0);group.add(rT);
      // Buttons
      for(let i=0;i<3;i++){
        const btn=new THREE.Mesh(new THREE.SphereGeometry(.025,8,8),secMat);
        btn.position.set(0,.9-(i*.22),.38);group.add(btn);
      }

    } else if(shape==="mermaid"){
      // Fitted bodice
      const bodGeo=new THREE.CylinderGeometry(.3,.28,.85,14);
      group.add(Object.assign(new THREE.Mesh(bodGeo,primMat),{position:{y:.8}}));
      // Fitted skirt then flare
      const skGeo=new THREE.CylinderGeometry(.28,.26,.8,14);
      group.add(Object.assign(new THREE.Mesh(skGeo,primMat),{position:{y:.0}}));
      // Dramatic flare at hem
      const flrGeo=new THREE.CylinderGeometry(.7,.85,.7,16);
      group.add(Object.assign(new THREE.Mesh(flrGeo,primMat),{position:{y:-.8}}));
      // Embellishment band
      const bndGeo=new THREE.TorusGeometry(.29,.025,8,32);
      const bnd=new THREE.Mesh(bndGeo,secMat);bnd.position.y=-.35;group.add(bnd);

    } else {
      // Default: Ankara / gown silhouette
      const bodice=new THREE.Mesh(new THREE.CylinderGeometry(.34,.3,.8,14),primMat);
      bodice.position.y=.8;group.add(bodice);
      // Sleeves
      const sGeo=new THREE.CylinderGeometry(.1,.09,.7,10);
      const lS=new THREE.Mesh(sGeo,primMat);lS.rotation.z=Math.PI/8;lS.position.set(-.42,.75,0);group.add(lS);
      const rS=new THREE.Mesh(sGeo,primMat);rS.rotation.z=-Math.PI/8;rS.position.set(.42,.75,0);group.add(rS);
      // Full skirt with Ankara panels
      const skGeo=new THREE.CylinderGeometry(.7,.85,2,20);
      const sk=new THREE.Mesh(skGeo,primMat);sk.position.y=-.65;group.add(sk);
      // Ankara accent panels
      for(let i=0;i<6;i++){
        const pGeo=new THREE.BoxGeometry(.22,1.5,.01);
        const pMesh=new THREE.Mesh(pGeo,secMat);
        pMesh.position.set(Math.cos(i/6*Math.PI*2)*.58,-.5,Math.sin(i/6*Math.PI*2)*.58);
        pMesh.rotation.y=i/6*Math.PI*2;group.add(pMesh);
      }
      // Waistband
      const wbGeo=new THREE.CylinderGeometry(.32,.32,.06,14);
      group.add(Object.assign(new THREE.Mesh(wbGeo,secMat),{position:{y:.41}}));
    }

    group.position.y=-0.05;
    scene.add(group);
    garmentRef.current=group;
    setBuilt(true);

    // Animation loop
    cancelAnimationFrame(animRef.current);
    const animate=()=>{
      animRef.current=requestAnimationFrame(animate);
      if(autoRotate&&!mouseRef.current.down)group.rotation.y+=0.008;
      rendererRef.current?.render(scene,cameraRef.current);
    };
    animate();
  },[garmentType,fabricColor,trimColor,autoRotate]);

  // Mouse drag
  const onMouseDown=e=>{mouseRef.current={...mouseRef.current,down:true,x:e.clientX,y:e.clientY};};
  const onMouseMove=e=>{
    if(!mouseRef.current.down||!garmentRef.current)return;
    const dx=e.clientX-mouseRef.current.x,dy=e.clientY-mouseRef.current.y;
    garmentRef.current.rotation.y+=dx*.01;
    garmentRef.current.rotation.x+=dy*.005;
    mouseRef.current.x=e.clientX;mouseRef.current.y=e.clientY;
  };
  const onMouseUp=()=>{mouseRef.current.down=false;};

  return(
    <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:16}}>
      {/* Canvas */}
      <div style={{background:C.bg2,border:`1px solid ${C.borderL}`,borderRadius:16,overflow:"hidden",position:"relative",minHeight:500}}>
        <canvas ref={canvasRef} style={{width:"100%",height:"100%",display:"block",cursor:"grab"}}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}/>
        {!window.THREE&&(
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
            <div style={{fontSize:32,color:C.gold}}>🧊</div>
            <div style={{fontSize:13,color:C.textMuted}}>Loading 3D engine…</div>
          </div>
        )}
        <div style={{position:"absolute",bottom:12,left:12,fontSize:10,color:C.textDim,letterSpacing:1}}>DRAG TO ROTATE · SEWVIA 3D</div>
      </div>

      {/* Controls panel */}
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
          <div style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,marginBottom:10,textTransform:"uppercase"}}>Garment Type</div>
          {Object.keys(GARMENT_PRESETS).map(g=>(
            <button key={g} onClick={()=>changeGarment(g)}
              style={{display:"block",width:"100%",padding:"8px 12px",marginBottom:4,borderRadius:7,border:`1px solid ${garmentType===g?C.gold:C.border}`,background:garmentType===g?C.gold+"18":"none",color:garmentType===g?C.gold:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,textAlign:"left",transition:"all .15s"}}>
              {g}
            </button>
          ))}
        </div>

        <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
          <div style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,marginBottom:12,textTransform:"uppercase"}}>Colours</div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:6}}>Primary Fabric</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{width:32,height:32,borderRadius:6,background:fabricColor,border:`1px solid ${C.borderL}`,flexShrink:0}}/>
              <input type="color" value={fabricColor} onChange={e=>setFabricColor(e.target.value)}
                style={{flex:1,height:32,borderRadius:6,border:"none",background:"none",cursor:"pointer"}}/>
            </div>
          </div>
          <div>
            <div style={{fontSize:11,color:C.textMuted,marginBottom:6}}>Trim / Accent</div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <div style={{width:32,height:32,borderRadius:6,background:trimColor,border:`1px solid ${C.borderL}`,flexShrink:0}}/>
              <input type="color" value={trimColor} onChange={e=>setTrimColor(e.target.value)}
                style={{flex:1,height:32,borderRadius:6,border:"none",background:"none",cursor:"pointer"}}/>
            </div>
          </div>
        </div>

        <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
          <div style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,marginBottom:10,textTransform:"uppercase"}}>View</div>
          <button onClick={()=>setAutoRotate(a=>!a)}
            style={{width:"100%",padding:"8px 12px",borderRadius:7,border:`1px solid ${autoRotate?C.gold:C.border}`,background:autoRotate?C.gold+"18":"none",color:autoRotate?C.gold:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:12,fontWeight:700,transition:"all .15s"}}>
            {autoRotate?"⟳ Auto-rotate ON":"⟳ Auto-rotate OFF"}
          </button>
          <div style={{fontSize:10,color:C.textDim,marginTop:8,textAlign:"center"}}>Drag canvas to rotate manually</div>
        </div>

        {/* Preset swatches */}
        <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:16}}>
          <div style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,marginBottom:10,textTransform:"uppercase"}}>Quick Swatches</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6}}>
            {["#c9472b","#1a4a8a","#2a7a3a","#6a2a8a","#c9a84c","#e8f0ff","#1c1c1c","#ffffff","#e8a03a","#4cc97e"].map(col=>(
              <div key={col} onClick={()=>setFabricColor(col)}
                style={{width:"100%",paddingBottom:"100%",borderRadius:6,background:col,border:`2px solid ${fabricColor===col?C.text:"transparent"}`,cursor:"pointer"}}/>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// BILLING & PAYSTACK
// ═══════════════════════════════════════════════════════════════════════════════
function BillingPage({auth,plan,onUpdatePlan}){
  const [loading,setLoading]=useState(false);
  const [msg,setMsg]=useState("");

  const BILLING_PLANS=[
    {id:"needle",name:"Needle",icon:"🪡",price:3500,annual:35000,tag:"STARTER",color:"#4c7ec9",
      features:["Unlimited clients & orders","Full 27-point measurements","Inventory management","Appointment calendar","Email support"]},
    {id:"atelier",name:"Atelier",icon:"✂",price:8500,annual:80000,tag:"PRO",color:C.gold,popular:true,
      features:["Everything in Needle","AI pattern cutting","AI design preview","3D garment prototype","Priority WhatsApp support"]},
    {id:"maison",name:"Maison",icon:"👑",price:18000,tag:"STUDIO",color:"#c94cc9",
      features:["Everything in Atelier","Multi-staff logins","Branded client portal","API access","White-label option","Dedicated account manager"]},
  ];

  const pay=(planId,amount,label)=>{
    const PaystackPop=window.PaystackPop;
    if(!PaystackPop){setMsg("Paystack library not loaded. Please check your internet connection.");return;}
    setLoading(true);
    const handler=PaystackPop.setup({
      key:PAYSTACK_KEY,
      email:auth?.profile?.email||"user@sewvia.ng",
      amount:amount*100,
      currency:"NGN",
      ref:`sewvia_${planId}_${Date.now()}`,
      metadata:{user_id:auth?.profile?.id,plan:planId},
      onClose:()=>{setLoading(false);setMsg("Payment window closed.");},
      callback:async(response)=>{
        setLoading(false);
        if(response.status==="success"){
          try{
            await sb.update(auth.token,"profiles",auth.profile.id,{
              plan:planId,
              paystack_ref:response.reference,
              plan_expires_at:new Date(Date.now()+31*24*60*60*1000).toISOString(),
            });
            onUpdatePlan(planId);
            setMsg(`✦ Welcome to ${label}! Your plan is now active.`);
          }catch{setMsg("Payment received but plan update failed. Please contact support.");}
        } else {setMsg("Payment was not completed.");}
      },
    });
    handler.openIframe();
  };

  return(
    <PageWrap title="Plans & Billing" subtitle="Upgrade your studio. Cancel anytime.">
      {/* Current plan */}
      <div style={{background:C.gold+"10",border:`1px solid ${C.gold}33`,borderRadius:12,padding:"16px 20px",marginBottom:28,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:11,letterSpacing:1.5,color:C.textMuted,textTransform:"uppercase"}}>Current Plan</div>
          <div style={{fontSize:20,fontWeight:700,color:C.goldL,marginTop:3}}>{plan.charAt(0).toUpperCase()+plan.slice(1)} {plan==="free"?"(Thread)":""}</div>
          {auth?.profile?.plan_expires_at&&<div style={{fontSize:11,color:C.textMuted,marginTop:3}}>Renews: {new Date(auth.profile.plan_expires_at).toLocaleDateString()}</div>}
        </div>
        {plan==="free"&&<div style={{fontSize:12,color:C.textMuted}}>Upgrade below to unlock AI features and more.</div>}
        {plan!=="free"&&<div style={{fontSize:12,color:C.emerald}}>✦ Active subscription</div>}
      </div>

      {msg&&<div style={{marginBottom:16,padding:"12px 16px",background:msg.includes("✦")?C.emerald+"18":C.ruby+"18",border:`1px solid ${msg.includes("✦")?C.emerald:C.ruby}44`,borderRadius:8,fontSize:13,color:msg.includes("✦")?C.emerald:C.ruby}}>{msg}</div>}

      {/* Plan cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:16,marginBottom:32}}>
        {BILLING_PLANS.map(p=>(
          <div key={p.id} style={{background:C.bg3,border:`${p.popular?2:1}px solid ${p.popular?p.color:C.border}`,borderRadius:16,padding:"24px 20px",display:"flex",flexDirection:"column",position:"relative"}}>
            {p.popular&&<div style={{position:"absolute",top:-13,left:"50%",transform:"translateX(-50%)",background:p.color,color:C.bg,fontSize:9,fontWeight:700,letterSpacing:2,padding:"4px 16px",borderRadius:999,whiteSpace:"nowrap"}}>MOST POPULAR</div>}
            {plan===p.id&&<div style={{position:"absolute",top:12,right:12,fontSize:9,color:C.emerald,background:C.emerald+"18",padding:"2px 8px",borderRadius:4,fontWeight:700}}>ACTIVE</div>}

            <div style={{fontSize:28,marginBottom:8}}>{p.icon}</div>
            <div style={{fontSize:10,letterSpacing:3,color:C.textMuted,textTransform:"uppercase",marginBottom:4}}>{p.tag}</div>
            <div style={{fontSize:20,fontWeight:700,color:C.goldL,marginBottom:8}}>{p.name}</div>
            <div style={{fontSize:28,fontWeight:700,color:p.color}}>₦{p.price.toLocaleString()}<span style={{fontSize:12,color:C.textMuted,fontWeight:400}}>/mo</span></div>
            {p.annual&&<div style={{fontSize:11,color:C.textMuted,marginBottom:16}}>₦{p.annual.toLocaleString()}/yr — save 2 months</div>}

            <ul style={{listStyle:"none",flex:1,display:"flex",flexDirection:"column",gap:7,margin:"16px 0 20px"}}>
              {p.features.map((f,i)=>(
                <li key={i} style={{fontSize:12,color:C.text,display:"flex",gap:8}}><span style={{color:p.color,fontSize:9,marginTop:3}}>✦</span>{f}</li>
              ))}
            </ul>

            {plan===p.id?(
              <div style={{textAlign:"center",padding:"10px",color:C.emerald,fontSize:12,fontWeight:700,border:`1px solid ${C.emerald}44`,borderRadius:7}}>✦ Current Plan</div>
            ):(
              <div style={{display:"flex",gap:8,flexDirection:"column"}}>
                <button onClick={()=>pay(p.id,p.price,p.name)} disabled={loading}
                  style={{padding:"11px",background:p.popular?p.color:"none",border:`1px solid ${p.color}`,borderRadius:7,color:p.popular?C.bg:p.color,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,opacity:loading?.5:1}}>
                  {loading?"Processing…":`Upgrade to ${p.name} →`}
                </button>
                {p.annual&&(
                  <button onClick={()=>pay(p.id,p.annual,p.name+" Annual")} disabled={loading}
                    style={{padding:"9px",background:"none",border:`1px solid ${C.border}`,borderRadius:7,color:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:11,fontWeight:700,opacity:loading?.5:1}}>
                    Pay Annual (Save 2 months)
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Free plan summary */}
      <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:12,padding:20}}>
        <h3 style={{fontSize:14,fontWeight:700,color:C.goldL,marginBottom:12}}>Thread Plan (Free forever)</h3>
        <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
          {["3 clients max","5 orders max","Basic measurements","Appointment scheduling","No AI features","No inventory"].map(f=>(
            <div key={f} style={{fontSize:12,color:C.textMuted,display:"flex",gap:6}}><span style={{color:C.textDim}}>—</span>{f}</div>
          ))}
        </div>
      </div>

      {/* Support note */}
      <div style={{marginTop:20,padding:"14px 18px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:10}}>
        <div style={{fontSize:12,color:C.textMuted,lineHeight:1.7}}>
          <strong style={{color:C.text}}>Payment & Billing:</strong> All payments are processed securely by Paystack. Your subscription renews monthly. Cancel anytime — your data is always yours.
          For billing questions, WhatsApp: <strong style={{color:C.gold}}>+234 800 SEWVIA 0</strong> or email support@sewvia.ng
        </div>
      </div>
    </PageWrap>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════════
function Spinner(){
  return(
    <div style={{display:"flex",justifyContent:"center",alignItems:"center",padding:60}}>
      <div style={{width:28,height:28,border:`2px solid ${C.border}`,borderTopColor:C.gold,borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function Empty({text}){
  return(
    <div style={{textAlign:"center",padding:"60px 20px"}}>
      <div style={{fontSize:36,color:C.textDim,marginBottom:12}}>✦</div>
      <div style={{fontSize:14,color:C.textMuted}}>{text}</div>
    </div>
  );
}



// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT REGISTER — Self-signup with ?ref=CLIENT_ID&tailor=TAILOR_ID
// ═══════════════════════════════════════════════════════════════════════════════
function ClientRegister({clientRef,onLogin,onBack}){
  const [form,setForm]=useState({email:"",password:"",name:""});
  const [err,setErr]=useState("");
  const [loading,setLoading]=useState(false);
  const set=k=>e=>setForm(f=>({...f,[k]:e.target.value}));

  const submit=async()=>{
    if(!form.name||!form.email||!form.password){setErr("Please fill all fields.");return;}
    if(form.password.length<6){setErr("Password must be at least 6 characters.");return;}
    setLoading(true);setErr("");
    try{
      // Sign up
      const r=await sb.signUp(form.email,form.password,{full_name:form.name,role:"client"});
      if(r.error)throw new Error(r.error.message||"Signup failed");
      // Sign in
      const lr=await sb.signIn(form.email,form.password);
      if(lr.error)throw new Error("Account created! Please sign in.");
      const userId=lr.user?.id;
      const tk=lr.access_token;
      // Link this auth account → client record
      if(clientRef?.clientId&&clientRef?.tailorId){
        await sb.createClientLink(tk,{
          auth_user_id:userId,
          client_id:clientRef.clientId,
          tailor_user_id:clientRef.tailorId,
        });
      }
      // Get or create profile
      let profile=await sb.getProfile(tk);
      if(!profile)profile={full_name:form.name,role:"client"};
      profile.role="client";
      onLogin({token:tk,user:lr.user,profile,clientData:{client_id:clientRef?.clientId,tailor_user_id:clientRef?.tailorId}});
    }catch(e){setErr(e.message);}
    setLoading(false);
  };

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Cormorant Garamond','Palatino Linotype',Georgia,serif",display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
      <div style={{width:"100%",maxWidth:440}}>
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{fontSize:36,color:C.gold,marginBottom:10}}>✂</div>
          <div style={{fontSize:20,letterSpacing:5,fontWeight:700,color:C.goldL}}>SEWVIA</div>
          <div style={{marginTop:12,padding:"8px 18px",background:C.emerald+"18",border:`1px solid ${C.emerald}44`,borderRadius:999,display:"inline-block",fontSize:12,color:C.emerald}}>
            ✦ You've been invited to your Client Portal
          </div>
        </div>

        <div style={{background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:16,padding:"32px 28px"}}>
          <h2 style={{fontSize:18,fontWeight:700,color:C.goldL,marginBottom:6}}>Create your account</h2>
          <p style={{fontSize:13,color:C.textMuted,marginBottom:22}}>Set up your secure login to view your orders, fittings, measurements and messages.</p>

          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Field label="Your Name" value={form.name} onChange={set("name")} placeholder="Ada Obi"/>
            <Field label="Email Address" value={form.email} onChange={set("email")} placeholder="ada@email.com" type="email"/>
            <Field label="Create Password" value={form.password} onChange={set("password")} placeholder="At least 6 characters" type="password"/>
          </div>

          {err&&<div style={{marginTop:14,padding:"10px 14px",background:C.ruby+"18",border:`1px solid ${C.ruby}44`,borderRadius:7,color:C.ruby,fontSize:12}}>{err}</div>}

          <button onClick={submit} disabled={loading}
            style={{marginTop:20,width:"100%",padding:"13px",background:C.gold,border:"none",borderRadius:8,color:C.bg,cursor:"pointer",fontFamily:"inherit",fontSize:14,fontWeight:700,opacity:loading?.6:1}}>
            {loading?"Setting up…":"Access My Portal →"}
          </button>

          <p style={{textAlign:"center",fontSize:11,color:C.textMuted,marginTop:14,lineHeight:1.5}}>Already have an account?{" "}
            <button onClick={onBack} style={{background:"none",border:"none",color:C.gold,cursor:"pointer",fontFamily:"inherit",fontSize:11,padding:0}}>Sign in here</button>
          </p>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL — Full portal view for logged-in clients
// ═══════════════════════════════════════════════════════════════════════════════
function ClientPortal({auth,onLogout}){
  const [tab,setTab]=useState("orders");
  const [clientId,setClientId]=useState(auth.clientData?.client_id||null);
  const [clientInfo,setClientInfo]=useState(null);
  const [loadingClient,setLoadingClient]=useState(true);
  const [toast,setToast]=useState("");

  const showToast=msg=>{setToast(msg);setTimeout(()=>setToast(""),4000);};
  const name=auth.profile?.full_name||auth.user?.email?.split("@")[0]||"Client";

  useEffect(()=>{
    (async()=>{
      // If we don't have clientId from login, try fetching from client_auth
      if(!clientId){
        try{
          const link=await sb.getClientLink(auth.token,auth.user?.id);
          if(link){setClientId(link.client_id);setClientInfo(link.clients);}
        }catch{}
      }
      setLoadingClient(false);
    })();
  },[]);

  const TABS=[
    {id:"orders",icon:"⧉",label:"My Orders"},
    {id:"appointments",icon:"◷",label:"Appointments"},
    {id:"measurements",icon:"📐",label:"Measurements"},
    {id:"invoices",icon:"₦",label:"Invoices"},
    {id:"messages",icon:"✉",label:"Messages"},
  ];

  if(loadingClient)return<Splash/>;

  return(
    <div style={{minHeight:"100vh",background:C.bg,fontFamily:"'Cormorant Garamond','Palatino Linotype',Georgia,serif",color:C.text}}>
      <style>{`*{box-sizing:border-box}::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:${C.border};border-radius:2px}`}</style>

      {/* Portal Header */}
      <header style={{background:C.bg2,borderBottom:`1px solid ${C.border}`,padding:"14px 28px",display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:10}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontSize:22,color:C.gold}}>✂</span>
          <div>
            <div style={{fontSize:14,letterSpacing:4,fontWeight:700,color:C.goldL}}>SEWVIA</div>
            <div style={{fontSize:10,letterSpacing:2,color:C.textMuted}}>CLIENT PORTAL</div>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:13,color:C.goldL,fontWeight:600}}>{name}</div>
            <div style={{fontSize:10,color:C.textMuted}}>Client</div>
          </div>
          <button onClick={onLogout} style={{background:"none",border:`1px solid ${C.border}`,borderRadius:6,padding:"6px 14px",color:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:12}}>Sign out</button>
        </div>
      </header>

      {/* Welcome banner */}
      <div style={{background:`linear-gradient(135deg,${C.gold}12 0%,${C.bg3} 100%)`,borderBottom:`1px solid ${C.border}`,padding:"24px 28px"}}>
        <h1 style={{fontSize:22,fontWeight:700,color:C.goldL}}>Welcome back, {name.split(" ")[0]} ✦</h1>
        <p style={{fontSize:13,color:C.textMuted,marginTop:4}}>Track your orders, view your fittings, and message your tailor — all from one place.</p>
      </div>

      {/* Tab Nav */}
      <div style={{background:C.bg2,borderBottom:`1px solid ${C.border}`,padding:"0 28px",display:"flex",gap:0,overflowX:"auto"}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)}
            style={{padding:"14px 18px",background:"none",border:"none",borderBottom:`2px solid ${tab===t.id?C.gold:"transparent"}`,color:tab===t.id?C.gold:C.textMuted,cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:6,whiteSpace:"nowrap",transition:"all .15s"}}>
            <span>{t.icon}</span>{t.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={{maxWidth:900,margin:"0 auto",padding:"28px 20px"}}>
        {!clientId?(
          <div style={{textAlign:"center",padding:60}}>
            <div style={{fontSize:36,marginBottom:14}}>🔗</div>
            <h2 style={{color:C.goldL,fontSize:18,fontWeight:700,marginBottom:8}}>Portal not linked yet</h2>
            <p style={{color:C.textMuted,fontSize:14,lineHeight:1.7}}>Your account isn't linked to a client record yet. Ask your tailor to send you a portal invite link.</p>
          </div>
        ):(
          <>
            {tab==="orders"&&<ClientOrders auth={auth} clientId={clientId}/>}
            {tab==="appointments"&&<ClientAppointments auth={auth} clientId={clientId}/>}
            {tab==="measurements"&&<ClientMeasurements auth={auth} clientId={clientId}/>}
            {tab==="invoices"&&<ClientInvoices auth={auth} clientId={clientId}/>}
            {tab==="messages"&&<ClientMessages auth={auth} clientId={clientId} clientName={name}/>}
          </>
        )}
      </div>

      {toast&&<div style={{position:"fixed",bottom:24,right:24,background:C.bg3,border:`1px solid ${C.gold}66`,borderRadius:10,padding:"12px 20px",fontSize:13,color:C.goldL,zIndex:1000,boxShadow:"0 8px 32px rgba(0,0,0,.55)"}}>{toast}</div>}
    </div>
  );
}

// ── Client: Orders ────────────────────────────────────────────────────────────
function ClientOrders({auth,clientId}){
  const [orders,setOrders]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    sb.clientOrders(auth.token,clientId).then(d=>{setOrders(d||[]);setLoading(false);});
  },[clientId]);

  const active=orders.filter(o=>!["Completed","Cancelled"].includes(o.status));
  const completed=orders.filter(o=>o.status==="Completed");
  const totalPaid=orders.reduce((s,o)=>s+(parseFloat(o.deposit_paid)||0),0);
  const totalBalance=orders.reduce((s,o)=>s+(parseFloat(o.total_amount)||0)-(parseFloat(o.deposit_paid)||0),0);

  if(loading)return<Spinner/>;

  return(
    <div>
      {/* Summary KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:12,marginBottom:24}}>
        {[["Total Orders",orders.length,"⧉",C.sapphire],["Active",active.length,"◷",C.gold],["Completed",completed.length,"✦",C.emerald],["Balance Due",`₦${Math.max(0,totalBalance).toLocaleString()}`,"₦",C.ruby]].map(([l,v,ic,col])=>(
          <div key={l} style={{background:C.bg3,border:`1px solid ${col}44`,borderRadius:12,padding:"14px 16px",display:"flex",alignItems:"center",gap:12}}>
            <div style={{fontSize:20,color:col}}>{ic}</div>
            <div><div style={{fontSize:11,color:C.textMuted,letterSpacing:1,textTransform:"uppercase"}}>{l}</div><div style={{fontSize:20,fontWeight:700,color:C.goldL}}>{v}</div></div>
          </div>
        ))}
      </div>

      {orders.length===0?<Empty text="No orders yet. Your tailor will add your orders here."/>:(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {orders.map(o=>{
            const total=parseFloat(o.total_amount)||0;
            const paid=parseFloat(o.deposit_paid)||0;
            const balance=Math.max(0,total-paid);
            const pct=total>0?Math.min(100,Math.round(paid/total*100)):0;
            return(
              <div key={o.id} style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,padding:"18px 20px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:12,flexWrap:"wrap",marginBottom:14}}>
                  <div>
                    <div style={{fontSize:16,fontWeight:700,color:C.goldL}}>{o.garment_type||"Order"}</div>
                    {o.description&&<div style={{fontSize:12,color:C.textMuted,marginTop:3,maxWidth:400}}>{o.description}</div>}
                    {o.due_date&&<div style={{fontSize:11,color:C.textDim,marginTop:4}}>Due: {o.due_date}</div>}
                  </div>
                  <StatusBadge status={o.status}/>
                </div>

                {/* Progress timeline */}
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
                  {["Pending","In Progress","Fitting","Completed"].map((s,i)=>{
                    const stages=["Pending","In Progress","Fitting","Completed"];
                    const cur=stages.indexOf(o.status);
                    const done=i<=cur&&o.status!=="Cancelled";
                    return(
                      <div key={s} style={{display:"flex",flexDirection:"column",alignItems:"center",flex:1}}>
                        <div style={{width:20,height:20,borderRadius:"50%",background:done?STATUS_COLOR[s]:C.bg5,border:`2px solid ${done?STATUS_COLOR[s]:C.border}`,marginBottom:4,transition:"all .3s"}}/>
                        <div style={{fontSize:9,color:done?STATUS_COLOR[s]:C.textDim,letterSpacing:.5,textAlign:"center"}}>{s}</div>
                      </div>
                    );
                  })}
                </div>
                <div style={{height:3,background:C.bg5,borderRadius:2,marginBottom:14,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:`linear-gradient(90deg,${C.sapphire},${C.emerald})`,borderRadius:2,transition:"width .5s"}}/>
                </div>

                {/* Payment */}
                {total>0&&(
                  <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:8,padding:"10px 14px",background:C.bg4,borderRadius:8}}>
                    <div style={{fontSize:12,color:C.textMuted}}>Total: <strong style={{color:C.goldL}}>₦{total.toLocaleString()}</strong></div>
                    <div style={{fontSize:12,color:C.textMuted}}>Paid: <strong style={{color:C.emerald}}>₦{paid.toLocaleString()}</strong></div>
                    <div style={{fontSize:12,color:C.textMuted}}>Balance: <strong style={{color:balance>0?C.ruby:C.emerald}}>₦{balance.toLocaleString()}</strong></div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Client: Appointments ──────────────────────────────────────────────────────
function ClientAppointments({auth,clientId}){
  const [appts,setAppts]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    sb.clientAppointments(auth.token,clientId).then(d=>{setAppts(d||[]);setLoading(false);});
  },[clientId]);

  if(loading)return<Spinner/>;
  const today=new Date().toISOString().slice(0,10);
  const upcoming=appts.filter(a=>a.date>=today);
  const past=appts.filter(a=>a.date<today);

  return(
    <div>
      {appts.length===0&&<Empty text="No appointments scheduled yet. Your tailor will add them here."/>}
      {upcoming.length>0&&(
        <div style={{marginBottom:28}}>
          <h3 style={{fontSize:13,fontWeight:700,color:C.gold,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Upcoming ({upcoming.length})</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:12}}>
            {upcoming.map(a=>(
              <div key={a.id} style={{background:C.bg3,border:`2px solid ${C.gold}44`,borderRadius:14,padding:"18px 16px",borderLeft:`4px solid ${C.gold}`}}>
                <div style={{fontSize:15,fontWeight:700,color:C.gold,marginBottom:4}}>{a.date}</div>
                <div style={{fontSize:14,color:C.goldL}}>{a.type}</div>
                {a.time&&<div style={{fontSize:12,color:C.textMuted,marginTop:4}}>🕐 {a.time}</div>}
                {a.duration&&<div style={{fontSize:11,color:C.textDim,marginTop:2}}>{a.duration} minutes</div>}
                {a.notes&&<div style={{fontSize:12,color:C.textMuted,marginTop:8,fontStyle:"italic",borderTop:`1px solid ${C.border}`,paddingTop:8}}>{a.notes}</div>}
                <div style={{marginTop:10,padding:"6px 12px",background:C.gold+"18",borderRadius:6,fontSize:11,color:C.gold,fontWeight:700,textAlign:"center"}}>UPCOMING FITTING</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {past.length>0&&(
        <div>
          <h3 style={{fontSize:13,fontWeight:700,color:C.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Past ({past.length})</h3>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:10}}>
            {past.map(a=>(
              <div key={a.id} style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:10,padding:"12px 14px"}}>
                <div style={{fontSize:12,color:C.textMuted}}>{a.date} · {a.type}</div>
                {a.time&&<div style={{fontSize:11,color:C.textDim}}>🕐 {a.time}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Client: Measurements ──────────────────────────────────────────────────────
function ClientMeasurements({auth,clientId}){
  const [meas,setMeas]=useState(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    sb.clientMeasurements(auth.token,clientId).then(d=>{
      if(d?.data)setMeas(JSON.parse(d.data||"{}"));
      setLoading(false);
    });
  },[clientId]);

  if(loading)return<Spinner/>;
  if(!meas||Object.keys(meas).filter(k=>meas[k]).length===0)return<Empty text="Your tailor hasn't recorded your measurements yet."/>;

  const filled=ALL_MEAS.filter(f=>meas[f.key]);
  const pct=Math.round(filled.length/ALL_MEAS.length*100);

  return(
    <div>
      <div style={{background:C.gold+"10",border:`1px solid ${C.gold}33`,borderRadius:12,padding:"14px 18px",marginBottom:20,display:"flex",alignItems:"center",gap:16}}>
        <div style={{position:"relative",width:48,height:48,flexShrink:0}}>
          <svg viewBox="0 0 48 48" style={{position:"absolute",inset:0,width:48,height:48}}>
            <circle cx="24" cy="24" r="20" fill="none" stroke={C.border} strokeWidth="4"/>
            <circle cx="24" cy="24" r="20" fill="none" stroke={C.gold} strokeWidth="4"
              strokeDasharray={`${pct*1.257} 125.7`} strokeDashoffset="31.4"
              strokeLinecap="round" transform="rotate(-90 24 24)"/>
          </svg>
          <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700,color:C.gold}}>{pct}%</span>
        </div>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:C.goldL}}>{filled.length} of {ALL_MEAS.length} measurements recorded</div>
          <div style={{fontSize:12,color:C.textMuted,marginTop:2}}>These are your personal measurements stored securely by your tailor.</div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:10}}>
        {MEAS_SECTIONS.map(section=>(
          <div key={section.title} style={{background:C.bg3,border:`1px solid ${section.color}44`,borderRadius:12,padding:14}}>
            <div style={{fontSize:13,fontWeight:700,color:section.color,marginBottom:10}}>{section.icon} {section.title}</div>
            <div style={{display:"flex",flexDirection:"column",gap:4}}>
              {section.fields.filter(f=>meas[f.key]).map(f=>(
                <div key={f.key} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:`1px solid ${C.border}18`}}>
                  <span style={{fontSize:11,color:C.textMuted}}>{f.label}</span>
                  <span style={{fontSize:11,fontWeight:700,color:section.color}}>{meas[f.key]}{f.unit}</span>
                </div>
              ))}
              {section.fields.filter(f=>!meas[f.key]).length>0&&(
                <div style={{fontSize:10,color:C.textDim,marginTop:2}}>{section.fields.filter(f=>!meas[f.key]).length} not yet recorded</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Client: Invoices ──────────────────────────────────────────────────────────
function ClientInvoices({auth,clientId}){
  const [orders,setOrders]=useState([]);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    sb.clientOrders(auth.token,clientId).then(d=>{setOrders(d||[]);setLoading(false);});
  },[clientId]);

  if(loading)return<Spinner/>;
  if(orders.length===0)return<Empty text="No invoices yet. Orders will appear here once your tailor adds them."/>;

  const grandTotal=orders.reduce((s,o)=>s+(parseFloat(o.total_amount)||0),0);
  const grandPaid=orders.reduce((s,o)=>s+(parseFloat(o.deposit_paid)||0),0);
  const grandBalance=Math.max(0,grandTotal-grandPaid);

  return(
    <div>
      {/* Summary */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:24}}>
        {[["Total Billed",`₦${grandTotal.toLocaleString()}`,C.sapphire],["Total Paid",`₦${grandPaid.toLocaleString()}`,C.emerald],["Outstanding",`₦${grandBalance.toLocaleString()}`,grandBalance>0?C.ruby:C.emerald]].map(([l,v,col])=>(
          <div key={l} style={{background:C.bg3,border:`1px solid ${col}44`,borderRadius:12,padding:"16px 18px",textAlign:"center"}}>
            <div style={{fontSize:10,color:C.textMuted,letterSpacing:1,textTransform:"uppercase",marginBottom:6}}>{l}</div>
            <div style={{fontSize:22,fontWeight:700,color:col}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Invoice list */}
      <div style={{background:C.bg3,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <thead>
            <tr style={{borderBottom:`1px solid ${C.border}`}}>
              {["Garment","Date","Status","Total","Paid","Balance"].map(h=>(
                <th key={h} style={{padding:"12px 16px",textAlign:"left",fontSize:10,letterSpacing:1.5,color:C.gold,textTransform:"uppercase",fontWeight:700}}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((o,i)=>{
              const total=parseFloat(o.total_amount)||0;
              const paid=parseFloat(o.deposit_paid)||0;
              const bal=Math.max(0,total-paid);
              return(
                <tr key={o.id} style={{borderBottom:i<orders.length-1?`1px solid ${C.border}22`:"none",background:i%2===0?"none":C.bg2+"88"}}>
                  <td style={{padding:"12px 16px",fontSize:13,color:C.goldL,fontWeight:600}}>{o.garment_type||"Order"}</td>
                  <td style={{padding:"12px 16px",fontSize:12,color:C.textMuted}}>{o.created_at?.slice(0,10)||"—"}</td>
                  <td style={{padding:"12px 16px"}}><StatusBadge status={o.status}/></td>
                  <td style={{padding:"12px 16px",fontSize:13,color:C.text}}>₦{total.toLocaleString()}</td>
                  <td style={{padding:"12px 16px",fontSize:13,color:C.emerald}}>₦{paid.toLocaleString()}</td>
                  <td style={{padding:"12px 16px",fontSize:13,fontWeight:700,color:bal>0?C.ruby:C.emerald}}>₦{bal.toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Client: Messages ─────────────────────────────────────────────────────────
function ClientMessages({auth,clientId,clientName}){
  const [messages,setMessages]=useState([]);
  const [loading,setLoading]=useState(true);
  const [text,setText]=useState("");
  const [sending,setSending]=useState(false);
  const bottomRef=useRef(null);

  const loadMsgs=async()=>{
    const d=await sb.getMessages(auth.token,clientId);
    setMessages(d||[]);setLoading(false);
  };

  useEffect(()=>{loadMsgs();},[clientId]);
  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const send=async()=>{
    if(!text.trim())return;
    setSending(true);
    const msg={client_id:clientId,sender_role:"client",sender_name:clientName,body:text.trim()};
    const saved=await sb.sendMessage(auth.token,msg);
    if(saved?.id)setMessages(m=>[...m,saved]);
    setText("");setSending(false);
  };

  if(loading)return<Spinner/>;

  return(
    <div style={{display:"flex",flexDirection:"column",height:"60vh",minHeight:400}}>
      {/* Messages thread */}
      <div style={{flex:1,overflowY:"auto",padding:"0 0 12px",display:"flex",flexDirection:"column",gap:10}}>
        {messages.length===0&&(
          <div style={{textAlign:"center",padding:40,color:C.textMuted,fontSize:13}}>
            No messages yet. Send your tailor a message below.
          </div>
        )}
        {messages.map(m=>{
          const isClient=m.sender_role==="client";
          return(
            <div key={m.id} style={{display:"flex",flexDirection:"column",alignItems:isClient?"flex-end":"flex-start"}}>
              <div style={{maxWidth:"75%",background:isClient?C.gold+"22":C.bg3,border:`1px solid ${isClient?C.gold+"55":C.border}`,borderRadius:12,borderBottomRightRadius:isClient?2:12,borderBottomLeftRadius:isClient?12:2,padding:"10px 14px"}}>
                <div style={{fontSize:10,color:isClient?C.gold:C.textMuted,marginBottom:4,fontWeight:700,letterSpacing:1}}>
                  {isClient?"You":m.sender_name||"Tailor"}
                </div>
                <div style={{fontSize:13,color:C.text,lineHeight:1.6}}>{m.body}</div>
              </div>
              <div style={{fontSize:10,color:C.textDim,marginTop:3,paddingLeft:4,paddingRight:4}}>
                {m.created_at?new Date(m.created_at).toLocaleString("en-NG",{hour:"2-digit",minute:"2-digit",day:"numeric",month:"short"}):""}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef}/>
      </div>

      {/* Input */}
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14,display:"flex",gap:10}}>
        <input value={text} onChange={e=>setText(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}}
          placeholder="Type a message… (Enter to send)"
          style={{flex:1,background:C.bg3,border:`1px solid ${C.borderL}`,borderRadius:8,padding:"11px 16px",color:C.text,fontFamily:"inherit",fontSize:13,outline:"none"}}/>
        <Btn onClick={send} disabled={sending||!text.trim()}>{sending?"…":"Send →"}</Btn>
      </div>
    </div>
  );
}

// Mount
const domRoot = ReactDOM.createRoot(document.getElementById('root'));
domRoot.render(React.createElement(Sewvia));

export default Sewvia
