import React, { createContext, useContext, useMemo } from 'react';
import { english, translator } from '../shared/i18n.js';

// Spectator pages wrap their tree in the meetup's language; everything outside a provider (the staff dashboard) stays English.
const Translate = createContext(english);

export function LanguageProvider({ language, children }) {
  const t = useMemo(() => translator(language), [language]);
  return <Translate.Provider value={t}>{children}</Translate.Provider>;
}

export const useT = () => useContext(Translate);
