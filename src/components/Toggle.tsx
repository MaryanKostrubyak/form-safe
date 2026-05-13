import { cn } from '../lib/cn';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label: string;
  description?: string;
}

export function Toggle({ checked, onChange, disabled, label, description }: ToggleProps) {
  return (
    <label className={cn('flex items-start justify-between gap-4', disabled && 'opacity-60')}>
      <span>
        <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</span>
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-950',
          checked ? 'border-brand-600 bg-brand-600' : 'border-slate-300 bg-slate-200 dark:border-slate-700 dark:bg-slate-800',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 size-5 rounded-full bg-white shadow transition',
            checked ? 'left-[19px]' : 'left-0.5',
          )}
        />
      </button>
    </label>
  );
}
