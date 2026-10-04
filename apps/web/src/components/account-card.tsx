'use client';
import { Check, Copy, MoreHorizontal, Star, Timer, ChevronRight } from 'lucide-react';
import type { PublicRecord } from '@still/core';
import { messages, type Locale } from '../lib/i18n';
export function AccountCard({
  record,
  code,
  now,
  privacy,
  copied,
  waiting,
  onCopy,
  onFavorite,
  onDetails,
  locale,
}: {
  record: PublicRecord;
  code: string | undefined;
  now: number;
  privacy: boolean;
  copied: boolean;
  waiting: boolean;
  onCopy: () => void;
  onFavorite: () => void;
  onDetails: () => void;
  locale: Locale;
}) {
  const t = messages(locale),
    remaining = record.period - (now % record.period),
    expires = record.type === 'totp' && remaining <= 5;
  const display = code
    ? `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`
    : '••• •••';
  return (
    <article className={`account-card ${expires ? 'expiring' : ''}`}>
      <div className="account-top">
        <span className={`service-icon ${record.color}`} aria-hidden="true">
          {record.issuer.slice(0, 1).toUpperCase()}
        </span>
        <div className="account-label">
          <h3>{privacy ? 'Private account' : record.issuer}</h3>
          <p>{privacy ? '••••••••••••' : record.account}</p>
        </div>
        <button
          className={`icon-button favorite ${record.favorite ? 'selected' : ''}`}
          aria-label={record.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={record.favorite}
          onClick={onFavorite}
        >
          <Star size={17} fill={record.favorite ? 'currentColor' : 'none'} />
        </button>
        <button
          className="icon-button"
          aria-label={`Options for ${privacy ? 'account' : record.issuer}`}
          onClick={onDetails}
        >
          <MoreHorizontal size={19} />
        </button>
      </div>
      <div className="code-row">
        <span
          className={`otp ${privacy ? 'masked' : ''}`}
          dir="ltr"
          aria-label={privacy ? 'Code hidden' : `Code ${code ?? 'loading'}`}
        >
          {privacy ? '••• •••' : display}
        </span>
        <button
          className={`copy-button ${copied ? 'success' : ''}`}
          onClick={onCopy}
          disabled={!code || waiting}
          aria-label={record.type === 'hotp' ? 'Copy and advance counter' : t.copy}
        >
          {copied ? <Check size={18} /> : <Copy size={18} />}
        </button>
      </div>
      <div className="account-bottom">
        <span className="folder-label">
          <span className={`folder-dot ${record.color}`} />
          {privacy ? 'Private' : record.folder}
        </span>
        {record.type === 'totp' ? (
          <span className={`countdown ${expires ? 'urgent' : ''}`}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <circle
                className="timer-progress"
                cx="12"
                cy="12"
                r="9"
                strokeDasharray={`${(56.55 * remaining) / record.period} 56.55`}
              />
            </svg>
            <span aria-label={`${remaining} ${t.remaining}`}>
              {waiting ? 'Waiting…' : `${remaining}s`}
            </span>
          </span>
        ) : (
          <span className="countdown">
            <Timer size={14} />
            Counter {record.counter}
            <ChevronRight size={13} />
          </span>
        )}
      </div>
    </article>
  );
}
