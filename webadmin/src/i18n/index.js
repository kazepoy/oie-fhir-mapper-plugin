// SPDX-License-Identifier: MPL-2.0
import en from "./locales/en.js";
import fr from "./locales/fr.js";
export const catalogs = { en, fr };
const STORAGE_KEY = "fhir-mapper:locale";

export function resolveLocale(preferred = []) {
  for (const tag of preferred) {
    const language = String(tag || "").toLowerCase().split(/[-_]/)[0];
    if (Object.hasOwn(catalogs, language)) return language;
  }
  return "en";
}

function browserLanguages() {
  return globalThis.navigator?.languages || [globalThis.navigator?.language];
}

function storedPreference() {
  if (typeof window === "undefined") return "auto";
  try {
    const saved = window.localStorage?.getItem(STORAGE_KEY) || "";
    return Object.hasOwn(catalogs, saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

let preference = storedPreference();
let locale = preference === "auto" ? resolveLocale(browserLanguages()) : preference;

export const currentLocale = () => locale;
export const localePreference = () => preference;

export const setLocale = preferred => {
  preference = "auto";
  locale = resolveLocale(preferred);
};

export const setLocalePreference = next => {
  const normalized = typeof next === "string" ? next.toLowerCase().split(/[-_]/)[0] : "";
  preference = Object.hasOwn(catalogs, normalized) ? normalized : "auto";
  if (typeof window !== "undefined") {
    try {
      if (preference === "auto") window.localStorage?.removeItem(STORAGE_KEY);
      else window.localStorage?.setItem(STORAGE_KEY, preference);
    } catch {
      // localStorage may be disabled in restricted browsing contexts
    }
  }
  locale = preference === "auto" ? resolveLocale(browserLanguages()) : preference;
  return locale;
};

// Looks up the key in the active locale, falling back to English or the key itself.
export function t(message, params = {}) {
  const text = (Object.hasOwn(catalogs[locale], message) ? catalogs[locale][message] : Object.hasOwn(catalogs.en, message) ? catalogs.en[message] : message);
  return String(text).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}
