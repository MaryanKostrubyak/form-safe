import { previewText } from '../lib/format';

interface TextareaPreviewProps {
  value: string;
}

export function TextareaPreview({ value }: TextareaPreviewProps) {
  return (
    <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-5 text-slate-600 dark:text-slate-300">
      {previewText(value)}
    </p>
  );
}
