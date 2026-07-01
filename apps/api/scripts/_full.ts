import jwt from 'jsonwebtoken';
import { prisma } from '../src/db';
import { invalidateDisponibilidadCache } from '../src/redis';
const ok=(c:boolean,m:string)=>console.log(`${c?'✅ PASA':'❌ FALLA'} · ${m}`);
(async()=>{
  // invalidar caché todas las sedes
  const sedes=await prisma.sede.findMany({select:{id:true,nombre:true}});
  for(const s of sedes){for(let i=-30;i<30;i++){const d=new Date();d.setDate(d.getDate()+i);await invalidateDisponibilidadCache(s.id,d.toISOString().slice(0,10));}}
  console.log('✓ caché invalidada (todas las sedes)\n');

  // Fiorella: una sola asignación
  const fa=await prisma.asignacionSede.findMany({where:{profesional:{apellidos:{contains:'Bouisson'}}},include:{sede:{select:{nombre:true}}}});
  ok(fa.length===1 && fa[0].sede.nombre==='Paz Soldán' && fa[0].fechaFin===null, `Fiorella: 1 asignación → ${fa[0]?.sede.nombre} (indef). En CUALQUIER fecha sale en Paz Soldán.`);

  // flujo movimiento: crear (mover una podóloga de Lince a Los Olivos) + eliminar, con índice activo
  const u=await prisma.usuario.findFirst({where:{email:'admin@limablue.pe'},select:{id:true,rol:true}});
  const tok=jwt.sign({userId:u!.id,rol:u!.rol},process.env.JWT_SECRET!,{expiresIn:'1h'});
  const H={Authorization:`Bearer ${tok}`,'Content-Type':'application/json'};
  const pod=await prisma.profesional.findFirst({where:{tipo:'podologa',apellidos:{contains:'Zambrano'}},select:{id:true,asignaciones:{where:{activa:true},select:{sedeId:true}}}});
  const destino=sedes.find(s=>s.id!==pod!.asignaciones[0].sedeId)!;
  const manana=new Date(); manana.setDate(manana.getDate()+1); const f=manana.toISOString().slice(0,10);
  let r=await fetch('http://localhost:3002/api/v1/movimientos',{method:'POST',headers:H,body:JSON.stringify({profesionalId:pod!.id,sedeId:destino.id,fechaInicio:f,motivo:'OTRO'})});
  ok(r.status===201,`Crear movimiento (con índice activo) → ${r.status}`);
  const mov=await r.json() as any;
  const abiertas=await prisma.asignacionSede.count({where:{profesionalId:pod!.id,fechaFin:null}});
  ok(abiertas===1,`Tras crear: sigue habiendo 1 sola asignación abierta (=${abiertas})`);
  // eliminar el movimiento (futuro) → restaura, sin violar índice
  r=await fetch(`http://localhost:3002/api/v1/movimientos/${mov.id}`,{method:'DELETE',headers:H});
  ok(r.status===200,`Eliminar movimiento → ${r.status} (orden borrar-antes-restaurar respeta el índice)`);
  const abiertas2=await prisma.asignacionSede.count({where:{profesionalId:pod!.id,fechaFin:null}});
  ok(abiertas2===1,`Tras eliminar: 1 sola asignación abierta restaurada (=${abiertas2})`);
  await prisma.$disconnect();
})().catch(e=>{console.error('✗',e);process.exit(1);});
