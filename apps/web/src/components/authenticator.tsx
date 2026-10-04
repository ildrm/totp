'use client';
import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Command,
  Cloud,
  Eye,
  EyeOff,
  Folder,
  Grid2X2,
  HelpCircle,
  LayoutGrid,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Star,
  Terminal,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import type { PublicRecord } from '@still/core';
import { useVault } from '../lib/use-vault';
import { isRtl, localeNames, messages, type Locale } from '../lib/i18n';
import { Onboarding } from './onboarding';
import { AccountCard } from './account-card';
import { Dialog } from './dialog';
import type { Theme } from './settings';
const AddAccount = dynamic(() => import('./add-account').then((m) => m.AddAccount));
const AccountDetails = dynamic(() => import('./account-details').then((m) => m.AccountDetails));
const BackupDialog = dynamic(() => import('./backup-dialog').then((m) => m.BackupDialog));
const Security = dynamic(() => import('./security').then((m) => m.Security));
const Settings = dynamic(() => import('./settings').then((m) => m.Settings));
const DeveloperTools = dynamic(() => import('./developer-tools').then((m) => m.DeveloperTools));
const CloudAccount = dynamic(() => import('./cloud-account').then((m) => m.CloudAccount));
const SharedVaults = dynamic(() => import('./shared-vaults').then((m) => m.SharedVaults));
type Page =
  'vault' | 'favorites' | 'archive' | 'security' | 'settings' | 'tools' | 'cloud' | 'shared';
