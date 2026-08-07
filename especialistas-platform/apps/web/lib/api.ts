export const API=process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
export async function api(path:string,options:RequestInit={}){
  const token=typeof window!=='undefined'?localStorage.getItem('token'):null;
  const res=await fetch(API+path,{...options,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}) ,...(options.headers||{})}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data?.message || 'Error de servidor');
  return data;
}
