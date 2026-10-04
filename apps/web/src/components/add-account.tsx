'use client';
import { useEffect, useRef, useState } from 'react';
import { Camera, Keyboard, Upload, ChevronDown, ShieldCheck, ArrowRight } from 'lucide-react';
import { otpSchema, parseUri, type OtpInput, type PublicRecord } from '@still/core';
import type { VaultController } from '../lib/use-vault';
import { messages, type Locale } from '../lib/i18n';
import { Dialog } from './dialog';
import { ImportAccounts } from './import-accounts';
type Tab = 'manual' | 'scan' | 'import';
export function AddAccount({
  vault,
  locale,
  onClose,
  onSaved,
}: {
  vault: VaultController;
  locale: Locale;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = messages(locale),
    [tab, setTab] = useState<Tab>('manual'),
    [advanced, setAdvanced] = useState(false),
    [error, setError] = useState(''),
    [scanning, setScanning] = useState(false),
    [detected, setDetected] = useState(false);
  const [input, setInput] = useState<OtpInput>({
      type: 'totp',
      issuer: '',
      account: '',
      secret: '',
      algorithm: 'SHA-1',
      digits: 6,
      period: 30,
      counter: '0',
    }),
    [folder, setFolder] = useState('Personal'),
    [color, setColor] = useState<PublicRecord['color']>('violet'),
    [tags, setTags] = useState(''),
    [notes, setNotes] = useState(''),
    [uri, setUri] = useState('');
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<{ stop: () => void } | null>(null);
  const set = (key: keyof OtpInput, value: string | number) =>
    setInput((previous) => ({ ...previous, [key]: value }));
  function stop() {
    controls.current?.stop();
    controls.current = null;
    const stream = video.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    setScanning(false);
  }
  useEffect(
    () => () => {
      controls.current?.stop();
      const stream = video.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  function provision(value: string) {
    try {
      const parsed = parseUri(value);
      setInput(parsed);
      setDetected(true);
      setTab('manual');
      setError('');
      stop();
    } catch {
      setError('This QR or URI does not contain a supported authenticator account.');
    }
  }
  async function scan() {
    setError('');
    setScanning(true);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const reader = new BrowserQRCodeReader();
      const scanner = await reader.decodeFromVideoDevice(undefined, video.current!, (result) => {
        if (result) provision(result.getText());
      });
      controls.current = scanner;
      if (!video.current?.isConnected) scanner.stop();
    } catch {
      setError(
        'Camera unavailable or permission denied. Upload a QR image or enter the setup key.',
      );
      setScanning(false);
    }
  }
  async function image(file: File) {
    setError('');
    if (
      file.size > 10 * 1024 * 1024 ||
      !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
    ) {
      setError('Choose a PNG, JPEG, or WebP image smaller than 10 MB.');
      return;
    }
    let url: string | undefined;
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 16000000) {
        bitmap.close();
        throw new Error('Image too large.');
      }
      bitmap.close();
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      url = URL.createObjectURL(file);
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      provision(result.getText());
    } catch {
      setError('No readable authenticator QR found. Try a sharper, smaller image.');
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const parsed = otpSchema.parse(input);
      await vault.command({
        type: 'add',
        input: parsed,
        folder,
        color,
        tags: tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        notes,
      });
      setInput({ ...input, secret: '' });
      onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof Error && e.name !== 'ZodError'
          ? e.message
          : 'Check the service, account name, and Base32 setup key.',
      );
    }
  }
  return (
    <Dialog
      title={t.add}
      onClose={() => {
        stop();
        onClose();
      }}
    >
      <div className="tabs" role="tablist" aria-label="Add method">
        {(['manual', 'scan', 'import'] as const).map((value, i) => (
          <button
            key={value}
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'active' : ''}
            onClick={() => {
              stop();
              setTab(value);
              setError('');
            }}
          >
            {i === 0 ? (
              <Keyboard size={16} />
            ) : i === 1 ? (
              <Camera size={16} />
            ) : (
              <Upload size={16} />
            )}{' '}
            {value === 'manual' ? t.manual : value === 'scan' ? t.scan : t.import}
          </button>
        ))}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {tab === 'scan' ? (
        <div
          className="qr-panel"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) void image(file);
          }}
        >
          <div className="camera-frame">
            <video ref={video} playsInline muted autoPlay />
            {!scanning && <Camera size={48} />}
          </div>
          <p className="muted">
            Scan the QR code shown by your service.
            <br />
            Images are processed entirely on this device.
          </p>
          <button className="button primary" onClick={() => void scan()} disabled={scanning}>
            {scanning ? 'Camera active…' : 'Start camera'}
          </button>
          <label className="button secondary upload-label">
            Upload QR image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void image(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      ) : tab === 'import' ? (
        <div>
          <label>
            Provisioning URI
            <textarea
              spellCheck={false}
              autoComplete="off"
              maxLength={4096}
              value={uri}
              onChange={(e) => setUri(e.target.value)}
              placeholder="otpauth://totp/…"
            />
          </label>
          <p className="field-hint">
            Paste a provisioning URI. You’ll review the account before saving.
          </p>
          <button className="button primary full" onClick={() => provision(uri)}>
            Review account
            <ArrowRight size={16} />
          </button>
          <ImportAccounts
            vault={vault}
            onSaved={() => {
              onSaved();
              onClose();
            }}
          />
        </div>
      ) : (
        <form
          onSubmit={save}
          onPaste={(e) => {
            const file = [...e.clipboardData.items]
              .find((i) => i.type.startsWith('image/'))
              ?.getAsFile();
            if (file) {
              e.preventDefault();
              void image(file);
            }
          }}
        >
          {detected && (
            <div className="inline-notice">
              <ShieldCheck size={17} />
              QR decoded locally. Review the account before saving.
            </div>
          )}
          <label>
            {t.issuer}
            <input
              required
              maxLength={128}
              value={input.issuer}
              onChange={(e) => set('issuer', e.target.value)}
              placeholder="e.g. GitHub"
              autoComplete="off"
            />
          </label>
          <label>
            {t.account}
            <input
              required
              maxLength={256}
              value={input.account}
              onChange={(e) => set('account', e.target.value)}
              placeholder="you@example.com"
              autoComplete="off"
            />
          </label>
          <label>
            {t.secret}
            <input
              required
              type="password"
              maxLength={1024}
              spellCheck={false}
              autoComplete="off"
              value={input.secret}
              onChange={(e) => set('secret', e.target.value)}
              placeholder="Base32 key from your service"
              dir="ltr"
            />
          </label>
          <p className="field-hint">This is the setup key, not a 6-digit verification code.</p>
          <div className="form-grid">
            <label>
              Folder
              <select value={folder} onChange={(e) => setFolder(e.target.value)}>
                <option>Personal</option>
                <option>Work</option>
              </select>
            </label>
            <label>
              Color
              <select
                value={color}
                onChange={(e) => setColor(e.target.value as PublicRecord['color'])}
              >
                {['violet', 'blue', 'green', 'orange', 'rose', 'slate'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            className="advanced-toggle"
            aria-expanded={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            {t.advanced}
            <ChevronDown size={16} />
          </button>
          {advanced && (
            <div className="advanced-fields">
              <div className="form-grid">
                <label>
                  {t.type}
                  <select value={input.type} onChange={(e) => set('type', e.target.value)}>
                    <option value="totp">TOTP · time based</option>
                    <option value="hotp">HOTP · counter based</option>
                  </select>
                </label>
                <label>
                  {t.algorithm}
                  <select
                    value={input.algorithm}
                    onChange={(e) => set('algorithm', e.target.value)}
                  >
                    <option>SHA-1</option>
                    <option>SHA-256</option>
                    <option>SHA-512</option>
                  </select>
                </label>
                <label>
                  {t.digits}
                  <select
                    value={input.digits}
                    onChange={(e) => set('digits', Number(e.target.value))}
                  >
                    <option value={6}>6</option>
                    <option value={8}>8</option>
                  </select>
                </label>
                {input.type === 'totp' ? (
                  <label>
                    {t.period}
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={input.period}
                      onChange={(e) => set('period', Number(e.target.value))}
                    />
                  </label>
                ) : (
                  <label>
                    Counter
                    <input
                      inputMode="numeric"
                      value={input.counter}
                      onChange={(e) => set('counter', e.target.value)}
                      maxLength={20}
                    />
                  </label>
                )}
              </div>
              <label>
                Tags, separated by commas
                <input maxLength={640} value={tags} onChange={(e) => setTags(e.target.value)} />
              </label>
              <label>
                Notes
                <textarea
                  maxLength={2000}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <p className="field-hint">
                Use the exact algorithm and period specified by the service. Changing them changes
                your codes.
              </p>
            </div>
          )}
          <div className="dialog-actions">
            <button type="button" className="button secondary" onClick={onClose}>
              {t.cancel}
            </button>
            <button className="button primary" disabled={vault.busy}>
              {vault.busy ? 'Saving…' : t.save}
              <ArrowRight size={16} />
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
