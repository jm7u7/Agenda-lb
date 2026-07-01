import { useQuery } from '@tanstack/react-query';
import { promocionesApi } from '../api/promociones';

// Lista dinámica de promociones ACTIVAS (administrable desde Herramientas).
export function usePromociones() {
  const { data } = useQuery({
    queryKey: ['promociones-activas'],
    queryFn: promocionesApi.activas,
    staleTime: 5 * 60_000,
  });
  return { promociones: data ?? [] };
}
