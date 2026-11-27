// What the page derives from an entry instead of the data repeating it. No imports, so the
// browser bundle can use it too.

const GITHUB = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)(\/.*)?$/i;

/** Owner and name of a GitHub repository link. `root` is false for a path inside the repo. */
export function githubRepo(url: string | undefined): { owner: string; name: string; root: boolean } | undefined {
  const m = url ? GITHUB.exec(url) : null;
  if (!m) return undefined;
  return { owner: m[1], name: m[2].replace(/\.git$/, ''), root: !m[3] || /^\/+$/.test(m[3]) };
}

/** One spelling per link: lower-case host, lower-case GitHub owner and repo, no trailing slash, no .git. */
export function normalizeUrl(url: string): string {
  const u = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const m = /^(https?:\/\/)([^/]+)(\/.*)?$/i.exec(u);
  if (!m) return u;
  const host = m[2].toLowerCase();
  let path = m[3] ?? '';
  if (host === 'github.com') {
    const [, owner = '', repo = '', ...rest] = path.split('/');
    path = ['', owner.toLowerCase(), repo.toLowerCase(), ...rest].join('/').replace(/\/+$/, '');
  }
  return `${m[1].toLowerCase()}${host}${path}`;
}

/** The card heading: the name if one was written, else owner/name of the repo, else the link itself. */
export function heading(entry: { target: string; name?: string }): string {
  if (entry.name) return entry.name;
  const gh = githubRepo(entry.target);
  return gh ? `${gh.owner}/${gh.name}` : entry.target.replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

/** How one option is named in a list: its package, else its repo, else where its docs live. */
export function optionLabel(option: { package?: string; repo?: string; docs?: string }): string {
  if (option.package) return option.package.replace(/^[a-z]+:/, '');
  const gh = githubRepo(option.repo);
  if (gh) return gh.root ? `${gh.owner}/${gh.name}` : `${gh.owner}/${gh.name}/${option.repo!.replace(/\/+$/, '').split('/').pop()}`;
  const link = option.repo ?? option.docs;
  return link ? link.replace(/^https?:\/\//, '').split('/')[0] : 'built in';
}

export function ownerOf(url: string | undefined): string | undefined {
  return githubRepo(url)?.owner;
}
