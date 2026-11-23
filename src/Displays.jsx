import React, { useState } from 'react';
import { Clipboard, Images, LayoutTemplate, Monitor, Plus, QrCode, Smartphone } from 'lucide-react';
import { CLASS_DISPLAY_LAYOUTS, DEFAULT_DISPLAY_LAYOUT, DISPLAY_LAYOUTS, MAX_VENUE_DISPLAYS, normalizeDisplayLayout } from '../shared/displays.js';
import { api, Dialog, Empty, External, Field, groupRounds, Issue, watchLink } from './ui.jsx';
import { SpectatorContent } from './Spectator.jsx';

const formValues = event => Object.fromEntries(new FormData(event.currentTarget));
const qrData = data => ({ title: data.qrTitle, url: data.qrUrl });

function QrFields({ value }) {
  return <>
    <Field label="Action title"><input name="qrTitle" placeholder="Vote for your favorite robot" defaultValue={value?.title ?? ''} maxLength="80" /></Field>
    <Field label="Destination URL"><input name="qrUrl" type="url" placeholder="https://" defaultValue={value?.url ?? ''} /></Field>
  </>;
}

function ScreenDialog({ meetup, screen, act, close }) {
  const [layout, setLayout] = useState(() => normalizeDisplayLayout(screen?.layout ?? DEFAULT_DISPLAY_LAYOUT));
  const [division, setDivision] = useState(screen?.division || meetup.divisions[0]?.id || '');
  const [rounds, setRounds] = useState(screen?.rounds ?? '');
  const [busy, setBusy] = useState(false);
  const [issue, setIssue] = useState('');
  const current = meetup.divisions.find(item => item.id === division);
  const usesClass = CLASS_DISPLAY_LAYOUTS.includes(layout);
  return <Dialog title={screen?.id ? 'Edit display' : 'Add display'} close={close}>
    <form className="dialog-form" onSubmit={async event => {
      event.preventDefault();
      const data = formValues(event);
      setBusy(true);
      setIssue('');
      try {
        await act({
          type: 'saveDisplay', screen: screen?.id, name: data.name, layout, division: usesClass ? division : '',
          rounds: layout === 'bracket' ? rounds : '', spectator: data.spectator === 'on', qr: qrData(data),
        }, 'Display settings saved');
        close();
      } catch (error) {
        setIssue(error.message);
      } finally {
        setBusy(false);
      }
    }}>
      <Field label="Display name"><input name="name" defaultValue={screen?.name} placeholder="Main hall" maxLength="80" required /></Field>
      <Field label="Layout"><select value={layout} onChange={event => { setLayout(event.target.value); setRounds(''); }}>
        {Object.entries(DISPLAY_LAYOUTS).map(([key, name]) => <option key={key} value={key}
          disabled={CLASS_DISPLAY_LAYOUTS.includes(key) && !meetup.divisions.length}>{name}</option>)}
      </select></Field>
      {usesClass && <Field label="Weight class"><select value={division} onChange={event => { setDivision(event.target.value); setRounds(''); }} required>
        {meetup.divisions.map(item => <option key={item.id} value={item.id}>{item.name} · {item.arena}</option>)}
      </select></Field>}
      {layout === 'bracket' && current && <Field label="Bracket focus"><select value={rounds} onChange={event => setRounds(event.target.value)}>
        <option value="">All rounds</option>
        {groupRounds(current).map(round => <option value={round.key} key={round.key}>
          {(round.key.startsWith('L') ? 'Losers · ' : round.key.startsWith('W') ? 'Winners · ' : '') + round.name}
        </option>)}
      </select></Field>}
      <div>
        <label className="checkbox">
          <input type="checkbox" name="spectator" defaultChecked={Boolean(screen?.id && meetup.spectatorScreenId === screen.id)}
            aria-describedby="spectator-display-help" />
          Spectator view
        </label>
        <small className="dialog-description" id="spectator-display-help">Use this display for the meetup’s public link.</small>
      </div>
      <div className="form-divider"><QrCode size={18} /> QR override</div>
      <QrFields value={screen?.qr} />
      <Issue>{issue}</Issue>
      <div className="actions">
        <button className="button primary" disabled={busy}
          data-tip={screen?.id ? 'Save the changes. Screens showing this display update within a few seconds.' : 'Add this display and create its link'}>Save display</button>
        {screen?.id && <button className="button quiet" disabled={busy} type="button"
          data-tip="Delete this display. Screens using its link will stop showing it." onClick={async () => {
          setBusy(true);
          try { await act({ type: 'removeDisplay', screen: screen.id }, 'Display removed'); close(); }
          catch (error) { setIssue(error.message); setBusy(false); }
        }}>Remove display</button>}
      </div>
    </form>
  </Dialog>;
}

