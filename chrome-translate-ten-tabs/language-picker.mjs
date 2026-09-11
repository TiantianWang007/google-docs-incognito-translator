import { LANGUAGES } from "./languages.mjs";

const normalize = value => value.normalize("NFKC").trim().toLowerCase();
const englishNames = new Intl.DisplayNames(["en"], { type: "language" });
const aliases = { "zh-CN": ["zh", "zh-cn", "简体", "简体中文"], "zh-TW": ["繁体", "繁体中文"], iw: ["he"], tl: ["fil"] };
export const languageLabel = ([, name, nativeName]) => `${name} · ${nativeName}`;
const entries = LANGUAGES.map(language => ({
  language,
  terms: [...language, languageLabel(language), englishNames.of(language[0]), ...(aliases[language[0]] ?? [])].map(normalize)
}));

export function createLanguagePicker(onChange) {
  const root = document.querySelector("#language-picker");
  const input = document.querySelector("#language");
  const toggle = document.querySelector("#language-toggle");
  const menu = document.querySelector("#language-menu");
  const list = document.querySelector("#language-results");
  const empty = document.querySelector("#language-empty");
  let matches = [];
  let active = -1;
  let composing = false;

  function resolve() {
    const query = normalize(input.value);
    if (!query) return undefined;
    const exact = entries.find(entry => entry.terms.includes(query));
    if (exact) return exact.language;
    const filtered = entries.filter(entry => entry.terms.some(term => term.includes(query)));
    return filtered.length === 1 ? filtered[0].language : undefined;
  }

  function close() {
    menu.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  function highlight(index) {
    active = index;
    Array.from(list.children).forEach((option, i) => option.setAttribute("aria-selected", String(i === active)));
    const option = list.children[active];
    if (option) {
      input.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function choose(language) {
    input.value = languageLabel(language);
    close();
    onChange(language);
  }

  function open(query = input.value) {
    const text = normalize(query);
    matches = entries.filter(entry => entry.terms.some(term => term.includes(text)));
    const exact = entries.find(entry => entry.terms.includes(text));
    if (exact) matches = [exact, ...matches.filter(entry => entry !== exact)];
    list.replaceChildren();
    matches.forEach(({ language }, index) => {
      const [code, name, nativeName] = language;
      const option = document.createElement("li");
      option.className = "language-option";
      option.id = `language-option-${code}`;
      option.setAttribute("role", "option");
      const text = document.createElement("span");
      text.textContent = name;
      const native = document.createElement("small");
      native.textContent = nativeName;
      text.append(native);
      const codeLabel = document.createElement("span");
      codeLabel.className = "language-code";
      codeLabel.textContent = code;
      option.append(text, codeLabel);
      // Keep focus in the combobox while choosing an option with the mouse.
      option.addEventListener("pointerdown", event => event.preventDefault());
      option.addEventListener("click", () => choose(language));
      option.addEventListener("pointermove", () => highlight(index));
      list.append(option);
    });
    empty.hidden = matches.length > 0;
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
    highlight(matches.length ? 0 : -1);
  }

  input.addEventListener("focus", () => { input.select(); open(""); });
  input.addEventListener("input", () => { open(); onChange(resolve()); });
  input.addEventListener("compositionstart", () => { composing = true; });
  input.addEventListener("compositionend", () => { composing = false; open(); onChange(resolve()); });
  input.addEventListener("keydown", event => {
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (menu.hidden) { open(""); return; }
      if (matches.length) highlight((active + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
    } else if (event.key === "Enter" && !menu.hidden) {
      event.preventDefault();
      if (active >= 0) choose(matches[active].language);
    } else if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === "Tab") {
      close();
    }
  });
  toggle.addEventListener("pointerdown", event => event.preventDefault());
  toggle.addEventListener("click", () => {
    const wasOpen = !menu.hidden;
    input.focus();
    if (wasOpen) close(); else open("");
  });
  root.addEventListener("focusout", event => { if (!root.contains(event.relatedTarget)) close(); });
  document.addEventListener("pointerdown", event => { if (!root.contains(event.target)) close(); });

  return {
    choose, resolve, close,
    get composing() { return composing; },
    setDisabled(disabled) { input.disabled = disabled; toggle.disabled = disabled; }
  };
}