export function Authenticator() {
  const vault = useVault(),
    [page, setPage] = useState<Page>('vault'),
    [locale, setLocale] = useState<Locale>('en'),
    [theme, setTheme] = useState<Theme>('system'),
    [query, setQuery] = useState(''),
    [folder, setFolder] = useState('all'),
    [sort, setSort] = useState('recent'),
    [add, setAdd] = useState(false),
    [details, setDetails] = useState<string | null>(null),
    [backup, setBackup] = useState<'export' | 'restore' | null>(null),
    [help, setHelp] = useState(false),
    [mobileMenu, setMobileMenu] = useState(false),
    [toast, setToast] = useState(''),
    [copied, setCopied] = useState<string | null>(null),
    [waiting, setWaiting] = useState<string | null>(null),
    [online, setOnline] = useState(true),
    [update, setUpdate] = useState<ServiceWorker | null>(null);
  const search = useRef<HTMLInputElement>(null),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    waitTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    copying = useRef(false),
    copyEpoch = useRef(0);
  const t = messages(locale),
    unlocked = vault.status === 'unlocked';
  useEffect(() => {
    try {
      const preferences = JSON.parse(localStorage.getItem('still.preferences') ?? '{}');
      if (Object.hasOwn(localeNames, preferences.locale)) setLocale(preferences.locale);
      if (['system', 'light', 'dark'].includes(preferences.theme)) setTheme(preferences.theme);
    } catch {
      /* Storage restrictions leave safe defaults. */
    }
  }, []);
  function rememberPreferences(nextLocale: Locale, nextTheme: Theme) {
    setLocale(nextLocale);
    setTheme(nextTheme);
    try {
      localStorage.setItem(
        'still.preferences',
        JSON.stringify({ locale: nextLocale, theme: nextTheme }),
      );
    } catch {
      /* Private browsing may deny preferences. */
    }
  }
  const { lock, refreshCodes } = vault;
  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? 'rtl' : 'ltr';
  }, [locale]);
  useEffect(() => {
    const match = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (match.matches ? 'dark' : 'light') : theme);
    apply();
    match.addEventListener('change', apply);
    return () => match.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production')
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((reg) => {
          if (reg.waiting) setUpdate(reg.waiting);
          reg.onupdatefound = () => {
            const installing = reg.installing;
            if (installing)
              installing.onstatechange = () => {
                if (installing.state === 'installed' && navigator.serviceWorker.controller)
                  setUpdate(installing);
              };
          };
        })
        .catch(() => notify('Offline installation could not complete. Check browser support.'));
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, [notify]);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPage('vault');
        search.current?.focus();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        lock();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [lock]);
  useEffect(() => {
    if (!unlocked) {
      setAdd(false);
      setDetails(null);
      setQuery('');
      setCopied(null);
      setWaiting(null);
      copyEpoch.current++;
      copying.current = false;
      if (waitTimer.current) clearTimeout(waitTimer.current);
    }
  }, [unlocked]);
  useEffect(
    () => () => {
      if (waitTimer.current) clearTimeout(waitTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );
  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return vault.records
      .filter((r) => (page === 'archive' ? r.archived : !r.archived))
      .filter((r) => page !== 'favorites' || r.favorite)
      .filter((r) => folder === 'all' || r.folder === folder)
      .map((r) => {
        const fields = [r.issuer, r.account, ...r.tags, ...r.aliases].map((v) => v.toLowerCase());
        const score = q
          ? fields.some((f) => f === q)
            ? 100
            : fields.some((f) => f.startsWith(q))
              ? 50
              : fields.some((f) => f.includes(q))
                ? 20
                : q.length >= 3 &&
                    fields.some((f) => {
                      let at = 0;
                      for (const char of f) {
                        if (char === q[at]) at++;
                      }
                      return at === q.length;
                    })
                  ? 10
                  : 0
          : 1;
        return { r, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => {
        if (query && a.score !== b.score) return b.score - a.score;
        if (sort === 'name') return a.r.issuer.localeCompare(b.r.issuer, locale);
        if (sort === 'frequent') return b.r.usageCount - a.r.usageCount;
        if (sort === 'manual') return a.r.order - b.r.order;
        if (a.r.favorite !== b.r.favorite) return a.r.favorite ? -1 : 1;
        return (b.r.lastUsedAt ?? b.r.createdAt).localeCompare(a.r.lastUsedAt ?? a.r.createdAt);
      })
      .map((item) => item.r);
  }, [vault.records, query, page, folder, sort, locale]);
  const visible = filtered.slice(0, 100),
    ids = visible.map((r) => r.id).join(','),
    periods = visible
      .map((r) => (r.type === 'totp' ? Math.floor(vault.now / r.period) : r.counter))
      .join(',');
  useEffect(() => {
    if (unlocked && ['vault', 'favorites', 'archive'].includes(page))
      void refreshCodes(ids ? ids.split(',') : []);
  }, [unlocked, page, ids, periods, refreshCodes]);
  async function copy(record: PublicRecord) {
    if (copying.current) return;
    const epoch = copyEpoch.current;
    const perform = async () => {
      if (epoch !== copyEpoch.current) return;
      try {
        const data = await vault.command({
          type: 'use',
          id: record.id,
          timestamp: Math.floor(Date.now() / 1000),
          advance: record.type === 'hotp',
        });
        if (epoch !== copyEpoch.current) return;
        if (!navigator.clipboard?.writeText)
          throw new Error('Clipboard unavailable. Select and copy the displayed code.');
        await navigator.clipboard.writeText(data.code!);
        setCopied(record.id);
        setTimeout(() => setCopied(null), 2200);
        notify(t.copied);
        void vault.refreshCodes(ids.split(','));
      } catch (e) {
        notify(e instanceof Error ? e.message : 'Could not copy code.');
      } finally {
        copying.current = false;
        setWaiting(null);
      }
    };
    const remaining = record.period - (Math.floor(Date.now() / 1000) % record.period);
    copying.current = true;
    if (record.type === 'totp' && remaining < vault.settings.copyThreshold) {
      setWaiting(record.id);
      notify('This code is expiring. Waiting for the next one…');
      waitTimer.current = setTimeout(() => void perform(), remaining * 1000 + 100);
    } else await perform();
  }
  const navigate = (value: Page) => {
    setPage(value);
    setFolder('all');
    setQuery('');
    setMobileMenu(false);
  };
  function restore() {
    vault.lock();
    setBackup('restore');
  }
  const activeRecord = vault.records.find((r) => r.id === details),
    activeCount = vault.records.filter((r) => !r.archived).length;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className={`sidebar ${mobileMenu ? 'mobile-open' : ''}`} aria-label="Main navigation">
        <a className="brand" href="/" aria-label="Still home">
          <span className="brand-icon">
            <ShieldCheck size={23} strokeWidth={1.8} />
          </span>
          <span>
            still<span className="brand-period">.</span>
          </span>
        </a>
        <button
          className="mobile-close icon-button"
          onClick={() => setMobileMenu(false)}
          aria-label="Close navigation"
        >
          <X size={20} />
        </button>
        <div className="workspace-switch">
          <span className="workspace-avatar">P</span>
          <div>
            {vault.headers.length > 1 ? (
              <select
                className="workspace-selector"
                aria-label="Switch vault"
                value={vault.header?.vaultId ?? ''}
                onChange={(e) =>
                  void vault
                    .switchVault(e.target.value)
                    .then(() => navigate('vault'))
                    .catch((e) => notify(e.message))
                }
              >
                {vault.headers.map((h, i) => (
                  <option key={h.vaultId} value={h.vaultId}>
                    {h.kind === 'shared' ? 'Shared' : 'Personal'} vault {i + 1}
                  </option>
                ))}
              </select>
            ) : (
              <strong>Personal space</strong>
            )}
            <small>{t.local}</small>
          </div>
          <LockKeyhole size={14} />
        </div>
        <span className="nav-section-label">WORKSPACE</span>
        <nav>
          <button
            className={`nav-item ${page === 'cloud' ? 'active' : ''}`}
            onClick={() => navigate('cloud')}
          >
            <Cloud size={18} />
            <span>Cloud account</span>
          </button>
          {(
            [
              { id: 'vault', icon: Grid2X2, label: t.vault, count: activeCount },
              {
                id: 'favorites',
                icon: Star,
                label: t.favorites,
                count: vault.records.filter((r) => r.favorite && !r.archived).length,
              },
              { id: 'archive', icon: Archive, label: t.archive },
            ] as const
          ).map(({ id, icon: Icon, label, ...rest }) => (
            <button
              key={id}
              className={`nav-item ${page === id ? 'active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {'count' in rest && unlocked && <span className="nav-count">{rest.count}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-rule" />
        <span className="nav-section-label">YOUR SPACE</span>
        <nav>
          <button
            className={`nav-item ${page === 'shared' ? 'active' : ''}`}
            onClick={() => navigate('shared')}
          >
            <Users size={18} />
            <span>Shared vaults</span>
          </button>
          <button
            className={`nav-item ${page === 'tools' ? 'active' : ''}`}
            onClick={() => navigate('tools')}
          >
            <Terminal size={18} />
            <span>{t.tools}</span>
          </button>
          <button
            className={`nav-item ${page === 'security' ? 'active' : ''}`}
            onClick={() => navigate('security')}
          >
            <ShieldCheck size={18} />
            <span>{t.security}</span>
          </button>
          <button
            className={`nav-item ${page === 'settings' ? 'active' : ''}`}
            onClick={() => navigate('settings')}
          >
            <Settings2 size={18} />
            <span>{t.settings}</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="local-promise">
            <div className="local-promise-title">
              <span className="status-dot" />
              {t.private}
            </div>
            <p>
              Your vault lives with you.
              <br />
              No trackers. No compromises.
            </p>
            <button className="text-button" onClick={() => setHelp(true)}>
              A little more about Still
              <ArrowUpRight size={13} />
            </button>
          </div>
          <button className="nav-item help-button" onClick={() => setHelp(true)}>
            <HelpCircle size={17} />
            {t.help}
            <span className="keycap">?</span>
          </button>
          <div className="sidebar-footer">
            <span className="tiny-brand">
              still. <small>v1.0.0</small>
            </span>
            <span className="pill">
              <span className="status-dot" />
              On device
            </span>
          </div>
        </div>
      </aside>
      {mobileMenu && (
        <button
          className="menu-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileMenu(false)}
        />
      )}
      <div className="main-shell" inert={mobileMenu}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="mobile-menu icon-button"
              aria-label="Open navigation"
              onClick={() => setMobileMenu(true)}
            >
              <Menu size={21} />
            </button>
            <span>{vault.header?.kind === 'shared' ? 'Shared space' : 'Personal space'}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>
              {page === 'vault'
                ? t.vault
                : page === 'favorites'
                  ? t.favorites
                  : page === 'archive'
                    ? t.archive
                    : page === 'tools'
                      ? t.tools
                      : page === 'security'
                        ? t.security
                        : page === 'cloud'
                          ? 'Cloud account'
                          : page === 'shared'
                            ? 'Shared vaults'
                            : t.settings}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="connection-state">
              {online ? <Wifi size={15} /> : <WifiOff size={15} />}
              <span>{online ? 'Offline-ready' : 'Offline'}</span>
            </span>
            <button
              className="icon-button privacy-button"
              disabled={!unlocked}
              aria-pressed={vault.settings.privacy}
              aria-label={t.privacy}
              onClick={() =>
                void vault
                  .command({
                    type: 'settings',
                    settings: { ...vault.settings, privacy: !vault.settings.privacy },
                  })
                  .catch(() => {})
              }
            >
              {vault.settings.privacy ? <EyeOff size={19} /> : <Eye size={19} />}
            </button>
            <span className="topbar-divider" />
            {unlocked ? (
              <button className="button lock-button" onClick={() => vault.lock()}>
                <LockKeyhole size={15} />
                {t.lock}
              </button>
            ) : (
              <select
                className="locale-compact"
                aria-label="Language"
                value={locale}
                onChange={(e) => rememberPreferences(e.target.value as Locale, theme)}
              >
                {Object.entries(localeNames).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            )}
            <span className="user-avatar">P</span>
          </div>
        </header>
        <main id="main" className="main-content">
          <div className="page-intro">
            <div>
              <span className="eyebrow">YOUR EVERYDAY PEACE OF MIND</span>
              <h1>
                {page === 'vault' || !unlocked
                  ? t.title
                  : page === 'favorites'
                    ? t.favorites
                    : page === 'archive'
                      ? t.archive
                      : page === 'tools'
                        ? t.tools
                        : page === 'security'
                          ? t.security
                          : page === 'cloud'
                            ? 'Cloud account'
                            : page === 'shared'
                              ? 'Shared vaults'
                              : t.settings}
              </h1>
              <p>{t.subtitle}</p>
            </div>
            {unlocked && ['vault', 'favorites', 'archive'].includes(page) && (
              <button className="button primary" onClick={() => setAdd(true)}>
                <Plus size={18} />
                {t.add}
              </button>
            )}
          </div>
          {update && (
            <div className="update-notice" role="status">
              <span>A security update is ready. Lock and reload to apply it.</span>
              <button
                className="button secondary"
                onClick={() => {
                  vault.lock();
                  update.postMessage({ type: 'ACTIVATE' });
                  setTimeout(() => window.location.reload(), 250);
                }}
              >
                Update now
              </button>
            </div>
          )}
          <Onboarding vault={vault} locale={locale} onRestore={restore} />
          {unlocked && (
            <>
              {vault.corrupt.length > 0 && (
                <div className="warning" role="alert">
                  {vault.corrupt.length} records could not be authenticated. They remain encrypted
                  in storage; restore from a trusted backup.
                </div>
              )}
              {vault.error && (
                <p className="error" role="alert">
                  {vault.error}
                </p>
              )}
              {['vault', 'favorites', 'archive'].includes(page) && (
                <>
                  <div className="vault-toolbar">
                    <div className="search-input">
                      <Search size={19} />
                      <input
                        ref={search}
                        placeholder={t.search}
                        aria-label="Search accounts"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        maxLength={256}
                      />
                      <kbd>
                        <Command size={11} />K
                      </kbd>
                    </div>
                    <button
                      className="button secondary backup-button"
                      onClick={() => setBackup('export')}
                    >
                      <ArrowDownToLine size={16} />
                      {t.backup}
                    </button>
                    <select
                      className="sort-control"
                      aria-label="Sort accounts"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="recent">Recent first</option>
                      <option value="name">Name A–Z</option>
                      <option value="frequent">Most used</option>
                      <option value="manual">Added order</option>
                    </select>
                    <span className="view-toggle">
                      <LayoutGrid size={18} />
                    </span>
                  </div>
                  <div className="filter-row">
                    <div className="folder-filters">
                      {[
                        ['all', t.all],
                        ['Personal', t.personal],
                        ['Work', t.work],
                      ].map(([value, label]) => (
                        <button
                          key={value}
                          className={`filter-chip ${folder === value ? 'active' : ''}`}
                          onClick={() => setFolder(value!)}
                        >
                          {value === 'all' ? <Grid2X2 size={14} /> : <Folder size={14} />} {label}
                          <span>
                            {
                              vault.records.filter(
                                (r) => !r.archived && (value === 'all' || r.folder === value),
                              ).length
                            }
                          </span>
                        </button>
                      ))}
                    </div>
                    <span className="results-count">
                      {filtered.length} {filtered.length === 1 ? 'account' : 'accounts'}
                    </span>
                  </div>
                  {visible.length ? (
                    <div className="account-grid">
                      {visible.map((r) => (
                        <AccountCard
                          key={r.id}
                          record={r}
                          code={vault.codes[r.id]}
                          now={vault.now}
                          privacy={vault.settings.privacy}
                          copied={copied === r.id}
                          waiting={waiting === r.id}
                          onCopy={() => void copy(r)}
                          onFavorite={() =>
                            void vault
                              .command({
                                type: 'update',
                                id: r.id,
                                changes: { favorite: !r.favorite },
                              })
                              .catch(() => {})
                          }
                          onDetails={() => setDetails(r.id)}
                          locale={locale}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-vault">
                      <div className="symbol">
                        <ShieldCheck size={32} />
                      </div>
                      <h2>{query ? 'No accounts match your search.' : t.empty}</h2>
                      <p>{query ? 'Try a service, account name, or tag.' : t.emptyText}</p>
                      {!query && (
                        <button className="button primary" onClick={() => setAdd(true)}>
                          <Plus size={17} />
                          {t.add}
                        </button>
                      )}
                    </div>
                  )}
                  {filtered.length > 100 && (
                    <p className="field-hint">
                      Showing the first 100 matches. Narrow your search to find another account.
                    </p>
                  )}
                  <div className="vault-tip">
                    <span className="tip-icon">
                      <ShieldCheck size={17} />
                    </span>
                    <p>
                      A little reminder: <strong>keep an encrypted backup.</strong> Your browser is
                      a home for your vault, not a backup.
                    </p>
                    <button className="text-button" onClick={() => setBackup('export')}>
                      Back up now
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </>
              )}
              {page === 'security' && (
                <Security
                  vault={vault}
                  onBackup={() => setBackup('export')}
                  onCloud={() => navigate('cloud')}
                />
              )}{' '}
              {page === 'settings' && (
                <Settings
                  vault={vault}
                  locale={locale}
                  setLocale={(value) => rememberPreferences(value, theme)}
                  theme={theme}
                  setTheme={(value) => rememberPreferences(locale, value)}
                  onBackup={() => setBackup('export')}
                  onRestore={restore}
                />
              )}{' '}
              {page === 'tools' && <DeveloperTools onCloud={() => navigate('cloud')} />}
              {page === 'cloud' && <CloudAccount vault={vault} notify={notify} />}
              {page === 'shared' && (
                <SharedVaults
                  vault={vault}
                  onOpenCloud={() => navigate('cloud')}
                  onOpenVault={() => navigate('vault')}
                  notify={notify}
                />
              )}
            </>
          )}
          <footer className="main-footer">
            <span>
              <LockKeyhole size={13} />
              {t.encrypted}
            </span>
            <span>
              Made for a little less worry.<span className="footer-dot">✧</span>
            </span>
          </footer>
        </main>
      </div>
      {add && unlocked && (
        <AddAccount
          vault={vault}
          locale={locale}
          onClose={() => setAdd(false)}
          onSaved={() => notify('Account added. A little more peace of mind.')}
        />
      )}{' '}
      {activeRecord && unlocked && (
        <AccountDetails record={activeRecord} vault={vault} onClose={() => setDetails(null)} />
      )}{' '}
      {backup && (backup === 'restore' || unlocked) && (
        <BackupDialog
          vault={vault}
          mode={backup}
          onClose={() => setBackup(null)}
          onDone={() => {
            navigate('vault');
            notify(
              backup === 'export'
                ? 'Encrypted backup downloaded.'
                : 'Backup authenticated and restored.',
            );
          }}
        />
      )}
      {help && (
        <Dialog title="A quieter kind of security." onClose={() => setHelp(false)}>
          <p className="muted">
            Still keeps authentication seeds encrypted on this device and calculates codes locally.
            No cloud account is needed.
          </p>
          <div className="help-shortcuts">
            <span>Find an account</span>
            <kbd>Ctrl / ⌘ K</kbd>
            <span>Lock immediately</span>
            <kbd>Ctrl / ⌘ Shift L</kbd>
          </div>
          <p>
            Use a strong vault passphrase, save your recovery kit separately, and keep encrypted
            backups. Set your system clock automatically.
          </p>
          <p className="field-hint">
            TOTP can be phished. Use passkeys at services that offer them. Browser malware,
            malicious extensions, and a compromised application update can affect an unlocked vault.
          </p>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <ShieldCheck size={17} />
          {toast}
        </div>
      )}
    </div>
  );
}
