import { Clipboard, ExternalLink, Heart, RotateCcw, Trash2 } from 'lucide-react';
import type { Draft, LanguageCode } from '../types';
import { getDomain, formatRelativeTime } from '../lib/format';
import { t } from '../lib/i18n';
import { Badge } from './Badge';
import { Button } from './Button';
import { Card } from './Card';
import { TextareaPreview } from './TextareaPreview';

interface DraftCardProps {
  draft: Draft;
  language: LanguageCode;
  canRestore?: boolean;
  onCopy: (draft: Draft) => void;
  onRestore?: (draft: Draft) => void;
  onFavorite: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
}

export function DraftCard({
  draft,
  language,
  canRestore = false,
  onCopy,
  onRestore,
  onFavorite,
  onDelete,
}: DraftCardProps) {
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={draft.isArchived ? 'amber' : 'blue'}>{getDomain(draft.origin)}</Badge>
            {draft.isFavorite ? <Badge tone="rose">{t(language, 'favoriteBadge')}</Badge> : null}
          </div>
          <h3 className="mt-2 line-clamp-1 text-sm font-semibold text-slate-950 dark:text-white">
            {draft.pageTitle || getDomain(draft.origin)}
          </h3>
          <p className="mt-0.5 line-clamp-1 text-xs text-slate-500 dark:text-slate-400">
            {draft.fieldLabel || t(language, 'untitledField')} · {formatRelativeTime(draft.updatedAt, language)}
          </p>
        </div>
        <a
          href={draft.url}
          target="_blank"
          rel="noreferrer"
          className="grid size-8 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title={t(language, 'openPage')}
          aria-label={t(language, 'openDraftPage')}
        >
          <ExternalLink className="size-4" />
        </a>
      </div>

      <div className="mt-3 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-950/70">
        <TextareaPreview value={draft.value} />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Clipboard className="size-3.5" />} onClick={() => onCopy(draft)}>
          {t(language, 'copy')}
        </Button>
        {canRestore && onRestore ? (
          <Button size="sm" variant="primary" icon={<RotateCcw className="size-3.5" />} onClick={() => onRestore(draft)}>
            {t(language, 'insert')}
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          icon={<Heart className={draft.isFavorite ? 'size-3.5 fill-current' : 'size-3.5'} />}
          onClick={() => onFavorite(draft)}
        >
          {draft.isFavorite ? t(language, 'favorited') : t(language, 'favorite')}
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 className="size-3.5" />} onClick={() => onDelete(draft)}>
          {t(language, 'delete')}
        </Button>
      </div>
    </Card>
  );
}