function Branding({ meetup, act, busy }) {
  const [theme, setTheme] = useState(meetup.theme);
  const [device, setDevice] = useState('tv');
  const [previewLayout, setPreviewLayout] = useState(DEFAULT_DISPLAY_LAYOUT);
  const [issue, setIssue] = useState('');
  const [uploading, setUploading] = useState(false);
  const first = meetup.divisions[0]?.id ?? '';
  function set(key, value) { setTheme(previous => ({ ...previous, [key]: value })); }
  async function upload(key, file) {
    if (!file) return;
    setIssue('');
    setUploading(true);
    try {
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[file.type];
      if (!extension || file.size > 500_000) throw new Error('Choose a PNG, JPEG, or WebP up to 500 KB.');
      const bytes = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const asset = await api('meetups/' + meetup.id + '/image', { extension, bytes });
      set(key, asset.url);
    } catch (error) {
      setIssue(error.message);
    } finally {
      setUploading(false);
    }
  }
  return <section className="panel">
    <div className="section-head"><h3>Spectator graphics</h3><Images size={21} /></div>
    <div className="branding">
      <form className="settings-form" onSubmit={async event => {
        event.preventDefault();
        setIssue('');
        try { await act({ type: 'theme', ...theme }, 'Spectator graphics saved'); }
        catch (error) { setIssue(error.message); }
      }}>
        <div className="form-columns">
          <Field label="Accent color"><input type="color" value={theme.accent} onChange={event => set('accent', event.target.value)} /></Field>
          <Field label="Background color"><input type="color" value={theme.background} onChange={event => set('background', event.target.value)} /></Field>
        </div>
        <Field label="Text color"><select value={theme.tone} onChange={event => set('tone', event.target.value)}>
          <option value="light">Light text</option><option value="dark">Dark text</option>
        </select></Field>
        <div className="image-field">
          <Field label="Logo link"><input placeholder="https://" value={theme.logo} onChange={event => set('logo', event.target.value)} /></Field>
          <label className="button secondary compact upload-button" data-tip="Choose a PNG, JPG, or WebP logo from your computer">Upload image<input type="file" aria-label="Upload logo"
            accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={event => { upload('logo', event.target.files[0]); event.target.value = ''; }} /></label>
        </div>
        <Issue>{issue}</Issue>
        <button className="button primary" disabled={busy || uploading}
          data-tip={uploading ? 'Wait for the upload to finish' : 'Apply these colors and logo to every display and the spectator page'}>Save graphics</button>
      </form>
      <div className="preview-wrap">
        <div className="preview-toolbar">
          <select aria-label="Preview layout" value={previewLayout} onChange={event => setPreviewLayout(event.target.value)}>
            {Object.entries(DISPLAY_LAYOUTS).map(([key, label]) => <option value={key} key={key}>{label}</option>)}
          </select>
          <div className="actions">
            <button className={'icon-button ' + (device === 'tv' ? 'selected' : '')} aria-label="Widescreen preview" aria-pressed={device === 'tv'} onClick={() => setDevice('tv')} data-tip="Preview on a widescreen venue display"><Monitor size={17} /></button>
            <button className={'icon-button ' + (device === 'phone' ? 'selected' : '')} aria-label="Phone preview" aria-pressed={device === 'phone'} onClick={() => setDevice('phone')} data-tip="Preview on a spectator's phone"><Smartphone size={17} /></button>
          </div>
        </div>
        <div className={'preview-window ' + device}>
          <SpectatorContent meetup={{ ...meetup, theme }} view={previewLayout} item={first} preview />
        </div>
      </div>
    </div>
  </section>;
}

