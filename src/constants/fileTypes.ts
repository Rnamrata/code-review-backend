import path from "path";

export const SUPPORTED_LANGUAGES = {
  PYTHON: 'python',
  JAVASCRIPT: 'javascript',
  TYPESCRIPT: 'typescript',
  JAVA: 'java',
  CPP: 'cpp',
  CSHARP: 'csharp'
} as const;

export const FILE_EXTENSION_MAP: Record<string, string> = {
  '.py': SUPPORTED_LANGUAGES.PYTHON,
  '.js': SUPPORTED_LANGUAGES.JAVASCRIPT,
  '.jsx': SUPPORTED_LANGUAGES.JAVASCRIPT,
  '.ts': SUPPORTED_LANGUAGES.TYPESCRIPT,
  '.tsx': SUPPORTED_LANGUAGES.TYPESCRIPT,
  '.java': SUPPORTED_LANGUAGES.JAVA,
  '.cpp': SUPPORTED_LANGUAGES.CPP,
  '.c': SUPPORTED_LANGUAGES.CPP,
  '.cs': SUPPORTED_LANGUAGES.CSHARP
};

const LANGUAGE_ALIASES: Record<string, string> = {
  'py': SUPPORTED_LANGUAGES.PYTHON,
  'js': SUPPORTED_LANGUAGES.JAVASCRIPT,
  'jsx': SUPPORTED_LANGUAGES.JAVASCRIPT,
  'ts': SUPPORTED_LANGUAGES.TYPESCRIPT,
  'tsx': SUPPORTED_LANGUAGES.TYPESCRIPT,
  'java': SUPPORTED_LANGUAGES.JAVA,
  'cpp': SUPPORTED_LANGUAGES.CPP,
  'c': SUPPORTED_LANGUAGES.CPP,
  'cs': SUPPORTED_LANGUAGES.CSHARP
};

export function normalizeLanguage(raw: string, filename:string): string | undefined {
  const key = raw.trim().toLowerCase();
  const canonical = LANGUAGE_ALIASES[key] ?? key;
  if (Object.values(SUPPORTED_LANGUAGES).includes(canonical as any)) return canonical;
  return FILE_EXTENSION_MAP[path.extname(filename).toLowerCase()];
}