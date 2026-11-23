import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/rajdhani/latin-500.css';
import '@fontsource/rajdhani/latin-600.css';
import '@fontsource/rajdhani/latin-700.css';
import '@fontsource/oxanium/latin-500.css';
import '@fontsource/oxanium/latin-600.css';
import '@fontsource/oxanium/latin-700.css';
import '@fontsource/oxanium/latin-800.css';
import '@fontsource/share-tech-mono/latin-400.css';
// Hebrew letters (Hebrew spectator pages, Hebrew robot names): Rubik beside Oxanium, Assistant beside Rajdhani and Share Tech Mono.
// Hebrew subsets only, so pages without Hebrew text never download them.
import '@fontsource/rubik/hebrew-500.css';
import '@fontsource/rubik/hebrew-600.css';
import '@fontsource/rubik/hebrew-700.css';
import '@fontsource/rubik/hebrew-800.css';
import '@fontsource/assistant/hebrew-400.css';
import '@fontsource/assistant/hebrew-500.css';
import '@fontsource/assistant/hebrew-600.css';
import '@fontsource/assistant/hebrew-700.css';
import Manage from './Manage.jsx';
import Register from './Register.jsx';
import Spectator from './Spectator.jsx';
import { TooltipLayer } from './Tooltip.jsx';
import './styles.css';

const [, route, id, view, item] = window.location.pathname.split('/');
createRoot(document.getElementById('root')).render(<>
  {route === 'watch' ? <Spectator id={id} view={view} item={item} />
    : route === 'register' && id ? <Register id={id} token={view} /> : <Manage />}
  <TooltipLayer />
</>);
