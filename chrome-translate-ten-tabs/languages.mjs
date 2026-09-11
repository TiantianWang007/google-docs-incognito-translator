export const DEFAULT_LANGUAGE = "de";

// Google Translate target codes. Keep regional Chinese codes intact.
export const LANGUAGES = [
  ["de", "德语", "Deutsch"],
  ["en", "英语", "English"],
  ["fr", "法语", "Français"],
  ["es", "西班牙语", "Español"],
  ["it", "意大利语", "Italiano"],
  ["pt", "葡萄牙语", "Português"],
  ["ja", "日语", "日本語"],
  ["ko", "韩语", "한국어"],
  ["ru", "俄语", "Русский"],
  ["ar", "阿拉伯语", "العربية"],
  ["zh-CN", "中文（简体）", "简体中文"],
  ["zh-TW", "中文（繁体）", "繁體中文"],
  ["nl", "荷兰语", "Nederlands"],
  ["pl", "波兰语", "Polski"],
  ["cs", "捷克语", "Čeština"],
  ["sk", "斯洛伐克语", "Slovenčina"],
  ["hu", "匈牙利语", "Magyar"],
  ["ro", "罗马尼亚语", "Română"],
  ["bg", "保加利亚语", "Български"],
  ["el", "希腊语", "Ελληνικά"],
  ["tr", "土耳其语", "Türkçe"],
  ["uk", "乌克兰语", "Українська"],
  ["sv", "瑞典语", "Svenska"],
  ["da", "丹麦语", "Dansk"],
  ["fi", "芬兰语", "Suomi"],
  ["no", "挪威语", "Norsk"],
  ["is", "冰岛语", "Íslenska"],
  ["et", "爱沙尼亚语", "Eesti"],
  ["lv", "拉脱维亚语", "Latviešu"],
  ["lt", "立陶宛语", "Lietuvių"],
  ["sl", "斯洛文尼亚语", "Slovenščina"],
  ["hr", "克罗地亚语", "Hrvatski"],
  ["sr", "塞尔维亚语", "Српски"],
  ["bs", "波斯尼亚语", "Bosanski"],
  ["sq", "阿尔巴尼亚语", "Shqip"],
  ["mk", "马其顿语", "Македонски"],
  ["be", "白俄罗斯语", "Беларуская"],
  ["hi", "印地语", "हिन्दी"],
  ["bn", "孟加拉语", "বাংলা"],
  ["ta", "泰米尔语", "தமிழ்"],
  ["te", "泰卢固语", "తెలుగు"],
  ["ur", "乌尔都语", "اردو"],
  ["fa", "波斯语", "فارسی"],
  ["iw", "希伯来语", "עברית"],
  ["th", "泰语", "ไทย"],
  ["vi", "越南语", "Tiếng Việt"],
  ["id", "印尼语", "Bahasa Indonesia"],
  ["ms", "马来语", "Bahasa Melayu"],
  ["tl", "菲律宾语", "Filipino"],
  ["km", "高棉语", "ខ្មែរ"],
  ["lo", "老挝语", "ລາວ"],
  ["my", "缅甸语", "မြန်မာ"],
  ["ne", "尼泊尔语", "नेपाली"],
  ["si", "僧伽罗语", "සිංහල"],
  ["sw", "斯瓦希里语", "Kiswahili"],
  ["af", "南非荷兰语", "Afrikaans"],
  ["zu", "祖鲁语", "isiZulu"],
  ["am", "阿姆哈拉语", "አማርኛ"],
  ["ka", "格鲁吉亚语", "ქართული"],
  ["hy", "亚美尼亚语", "Հայերեն"],
  ["az", "阿塞拜疆语", "Azərbaycanca"],
  ["kk", "哈萨克语", "Қазақша"],
  ["uz", "乌兹别克语", "Oʻzbekcha"],
  ["mn", "蒙古语", "Монгол"]
];

export function findLanguage(code) {
  return LANGUAGES.find(([value]) => value === code);
}

export function translationUrl(code) {
  if (!findLanguage(code)) throw new Error("请选择列表中的目标语言。");
  const url = new URL("https://translate.google.com/");
  url.search = new URLSearchParams({ hl: "zh-cn", sl: "auto", tl: code, op: "docs" });
  return url.href;
}