function QrSettings({ meetup, act, busy }) {
  const [scope, setScope] = useState('');
  const [issue, setIssue] = useState('');
  const arena = meetup.divisions.find(item => item.id === scope);
  const value = arena ? arena.qr : meetup.qr;
  return <section className="panel">
    <div className="section-head"><div><h3>QR actions</h3><p>Send the audience to a form, results page, or another link.</p></div><QrCode size={22} /></div>
    <form className="settings-form" key={scope + (value?.url ?? '') + (value?.title ?? '')} onSubmit={async event => {
      event.preventDefault();
      const data = formValues(event);
      setIssue('');
      try { await act({ type: arena ? 'arenaQr' : 'meetupQr', division: arena?.id, qr: qrData(data) }, 'QR action saved'); }
      catch (error) { setIssue(error.message); }
    }}>
      <Field label="Scope"><select value={scope} onChange={event => { setScope(event.target.value); setIssue(''); }}>
        <option value="">All screens</option>
        {meetup.divisions.map(item => <option value={item.id} key={item.id}>{item.arena} override</option>)}
      </select></Field>
      <div className="form-columns"><QrFields value={value} /></div>
      <Issue>{issue}</Issue>
      <button className="button primary" disabled={busy}
        data-tip={scope ? 'Save the QR code shown on this arena\'s screens' : 'Save the QR code shown on all screens'}>Save QR action</button>
    </form>
  </section>;
}

export default function Displays({ meetup, act, busy, notify }) {
  const [edit, setEdit] = useState(null);
  const atLimit = meetup.screens.length >= MAX_VENUE_DISPLAYS;
  return <div className="stack">
    <section className="panel">
      <div className="section-head"><div><h3>Display links</h3><p>{atLimit
        ? `All ${MAX_VENUE_DISPLAYS} display slots are in use.` : 'Open a display on a venue screen or share its link with spectators.'}</p></div>
        <button className="button primary" disabled={atLimit} onClick={() => setEdit({})}
          data-tip={atLimit ? 'Remove a display to add another' : 'Create a display for a venue screen or for spectators'}><Plus size={17} />Add display</button></div>
      {!meetup.screens.length ? <Empty title="No displays configured">Add a display for a venue screen or to share with spectators.</Empty>
        : <div className="screen-list">{meetup.screens.map(screen => {
          const spectator = meetup.spectatorScreenId === screen.id;
          // The Spectator view display copies the public link (for phones) but opens its own display
          // link, which venue screens use and which refreshes faster.
          const href = watchLink(meetup.id, 'screen', screen.id);
          const shared = spectator ? watchLink(meetup.id) : href;
          const division = meetup.divisions.find(item => item.id === screen.division);
          return <div className="screen-row" key={screen.id}>
            <span className="metric-icon"><LayoutTemplate size={20} /></span>
            <div className="queue-match"><strong>{screen.name}</strong><small>
              {DISPLAY_LAYOUTS[normalizeDisplayLayout(screen.layout)]}{division && ' · ' + division.name}{spectator && ' · Spectator view'}
            </small></div>
            <div className="actions">
              <button className="button secondary compact" onClick={() => setEdit(screen)}
                data-tip={'Change what ' + screen.name + ' shows'}>Edit</button>
              <button className="button quiet compact" data-tip={spectator
                ? 'Copy the public meetup link to share with spectators or put behind a QR code'
                : "Copy this display's web address to paste on a venue screen or share"} onClick={async () => {
                try {
                  await navigator.clipboard.writeText(new URL(shared, location.origin).href);
                  notify(spectator ? 'Public link copied' : 'Display link copied');
                }
                catch { notify('Open the display to copy its address'); }
              }}><Clipboard size={15} />Copy link</button>
              <External href={href} className="button secondary compact" tip="Open this display in a new tab to show on a venue screen">Open display</External>
            </div>
          </div>;
        })}</div>}
    </section>
    <Branding meetup={meetup} act={act} busy={busy} />
    <QrSettings meetup={meetup} act={act} busy={busy} />
    {edit && <ScreenDialog meetup={meetup} screen={edit} act={act} close={() => setEdit(null)} />}
  </div>;
}
