import { useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  ExternalLink,
  Heart,
  Save,
  RotateCcw,
  Trash2,
} from "lucide-react";
import type { FormDraftSession, LanguageCode } from "../types";
import { formatRelativeTime, getDomain, previewText } from "../lib/format";
import { t } from "../lib/i18n";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Card } from "./Card";

interface SessionCardProps {
  session: FormDraftSession;
  language: LanguageCode;
  canRestore: boolean;
  onRestore: (
    session: FormDraftSession,
    versionId?: string,
    fieldIds?: string[],
  ) => void;
  onCheckpoint: (session: FormDraftSession) => void;
  onCopy: (session: FormDraftSession) => void;
  onPatch: (
    session: FormDraftSession,
    patch: Partial<Pick<FormDraftSession, "status" | "isFavorite">>,
  ) => void;
  onDelete: (session: FormDraftSession) => void;
}

export function SessionCard({
  session,
  language,
  canRestore,
  onRestore,
  onCheckpoint,
  onCopy,
  onPatch,
  onDelete,
}: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const textPreview =
    session.fields
      .map((field) => (typeof field.value === "string" ? field.value : ""))
      .find(Boolean) ?? "";
  return (
    <Card
      className="overflow-hidden p-0 transition-[border-color,box-shadow] duration-150 hover:border-slate-300 dark:hover:border-slate-700"
      data-testid="session-card"
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            <span className="mt-0.5 text-slate-400">
              {expanded ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-center gap-1.5">
                <Badge>{getDomain(session.origin)}</Badge>
                <Badge
                  tone={
                    session.status === "active"
                      ? "green"
                      : session.status === "archived"
                        ? "amber"
                        : "neutral"
                  }
                >
                  {session.status === "active"
                    ? t(language, "statusActive")
                    : session.status === "archived"
                      ? t(language, "archived")
                      : session.status.replace("-", " ")}
                </Badge>
                {session.isFavorite ? (
                  <Badge tone="rose">{t(language, "favoriteBadge")}</Badge>
                ) : null}
              </span>
              <strong className="mt-2 block truncate text-sm text-slate-950 dark:text-white">
                {session.pageTitle || getDomain(session.origin)}
              </strong>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                {session.fields.length} fields ·{" "}
                {formatRelativeTime(session.updatedAt, language)}
              </span>
            </span>
          </button>
          <a
            href={session.url}
            target="_blank"
            rel="noreferrer"
            aria-label="Open page"
            className="rounded-md p-1.5 text-slate-400 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <ExternalLink className="size-4" />
          </a>
        </div>
        {textPreview ? (
          <p className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-2 text-xs leading-5 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            {previewText(textPreview, 220)}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {canRestore ? (
            <Button
              size="sm"
              variant="primary"
              icon={<RotateCcw className="size-3.5" />}
              onClick={() => onRestore(session)}
            >
              Restore all
            </Button>
          ) : null}
          <Button
            size="sm"
            icon={<Clipboard className="size-3.5" />}
            onClick={() => onCopy(session)}
          >
            {t(language, "copy")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Save className="size-3.5" />}
            onClick={() => onCheckpoint(session)}
          >
            Checkpoint
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={
              <Heart
                className={
                  session.isFavorite ? "size-3.5 fill-current" : "size-3.5"
                }
              />
            }
            onClick={() =>
              onPatch(session, { isFavorite: !session.isFavorite })
            }
          >
            {t(language, session.isFavorite ? "favorited" : "favorite")}
          </Button>
          {session.status === "active" ||
          session.status === "submit-pending" ? (
            <Button
              size="sm"
              variant="ghost"
              icon={<Check className="size-3.5" />}
              onClick={() => onPatch(session, { status: "completed" })}
            >
              Complete
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon={<Archive className="size-3.5" />}
            onClick={() =>
              onPatch(session, {
                status: session.status === "archived" ? "active" : "archived",
              })
            }
          >
            {session.status === "archived"
              ? "Unarchive"
              : t(language, "archive")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Trash2 className="size-3.5" />}
            onClick={() => onDelete(session)}
          >
            {t(language, "delete")}
          </Button>
        </div>
      </div>
      {expanded ? (
        <div className="animate-reveal border-t border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            Saved fields
          </h4>
          <div className="mt-2 grid gap-1.5">
            {session.fields.map((field) => (
              <div
                key={field.id}
                className="flex items-start justify-between gap-3 rounded-md bg-white px-2.5 py-2 text-xs dark:bg-slate-900"
              >
                <span className="font-medium text-slate-700 dark:text-slate-200">
                  {field.label}
                </span>
                <span className="ml-auto max-w-[45%] truncate text-slate-500">
                  {String(field.value)}
                </span>
                {canRestore ? (
                  <button
                    className="font-semibold text-brand-700 hover:underline dark:text-brand-100"
                    onClick={() => onRestore(session, undefined, [field.id])}
                  >
                    Restore
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <h4 className="mt-4 text-[11px] font-bold uppercase tracking-wider text-slate-500">
            History · {session.versions.length}/10
          </h4>
          <div className="mt-2 grid gap-1.5">
            {[...session.versions].reverse().map((version) => (
              <div
                key={version.id}
                className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
              >
                <span>
                  <strong className="capitalize">{version.reason}</strong>
                  <span className="ml-2 text-slate-500">
                    {formatRelativeTime(version.createdAt, language)}
                  </span>
                </span>
                {canRestore ? (
                  <button
                    className="font-semibold text-brand-700 hover:underline dark:text-brand-100"
                    onClick={() => onRestore(session, version.id)}
                  >
                    Restore
                  </button>
                ) : null}
              </div>
            ))}
            {session.versions.length === 0 ? (
              <p className="text-xs text-slate-500">
                Meaningful checkpoints will appear while you work.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </Card>
  );
}
