import { prisma } from '../src/db';
import { invalidateDisponibilidadCache } from '../src/redis';
(async()=>{
  const sedes=await prisma.sede.findMany({where:{deletedAt:null},select:{id:true,nombre:true}});
  for(const s of sedes){ for(let i=0;i<14;i++){ const d=new Date(); d.setDate(d.getDate()+i); await invalidateDisponibilidadCache(s.id, d.toISOString().slice(0,10)); } }
  console.log('✓ caché de disponibilidad invalidada en todas las sedes');
  // confirmar Jenny
  const j=await prisma.profesional.findFirst({where:{apellidos:{contains:'Chiclla'}},select:{id:true,nombres:true,apellidos:true,asignaciones:{where:{activa:true},include:{sede:{select:{nombre:true}}}}}});
  console.log('Jenny:', j?.nombres, j?.apellidos, '→', j?.asignaciones.map(a=>a.sede.nombre).join(','));
  // resumen distribución por sede
  const pods=await prisma.profesional.findMany({where:{tipo:'podologa',deletedAt:null,activo:true},select:{asignaciones:{where:{activa:true},select:{sede:{select:{nombre:true}}}}}});
  const conteo=new Map<string,number>();
  for(const p of pods){ const s=p.asignaciones[0]?.sede.nombre ?? 'SIN SEDE'; conteo.set(s,(conteo.get(s)??0)+1); }
  console.log('\nDistribución actual de podólogas por sede:');
  for(const [s,n] of [...conteo.entries()].sort()) console.log(`  ${s}: ${n}`);
  await prisma.$disconnect();
})();
