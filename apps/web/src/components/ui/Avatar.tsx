import { cn } from '../../utils/cn';

interface AvatarProps {
  iniciales: string;
  color?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}

const SIZES = {
  xs: 'w-6 h-6 text-xxs',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-11 h-11 text-base',
};

export function Avatar({ iniciales, color = '#6B7F9E', size = 'md', className }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold text-white flex-shrink-0',
        SIZES[size],
        className
      )}
      style={{ backgroundColor: color }}
    >
      {iniciales.slice(0, 2)}
    </span>
  );
}
