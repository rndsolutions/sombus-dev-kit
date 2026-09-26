/** Read a setting from the environment, with a default, or stop with the name of what's missing. */
export function env(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === '') {
    console.error(`Set ${name}. See examples/README.md.`);
    process.exit(2);
  }
  return v;
}
