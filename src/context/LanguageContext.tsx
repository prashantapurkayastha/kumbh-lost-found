import { createContext, useContext, useState, type ReactNode } from "react";

interface LanguageContextType {
  lang: string;
  setLang: (l: string) => void;
}

const LanguageContext = createContext<LanguageContextType>({ lang: "mr", setLang: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState("mr");
  return (
    <LanguageContext.Provider value={{ lang, setLang }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
