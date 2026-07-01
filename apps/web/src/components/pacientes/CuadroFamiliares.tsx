// Cuadro informativo de "posibles familiares": otros pacientes que comparten
// el mismo teléfono. Solo texto (no interactivo). Se embebe en todo punto de
// contacto de recepción / contact center. No renderiza nada si no hay.

export interface FamiliarPaciente {
  id: string;
  nombreCompleto: string;
}

interface CuadroFamiliaresProps {
  familiares?: FamiliarPaciente[] | null;
  /** Variante compacta para espacios reducidos (popover, drawer). */
  compacto?: boolean;
}

export function CuadroFamiliares({ familiares, compacto = false }: CuadroFamiliaresProps) {
  if (!familiares || familiares.length === 0) return null;
  const nombres = familiares.map((f) => f.nombreCompleto).join(', ');

  return (
    <div
      className={`rounded-lg border border-sky-200 bg-sky-50 text-sky-900 ${compacto ? 'px-2.5 py-1.5' : 'px-3 py-2'}`}
      title="Pacientes registrados con el mismo número de teléfono (posibles familiares)"
    >
      <p className={`font-semibold text-sky-700 ${compacto ? 'text-[10px]' : 'text-[11px]'} uppercase tracking-wide`}>
        👪 Posibles familiares (mismo teléfono)
      </p>
      <p className={`${compacto ? 'text-[11px]' : 'text-xs'} leading-snug mt-0.5`}>{nombres}</p>
    </div>
  );
}
